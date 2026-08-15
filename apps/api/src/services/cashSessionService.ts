import { PoolClient } from "pg";
import { query, withTransaction } from "../config/db";
import { writeAudit } from "../lib/audit";
import { toDateStr, tzOffsetHours } from "../lib/dates";
import { HttpError } from "../lib/errors";
import { resolveDepot } from "../lib/resolveDepot";
import { AuthUser } from "../middleware/auth";

/**
 * E6 — Sessions de caisse.
 *
 * Cycle de vie : OPEN (une seule par dépôt) → CLOSED (Z figé, immuable).
 * La clôture verrouille la journée métier (business_date) du dépôt : aucune
 * nouvelle session ne peut être rouverte sur une journée clôturée.
 *
 * « Attendu » par méthode :
 *  - CASH  = fond d'ouverture + Σ versements espèces de la session
 *            (les restitutions d'espèces lors d'annulations sont des
 *            opérations manuelles de tiroir, déjà documentées en E3) ;
 *  - MoMo/OM = Σ versements de la méthode (solde attendu du compte).
 */

export interface CashSessionRow {
  id: string;
  tenant_id: string;
  depot_id: string;
  depot_name?: string;
  status: "OPEN" | "CLOSED";
  business_date: Date | string;
  opened_by: string;
  opened_by_name?: string;
  opened_at: string;
  opening_float: string;
  note: string | null;
  closed_by: string | null;
  closed_by_name?: string | null;
  closed_at: string | null;
  counted_cash: string | null;
  counted_mtn: string | null;
  counted_om: string | null;
  z_report: unknown;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Fuseau du tenant (défaut Africa/Douala, DAT-08). */
async function tenantTimezone(tenantId: string): Promise<string> {
  const r = await query<{ timezone: string }>(
    "SELECT timezone FROM tenants WHERE id=$1",
    [tenantId],
  );
  return r.rows[0]?.timezone ?? "Africa/Douala";
}

/** Journée métier courante (YYYY-MM-DD) dans le fuseau du tenant. */
export async function currentBusinessDate(tenantId: string): Promise<string> {
  const tz = await tenantTimezone(tenantId);
  return new Date(Date.now() + tzOffsetHours(tz) * 3_600_000)
    .toISOString()
    .slice(0, 10);
}

/** Config tenant : la vente hors session ouverte est-elle INTERDITE ? */
export async function isSessionRequired(tenantId: string): Promise<boolean> {
  const r = await query<{ value: string }>(
    "SELECT value FROM tenant_configs WHERE tenant_id=$1 AND key='cash_session_required'",
    [tenantId],
  );
  return r.rows[0]?.value === "true";
}

/** Session OUVERTE du dépôt (ou null). Verrou ligne si transaction fournie. */
export async function getOpenSession(
  client: PoolClient,
  tenantId: string,
  depotId: string,
): Promise<CashSessionRow | null> {
  const r = await client.query<CashSessionRow>(
    `SELECT * FROM cash_sessions
      WHERE tenant_id=$1 AND depot_id=$2 AND status='OPEN'
      ORDER BY opened_at DESC LIMIT 1 FOR UPDATE`,
    [tenantId, depotId],
  );
  return r.rows[0] ?? null;
}

/** Encaissements de la session, ventilés par méthode. */
async function paymentsByMethod(client: PoolClient, sessionId: string) {
  const r = await client.query<{ method: string; total: number }>(
    `SELECT method, COALESCE(SUM(amount),0)::float AS total
       FROM sale_payments WHERE cash_session_id=$1 GROUP BY method`,
    [sessionId],
  );
  const out = { CASH: 0, MTN_MOMO: 0, ORANGE_MONEY: 0 };
  for (const row of r.rows) {
    if (row.method in out) out[row.method as keyof typeof out] = row.total;
  }
  return out;
}

/** Attendus « en direct » d'une session ouverte (pour la caisse et l'aperçu). */
export async function liveExpected(
  client: PoolClient,
  session: CashSessionRow,
) {
  const pays = await paymentsByMethod(client, session.id);
  const opening = parseFloat(session.opening_float);
  return {
    CASH: round2(opening + pays.CASH),
    MTN_MOMO: round2(pays.MTN_MOMO),
    ORANGE_MONEY: round2(pays.ORANGE_MONEY),
  };
}

// ============================ OUVERTURE =====================================

export async function openSession(
  user: AuthUser,
  input: { depotId?: string; openingFloat: number; note?: string | null },
) {
  const depotId = resolveDepot(user, input.depotId);
  const businessDate = await currentBusinessDate(user.tenantId);

  // Précontrôles explicites (messages clairs) — les index uniques restent le
  // garde-fou contre la concurrence (course à l'ouverture).
  const existing = await query<{ status: "OPEN" | "CLOSED" }>(
    `SELECT status FROM cash_sessions
      WHERE tenant_id=$1 AND depot_id=$2 AND business_date=$3`,
    [user.tenantId, depotId, businessDate],
  );
  if (existing.rows[0]?.status === "CLOSED") {
    throw HttpError.conflict(
      "DAY_LOCKED",
      `La journée du ${businessDate} est déjà clôturée sur ce dépôt (Z émis) — elle est verrouillée.`,
    );
  }
  if (existing.rows[0]?.status === "OPEN") {
    throw HttpError.conflict(
      "SESSION_ALREADY_OPEN",
      "Une session de caisse est déjà ouverte sur ce dépôt.",
    );
  }

  let id: string;
  try {
    const r = await query<{ id: string }>(
      `INSERT INTO cash_sessions (tenant_id, depot_id, business_date, opened_by, opening_float, note)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        user.tenantId,
        depotId,
        businessDate,
        user.id,
        input.openingFloat,
        input.note ?? null,
      ],
    );
    id = r.rows[0]!.id;
  } catch (e) {
    // Défaite d'une course à l'ouverture (unicité base) → conflit métier.
    if ((e as { code?: string }).code === "23505") {
      throw HttpError.conflict(
        "SESSION_ALREADY_OPEN",
        "Une session de caisse est déjà ouverte sur ce dépôt.",
      );
    }
    throw e;
  }
  await writeAudit({
    tenantId: user.tenantId,
    userId: user.id,
    userName: user.name,
    action: "SESSION",
    entity: "cash_session",
    entityId: id,
    depotId,
    newState: { op: "OPEN", businessDate, openingFloat: input.openingFloat },
  });
  return sessionById(user, id);
}

// ============================ LECTURES ======================================

/** Session en cours du dépôt + attendus en direct + drapeau « obligatoire ». */
export async function currentSession(user: AuthUser, requestedDepot?: string) {
  const depotId =
    user.role === "VENDEUR" ? user.depotId : (requestedDepot ?? user.depotId);
  const required = await isSessionRequired(user.tenantId);
  if (!depotId) {
    return { required, session: null as null };
  }
  const r = await query<CashSessionRow>(
    `SELECT cs.*, d.name AS depot_name, u.name AS opened_by_name
       FROM cash_sessions cs
       JOIN depots d ON d.id = cs.depot_id
       JOIN users u ON u.id = cs.opened_by
      WHERE cs.tenant_id=$1 AND cs.depot_id=$2 AND cs.status='OPEN'
      ORDER BY cs.opened_at DESC LIMIT 1`,
    [user.tenantId, depotId],
  );
  const session = r.rows[0] ?? null;
  if (!session) return { required, session: null as null };
  const expected = await withTransaction((c) => liveExpected(c, session));
  return {
    required,
    session: {
      ...formatSession(session),
      expected,
    },
  };
}

function formatSession(s: CashSessionRow) {
  return {
    id: s.id,
    depotId: s.depot_id,
    depotName: s.depot_name,
    status: s.status,
    businessDate: toDateStr(s.business_date),
    openedBy: s.opened_by,
    openedByName: s.opened_by_name,
    openedAt: s.opened_at,
    openingFloat: parseFloat(s.opening_float),
    note: s.note,
    closedBy: s.closed_by,
    closedByName: s.closed_by_name ?? null,
    closedAt: s.closed_at,
    countedCash: s.counted_cash == null ? null : parseFloat(s.counted_cash),
    countedMtn: s.counted_mtn == null ? null : parseFloat(s.counted_mtn),
    countedOm: s.counted_om == null ? null : parseFloat(s.counted_om),
    zReport:
      s.z_report == null
        ? null
        : typeof s.z_report === "string"
          ? JSON.parse(s.z_report)
          : s.z_report,
  };
}

export async function sessionById(user: AuthUser, id: string) {
  const r = await query<CashSessionRow>(
    `SELECT cs.*, d.name AS depot_name,
            uo.name AS opened_by_name, uc.name AS closed_by_name
       FROM cash_sessions cs
       JOIN depots d ON d.id = cs.depot_id
       JOIN users uo ON uo.id = cs.opened_by
       LEFT JOIN users uc ON uc.id = cs.closed_by
      WHERE cs.id=$1 AND cs.tenant_id=$2`,
    [id, user.tenantId],
  );
  const s = r.rows[0];
  if (!s) throw HttpError.notFound("Session de caisse introuvable.");
  if (user.role === "VENDEUR" && s.depot_id !== user.depotId) {
    throw HttpError.forbidden(
      "Un vendeur ne voit que les sessions de son dépôt.",
      "DEPOT_FORBIDDEN",
    );
  }
  return formatSession(s);
}

// ============================ CLÔTURE (Z ÉMIS) ==============================

export async function closeSession(
  user: AuthUser,
  sessionId: string,
  input: {
    countedCash: number;
    countedMtn?: number | null;
    countedOm?: number | null;
    note?: string | null;
  },
) {
  return withTransaction(async (client) => {
    const r = await client.query<CashSessionRow & { opener: string }>(
      `SELECT cs.*, u.name AS opener FROM cash_sessions cs
        JOIN users u ON u.id = cs.opened_by
       WHERE cs.id=$1 AND cs.tenant_id=$2 FOR UPDATE`,
      [sessionId, user.tenantId],
    );
    const s = r.rows[0];
    if (!s) throw HttpError.notFound("Session de caisse introuvable.");
    if (user.role === "VENDEUR" && s.depot_id !== user.depotId) {
      throw HttpError.forbidden(
        "Un vendeur ne peut clôturer que la caisse de son dépôt.",
        "DEPOT_FORBIDDEN",
      );
    }
    if (s.status === "CLOSED") {
      throw HttpError.conflict(
        "SESSION_ALREADY_CLOSED",
        "Cette session est déjà clôturée — le Z est définitif.",
      );
    }

    // ---- Agrégats de la session ------------------------------------------
    const pays = await paymentsByMethod(client, s.id);
    const byStatus = await client.query<{
      status: string;
      n: number;
      total: number;
      paid: number;
    }>(
      `SELECT status, COUNT(*)::int AS n,
              COALESCE(SUM(total_amount),0)::float AS total,
              COALESCE(SUM(amount_paid),0)::float AS paid
         FROM sales WHERE cash_session_id=$1 GROUP BY status`,
      [s.id],
    );
    let salesCount = 0;
    let totalSold = 0;
    let totalPaid = 0;
    let voidedCount = 0;
    for (const row of byStatus.rows) {
      if (row.status === "COMPLETED") {
        salesCount = row.n;
        totalSold = row.total;
        totalPaid = row.paid;
      } else if (row.status === "VOIDED") {
        voidedCount = row.n;
      }
    }

    const opening = parseFloat(s.opening_float);
    const expectedCash = round2(opening + pays.CASH);
    const expectedMtn = round2(pays.MTN_MOMO);
    const expectedOm = round2(pays.ORANGE_MONEY);
    const varCash = round2(input.countedCash - expectedCash);
    const varMtn =
      input.countedMtn == null ? null : round2(input.countedMtn - expectedMtn);
    const varOm =
      input.countedOm == null ? null : round2(input.countedOm - expectedOm);

    // ---- Z de caisse (immuable) ------------------------------------------
    const businessDate = toDateStr(s.business_date);
    const z = {
      generatedAt: new Date().toISOString(),
      businessDate,
      depotId: s.depot_id,
      openedAt: s.opened_at,
      openedBy: s.opener,
      closedBy: user.name,
      openingFloat: opening,
      sales: {
        count: salesCount,
        voided: voidedCount,
        totalSold: round2(totalSold),
        totalPaid: round2(totalPaid),
        creditOutstanding: round2(totalSold - totalPaid),
      },
      methods: {
        CASH: {
          payments: round2(pays.CASH),
          expected: expectedCash,
          counted: input.countedCash,
          variance: varCash,
        },
        MTN_MOMO: {
          payments: round2(pays.MTN_MOMO),
          expected: expectedMtn,
          counted: input.countedMtn ?? null,
          variance: varMtn,
        },
        ORANGE_MONEY: {
          payments: round2(pays.ORANGE_MONEY),
          expected: expectedOm,
          counted: input.countedOm ?? null,
          variance: varOm,
        },
      },
      varianceTotal: round2(varCash + (varMtn ?? 0) + (varOm ?? 0)),
    };

    await client.query(
      `UPDATE cash_sessions
          SET status='CLOSED', closed_by=$2, closed_at=now(),
              counted_cash=$3, counted_mtn=$4, counted_om=$5, z_report=$6::jsonb,
              note = COALESCE($7, note)
        WHERE id=$1`,
      [
        s.id,
        user.id,
        input.countedCash,
        input.countedMtn ?? null,
        input.countedOm ?? null,
        JSON.stringify(z),
        input.note ?? null,
      ],
    );

    await writeAudit(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        action: "SESSION",
        entity: "cash_session",
        entityId: s.id,
        depotId: s.depot_id,
        previousState: { status: "OPEN", openingFloat: opening },
        newState: {
          op: "CLOSE",
          businessDate,
          varianceCash: varCash,
          varianceTotal: z.varianceTotal,
        },
      },
      client,
    );
    return sessionById(user, s.id);
  });
}

/** Liste paginée (gérant) — les écarts sont visibles ici. */
export async function listSessions(
  user: AuthUser,
  q: {
    depotId?: string;
    status?: "OPEN" | "CLOSED";
    from?: string;
    to?: string;
    limit: number;
    offset: number;
  },
) {
  const cond: string[] = ["cs.tenant_id=$1"];
  const params: unknown[] = [user.tenantId];
  if (q.depotId) {
    params.push(q.depotId);
    cond.push(`cs.depot_id=$${params.length}`);
  }
  if (q.status) {
    params.push(q.status);
    cond.push(`cs.status=$${params.length}`);
  }
  if (q.from) {
    params.push(q.from);
    cond.push(`cs.business_date >= $${params.length}::date`);
  }
  if (q.to) {
    params.push(q.to);
    cond.push(`cs.business_date <= $${params.length}::date`);
  }
  const where = cond.join(" AND ");
  const total = (
    await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM cash_sessions cs WHERE ${where}`,
      params,
    )
  ).rows[0]!.n;
  const rows = await query<CashSessionRow>(
    `SELECT cs.*, d.name AS depot_name,
            uo.name AS opened_by_name, uc.name AS closed_by_name
       FROM cash_sessions cs
       JOIN depots d ON d.id = cs.depot_id
       JOIN users uo ON uo.id = cs.opened_by
       LEFT JOIN users uc ON uc.id = cs.closed_by
      WHERE ${where}
      ORDER BY cs.opened_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.limit, q.offset],
  );
  return { rows: rows.rows.map(formatSession), total };
}
