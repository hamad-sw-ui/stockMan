import { PoolClient } from "pg";
import { HttpError } from "../lib/errors";
import { writeAudit } from "../lib/audit";
import { AuthUser } from "../middleware/auth";
import { resolveDepot } from "../lib/resolveDepot";
import { lockLevel, recordMovement, setLevel } from "./stockService";

/**
 * Inventaire physique professionnel (E5) : campagnes à cycle complet
 *   BROUILLON → COMPTAGE → REVUE → CLÔTURÉE (| ANNULÉE).
 * Règles métier garanties par le service :
 *  - théorique ET coût (CUMP) figés au lancement → écarts valorisés stables ;
 *  - comptage complet exigé avant revue ;
 *  - motif codifié exigé sur chaque ligne d'écart ;
 *  - le validateur ne peut pas être un compteur (séparation des tâches) ;
 *  - comptage aveugle optionnel : le théorique est masqué par l'API pendant
 *    le comptage (colonne renvoyée NULL) ;
 *  - gel optionnel : tant qu'une campagne « freeze » du dépôt est active,
 *    ventes/réceptions/ajustements/transferts du dépôt sont refusés (409
 *    STOCK_FROZEN) ;
 *  - inventaire tournant ABC : classes calculées sur les ventes (90 j),
 *    fréquences A=30 j, B=90 j, C=365 j.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export const COUNT_REASONS = [
  "MISCOUNT",
  "BREAKAGE",
  "THEFT",
  "EXPIRY",
  "SUPPLIER_ERROR",
  "DATA_ERROR",
  "OTHER",
] as const;
export type CountReason = (typeof COUNT_REASONS)[number];

export const ABC_FREQUENCIES: Record<"ABC_A" | "ABC_B" | "ABC_C", number> = {
  ABC_A: 30,
  ABC_B: 90,
  ABC_C: 365,
};

/** Classification ABC courante (ventes 90 j, tri décroissant par quantité) :
 *  A = 80 % cumulé du volume, B = jusqu'à 95 %, C = reste (y compris les
 *  produits sans ventes). */
export async function computeAbcClasses(
  client: PoolClient,
  tenantId: string,
): Promise<Map<string, "A" | "B" | "C">> {
  const since = new Date(Date.now() - 90 * 86_400_000);
  const sold = await client.query<{ product_id: string; q: number }>(
    `SELECT si.product_id, SUM(si.base_qty)::float AS q
       FROM sale_items si
       JOIN sales s ON s.id=si.sale_id AND s.status='COMPLETED' AND s.tenant_id=$1
      WHERE s.created_at >= $2
      GROUP BY si.product_id`,
    [tenantId, since],
  );
  const total = sold.rows.reduce((a, r) => a + r.q, 0);
  const sorted = [...sold.rows].sort((a, b) => b.q - a.q);
  const classes = new Map<string, "A" | "B" | "C">();
  let cumBefore = 0;
  for (const r of sorted) {
    // Convention ABC : le produit qui FRANCHIT le seuil appartient à la
    // classe qu'il complète (sinon le best-seller tomberait en C).
    const shareBefore = total > 0 ? cumBefore / total : 0;
    classes.set(
      r.product_id,
      shareBefore < 0.8 ? "A" : shareBefore < 0.95 ? "B" : "C",
    );
    cumBefore += r.q;
  }
  return classes;
}

/** Gel des mouvements (option « freeze ») : refuse toute écriture stock du
 *  dépôt tant qu'une campagne gelée est en comptage ou en revue. Appelé par
 *  les chemins d'écriture (ventes, réceptions, ajustements, transferts). */
export async function assertDepotNotFrozen(
  client: PoolClient,
  tenantId: string,
  depotId: string,
): Promise<void> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM inventory_campaigns
      WHERE tenant_id=$1 AND depot_id=$2 AND freeze_stock
        AND status IN ('COUNTING','REVIEW')
      LIMIT 1`,
    [tenantId, depotId],
  );
  if (r.rows[0])
    throw HttpError.conflict(
      "STOCK_FROZEN",
      "Dépôt gelé pour inventaire : aucun mouvement de stock n'est possible avant la fin de la campagne.",
      { campaignId: r.rows[0].id },
    );
}

async function lockCampaign(client: PoolClient, tenantId: string, id: string) {
  const r = await client.query<{
    id: string;
    status: string;
    depot_id: string;
    scope: string;
    blind: boolean;
    freeze_stock: boolean;
  }>(
    `SELECT id, status, depot_id, scope, blind, freeze_stock FROM inventory_campaigns
      WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
    [id, tenantId],
  );
  if (!r.rows[0])
    throw HttpError.notFound("Campagne d'inventaire introuvable.");
  return r.rows[0];
}

// ============================== CRÉATION (DRAFT) ============================
export async function createCampaign(
  client: PoolClient,
  user: AuthUser,
  input: {
    depotId?: string;
    scope?: "ALL" | "SELECTION" | "ABC_A" | "ABC_B" | "ABC_C";
    productIds?: string[]; // périmètre explicite (scope SELECTION)
    blind?: boolean;
    freezeStock?: boolean;
    note?: string | null;
  },
) {
  const depotId = resolveDepot(user, input.depotId);
  const scope = input.scope ?? "ALL";
  if (scope === "SELECTION" && (input.productIds ?? []).length === 0)
    throw HttpError.badRequest(
      "SCOPE_EMPTY",
      "Une campagne « sélection » exige au moins un produit.",
    );
  // Une seule campagne active par dépôt (l'index unique partiel fait foi ;
  // ce contrôle applicatif offre un message exploitable).
  const active = await client.query<{ id: string }>(
    `SELECT id FROM inventory_campaigns
      WHERE depot_id=$1 AND status IN ('DRAFT','COUNTING','REVIEW') LIMIT 1`,
    [depotId],
  );
  if (active.rows[0])
    throw HttpError.conflict(
      "CAMPAIGN_ACTIVE",
      "Une campagne est déjà active sur ce dépôt : clôturez-la ou annulez-la d'abord.",
      { campaignId: active.rows[0].id },
    );
  const r = await client.query<{ id: string }>(
    `INSERT INTO inventory_campaigns (tenant_id, depot_id, scope, blind, freeze_stock, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      user.tenantId,
      depotId,
      scope,
      input.blind ?? false,
      input.freezeStock ?? false,
      input.note ?? null,
      user.id,
    ],
  );
  const id = r.rows[0]!.id;
  for (const pid of input.productIds ?? []) {
    const p = await client.query(
      "SELECT 1 FROM products WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL",
      [pid, user.tenantId],
    );
    if (!p.rows[0])
      throw HttpError.badRequest(
        "PRODUCT_UNKNOWN",
        `Produit introuvable ou archivé (${pid}).`,
      );
    await client.query(
      "INSERT INTO inventory_campaign_products (campaign_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [id, pid],
    );
  }
  await writeAudit(
    {
      tenantId: user.tenantId,
      userId: user.id,
      userName: user.name,
      action: "CAMPAIGN",
      entity: "inventory_campaign",
      entityId: id,
      depotId,
      newState: { status: "DRAFT", scope: input.scope ?? "ALL" },
    },
    client,
  );
  return { id, status: "DRAFT" };
}

// ============================== LANCEMENT (COUNTING) ========================
/** Fige le théorique ET le coût (CUMP) par produit au lancement — base de
 *  calcul des écarts et de leur valorisation (rapport stable malgré les
 *  mouvements ultérieurs). */
export async function startCampaign(
  client: PoolClient,
  user: AuthUser,
  id: string,
) {
  const c = await lockCampaign(client, user.tenantId, id);
  if (c.status !== "DRAFT")
    throw HttpError.conflict(
      "CAMPAIGN_NOT_DRAFT",
      "Seule une campagne brouillon peut être lancée.",
    );

  // Produits du périmètre : catalogue actif entier, ou classe ABC demandée.
  const prods = await client.query<{
    id: string;
    avg_cost: number;
  }>(
    `SELECT id, avg_cost::float FROM products
      WHERE tenant_id=$1 AND archived_at IS NULL ORDER BY name`,
    [user.tenantId],
  );
  let ids = prods.rows.map((p) => p.id);
  if (c.scope === "ABC_A" || c.scope === "ABC_B" || c.scope === "ABC_C") {
    const classes = await computeAbcClasses(client, user.tenantId);
    const wanted = c.scope.slice(-1) as "A" | "B" | "C";
    ids = ids.filter((pid) => (classes.get(pid) ?? "C") === wanted);
  } else if (c.scope === "SELECTION") {
    const sel = await client.query<{ product_id: string }>(
      "SELECT product_id FROM inventory_campaign_products WHERE campaign_id=$1",
      [id],
    );
    const keep = new Set(sel.rows.map((r) => r.product_id));
    ids = ids.filter((pid) => keep.has(pid));
  }

  // Niveaux actuels du dépôt (figés — ventes/réceptions ultérieures ne les
  // changent pas dans le rapport d'écarts).
  const levels = await client.query<{
    product_id: string;
    variant_id: string | null;
    quantity: number;
  }>(
    `SELECT product_id, variant_id, quantity::float
       FROM stock_levels WHERE depot_id=$1`,
    [c.depot_id],
  );
  const qtyByProduct = new Map<string, number>();
  for (const l of levels.rows) {
    // Toutes les lignes du dépôt comptent (variantes incluses) : la campagne
    // se mène au niveau produit de base.
    qtyByProduct.set(
      l.product_id,
      round2((qtyByProduct.get(l.product_id) ?? 0) + l.quantity),
    );
  }
  const costById = new Map(prods.rows.map((p) => [p.id, p.avg_cost]));
  for (const pid of ids) {
    await client.query(
      `INSERT INTO inventory_count_items (campaign_id, product_id, theoretical_qty, theoretical_cost)
       VALUES ($1,$2,$3,$4)`,
      [id, pid, qtyByProduct.get(pid) ?? 0, costById.get(pid) ?? 0],
    );
  }
  await client.query(
    "UPDATE inventory_campaigns SET status='COUNTING', started_at=now(), updated_at=now() WHERE id=$1",
    [id],
  );
  await writeAudit(
    {
      tenantId: user.tenantId,
      userId: user.id,
      userName: user.name,
      action: "CAMPAIGN",
      entity: "inventory_campaign",
      entityId: id,
      depotId: c.depot_id,
      newState: {
        status: "COUNTING",
        products: ids.length,
        frozen: c.freeze_stock,
      },
    },
    client,
  );
  return { status: "COUNTING", products: ids.length };
}

// ============================ SAISIE DES COMPTAGES ==========================
export async function saveCounts(
  client: PoolClient,
  user: AuthUser,
  id: string,
  lines: Array<{
    productId: string;
    countedQty: number;
    reason?: CountReason | null;
  }>,
) {
  const c = await lockCampaign(client, user.tenantId, id);
  if (c.status !== "COUNTING")
    throw HttpError.conflict(
      "CAMPAIGN_NOT_COUNTING",
      "La saisie n'est possible que pendant le comptage.",
    );
  let saved = 0;
  for (const line of lines) {
    if (!(line.countedQty >= 0))
      throw HttpError.badRequest(
        "COUNT_INVALID",
        "La quantité comptée ne peut pas être négative.",
      );
    const r = await client.query(
      `UPDATE inventory_count_items
          SET counted_qty=$3, reason=$4, counted_by=$5, counted_at=now()
        WHERE campaign_id=$1 AND product_id=$2`,
      [id, line.productId, line.countedQty, line.reason ?? null, user.id],
    );
    if (r.rowCount === 0)
      throw HttpError.badRequest(
        "PRODUCT_NOT_IN_CAMPAIGN",
        `Produit hors périmètre de la campagne (${line.productId}).`,
      );
    saved++;
  }
  return { saved };
}

// ============================ REVUE (écarts calculés) =======================
/** Comptage complet exigé + motif codifié sur chaque écart ≠ 0. */
export async function reviewCampaign(
  client: PoolClient,
  user: AuthUser,
  id: string,
) {
  const c = await lockCampaign(client, user.tenantId, id);
  if (c.status !== "COUNTING")
    throw HttpError.conflict(
      "CAMPAIGN_NOT_COUNTING",
      "Seule une campagne en comptage peut passer en revue.",
    );
  const pending = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM inventory_count_items
      WHERE campaign_id=$1 AND counted_qty IS NULL`,
    [id],
  );
  if ((pending.rows[0]?.n ?? 0) > 0)
    throw HttpError.conflict(
      "COUNT_INCOMPLETE",
      `${pending.rows[0]!.n} ligne(s) non comptée(s) : le comptage doit être complet avant la revue.`,
    );

  // Écarts + contrôle des motifs codifiés (applicatif : UPDATE ... FROM non
  // portable — boucle de mise à jour).
  const rows = await client.query<{
    id: string;
    theoretical_qty: number;
    counted_qty: number;
    reason: string | null;
  }>(
    `SELECT id, theoretical_qty::float, counted_qty::float, reason
       FROM inventory_count_items WHERE campaign_id=$1`,
    [id],
  );
  let discrepancies = 0;
  let missingReason = 0;
  let valueUp = 0;
  let valueDown = 0;
  const costs = await client.query<{ id: string; theoretical_cost: number }>(
    "SELECT id, theoretical_cost::float FROM inventory_count_items WHERE campaign_id=$1",
    [id],
  );
  const costById = new Map(costs.rows.map((r) => [r.id, r.theoretical_cost]));
  for (const r of rows.rows) {
    const variance = round2(r.counted_qty - r.theoretical_qty);
    await client.query(
      "UPDATE inventory_count_items SET variance_qty=$2 WHERE id=$1",
      [r.id, variance],
    );
    if (Math.abs(variance) > 1e-9) {
      discrepancies++;
      if (!r.reason) missingReason++;
      const v = round2(
        (variance * Math.round((costById.get(r.id) ?? 0) * 100)) / 100,
      );
      if (v > 0) valueUp = round2(valueUp + v);
      else valueDown = round2(valueDown - v);
    }
  }
  if (missingReason > 0)
    throw HttpError.conflict(
      "COUNT_REASON_MISSING",
      `${missingReason} ligne(s) d'écart sans motif codifié : renseignez un motif pour chaque écart avant la revue.`,
    );
  await client.query(
    "UPDATE inventory_campaigns SET status='REVIEW', updated_at=now() WHERE id=$1",
    [id],
  );
  await writeAudit(
    {
      tenantId: user.tenantId,
      userId: user.id,
      userName: user.name,
      action: "CAMPAIGN",
      entity: "inventory_campaign",
      entityId: id,
      depotId: c.depot_id,
      newState: { status: "REVIEW", discrepancies, valueUp, valueDown },
    },
    client,
  );
  return { status: "REVIEW", discrepancies, valueUp, valueDown };
}

// ============================ VALIDATION (séparation des tâches) ============
/** Le validateur ne peut pas être un compteur. Les ajustements sont postés
 *  par le moteur de stock existant (niveau exprimé = quantité comptée,
 *  mouvement ADJUSTMENT/DAMAGE/EXPIRED valorisé au CUMP figé, motif codifié),
 *  en une seule transaction : une validation réussie est atomique et
 *  irréversible. */
export async function validateCampaign(
  client: PoolClient,
  user: AuthUser,
  id: string,
) {
  const c = await lockCampaign(client, user.tenantId, id);
  if (c.status === "CLOSED")
    throw HttpError.conflict(
      "CAMPAIGN_CLOSED",
      "Campagne déjà clôturée : les ajustements ont été appliqués.",
    );
  if (c.status !== "REVIEW")
    throw HttpError.conflict(
      "CAMPAIGN_NOT_REVIEW",
      "Seule une campagne en revue peut être validée.",
    );
  const counters = await client.query<{ counted_by: string }>(
    `SELECT DISTINCT counted_by FROM inventory_count_items
      WHERE campaign_id=$1 AND counted_by IS NOT NULL`,
    [id],
  );
  if (counters.rows.some((r) => r.counted_by === user.id))
    throw HttpError.conflict(
      "COUNT_VALIDATOR_SAME_AS_COUNTER",
      "Séparation des tâches : le validateur ne peut pas avoir participé au comptage.",
    );

  const rows = await client.query<{
    id: string;
    product_id: string;
    theoretical_qty: number;
    theoretical_cost: number;
    counted_qty: number;
    variance_qty: number;
    reason: string | null;
  }>(
    `SELECT id, product_id, theoretical_qty::float, theoretical_cost::float,
            counted_qty::float, variance_qty::float, reason
       FROM inventory_count_items WHERE campaign_id=$1 AND variance_qty <> 0`,
    [id],
  );
  let applied = 0;
  for (const r of rows.rows) {
    const scope = {
      tenantId: user.tenantId,
      depotId: c.depot_id,
      productId: r.product_id,
      variantId: null as string | null,
    };
    const previous = await lockLevel(client, scope);
    const next = Math.max(0, round2(previous + r.variance_qty));
    await setLevel(client, scope, next);
    const type =
      r.reason === "BREAKAGE"
        ? "DAMAGE"
        : r.reason === "EXPIRY"
          ? "EXPIRED"
          : "ADJUSTMENT";
    await recordMovement(client, {
      ...scope,
      userId: user.id,
      type,
      quantity: Math.abs(r.variance_qty),
      previousStock: previous,
      newStock: next,
      reason: `Inventaire ${id.slice(0, 8)} — écart ${r.variance_qty > 0 ? "+" : ""}${r.variance_qty} (${r.reason ?? "OTHER"})`,
      referenceId: id,
      unitCost: r.theoretical_cost,
      reasonCode: r.reason ?? "OTHER",
    });
    await client.query(
      "UPDATE inventory_count_items SET applied=true, applied_at=now() WHERE id=$1",
      [r.id],
    );
    applied++;
  }
  await client.query(
    "UPDATE inventory_campaigns SET status='CLOSED', validated_by=$2, validated_at=now(), closed_at=now(), updated_at=now() WHERE id=$1",
    [id, user.id],
  );
  await writeAudit(
    {
      tenantId: user.tenantId,
      userId: user.id,
      userName: user.name,
      action: "CAMPAIGN",
      entity: "inventory_campaign",
      entityId: id,
      depotId: c.depot_id,
      newState: { status: "CLOSED", adjustments: applied },
    },
    client,
  );
  return { status: "CLOSED", adjustments: applied };
}

export async function cancelCampaign(
  client: PoolClient,
  user: AuthUser,
  id: string,
) {
  const c = await lockCampaign(client, user.tenantId, id);
  if (c.status === "CLOSED" || c.status === "CANCELLED")
    throw HttpError.conflict(
      "CAMPAIGN_CLOSED",
      "Une campagne clôturée ou annulée ne peut plus changer de statut.",
    );
  await client.query(
    "UPDATE inventory_campaigns SET status='CANCELLED', updated_at=now() WHERE id=$1",
    [id],
  );
  await writeAudit(
    {
      tenantId: user.tenantId,
      userId: user.id,
      userName: user.name,
      action: "CAMPAIGN",
      entity: "inventory_campaign",
      entityId: id,
      depotId: c.depot_id,
      newState: { status: "CANCELLED" },
    },
    client,
  );
  return { status: "CANCELLED" };
}

// ============================ DÉTAIL / RAPPORT ==============================
export async function campaignDetail(
  client: PoolClient,
  tenantId: string,
  id: string,
) {
  const c = await client.query(
    `SELECT ic.*, d.name AS depot_name, cu.name AS created_by_name,
            vu.name AS validated_by_name
       FROM inventory_campaigns ic
       JOIN depots d ON d.id=ic.depot_id
       LEFT JOIN users cu ON cu.id=ic.created_by
       LEFT JOIN users vu ON vu.id=ic.validated_by
      WHERE ic.id=$1 AND ic.tenant_id=$2`,
    [id, tenantId],
  );
  if (!c.rows[0])
    throw HttpError.notFound("Campagne d'inventaire introuvable.");
  const campaign = c.rows[0];
  // Comptage aveugle : le théorique est masqué pendant la phase de comptage.
  const blind = campaign.status === "COUNTING" && campaign.blind;
  const items = await client.query<{
    id: string;
    product_id: string;
    product_name: string;
    theoretical_qty: number;
    theoretical_cost: number;
    counted_qty: number | null;
    variance_qty: number | null;
    reason: string | null;
    counted_by_name: string | null;
    applied: boolean;
  }>(
    `SELECT i.id, i.product_id, p.name AS product_name,
            i.theoretical_qty::float, i.theoretical_cost::float,
            i.counted_qty::float, i.variance_qty::float, i.reason,
            u.name AS counted_by_name, i.applied
       FROM inventory_count_items i
       JOIN products p ON p.id=i.product_id
       LEFT JOIN users u ON u.id=i.counted_by
      WHERE i.campaign_id=$1 ORDER BY p.name`,
    [id],
  );
  const lines = items.rows.map((r) => {
    const variance =
      r.variance_qty ??
      (r.counted_qty != null
        ? round2(r.counted_qty - r.theoretical_qty)
        : null);
    return {
      id: r.id,
      product_id: r.product_id,
      product_name: r.product_name,
      theoretical_qty: blind ? null : r.theoretical_qty,
      theoretical_cost: blind ? null : r.theoretical_cost,
      counted_qty: r.counted_qty,
      variance_qty: blind ? null : variance,
      variance_value:
        !blind && variance != null
          ? round2((variance * Math.round(r.theoretical_cost * 100)) / 100)
          : null,
      reason: r.reason,
      counted_by_name: r.counted_by_name,
      applied: r.applied,
    };
  });
  const totals = lines.reduce(
    (a, l) => {
      if (l.variance_qty != null && Math.abs(l.variance_qty) > 1e-9) {
        a.discrepancies++;
        if ((l.variance_value ?? 0) > 0)
          a.valueUp = round2(a.valueUp + (l.variance_value ?? 0));
        else a.valueDown = round2(a.valueDown - (l.variance_value ?? 0));
      }
      a.counted += l.counted_qty != null ? 1 : 0;
      return a;
    },
    { discrepancies: 0, valueUp: 0, valueDown: 0, counted: 0 },
  );
  return {
    ...campaign,
    blind_masked: blind,
    items: lines,
    totals: { ...totals, lines: lines.length },
  };
}

// ============================ ÉCHÉANCIER ABC (tournant) =====================
export async function abcSchedule(client: PoolClient, tenantId: string) {
  const classes = await computeAbcClasses(client, tenantId);
  const counts = { A: 0, B: 0, C: 0 };
  const active = await client.query<{ id: string }>(
    "SELECT id FROM products WHERE tenant_id=$1 AND archived_at IS NULL",
    [tenantId],
  );
  for (const p of active.rows) counts[classes.get(p.id) ?? "C"]++;
  const last = await client.query<{
    scope: string;
    closed_at: string | Date | null;
  }>(
    `SELECT scope, MAX(closed_at) AS closed_at FROM inventory_campaigns
      WHERE tenant_id=$1 AND status='CLOSED' AND scope LIKE 'ABC_%'
      GROUP BY scope`,
    [tenantId],
  );
  const lastByScope = new Map(
    last.rows.map((r) => [r.scope, r.closed_at ? new Date(r.closed_at) : null]),
  );
  const today = new Date();
  return (["ABC_A", "ABC_B", "ABC_C"] as const).map((scope) => {
    const freq = ABC_FREQUENCIES[scope];
    const lastAt = lastByScope.get(scope) ?? null;
    const dueAt = lastAt
      ? new Date(lastAt.getTime() + freq * 86_400_000)
      : null;
    return {
      scope,
      class_label:
        scope === "ABC_A"
          ? "A (80 % du volume)"
          : scope === "ABC_B"
            ? "B (15 %)"
            : "C (5 %)",
      product_count: counts[scope.slice(-1) as "A" | "B" | "C"],
      frequency_days: freq,
      last_count_at: lastAt ? lastAt.toISOString() : null,
      due_at: dueAt ? dueAt.toISOString().slice(0, 10) : null,
      overdue: dueAt ? dueAt.getTime() <= today.getTime() : true, // jamais compté = à faire
    };
  });
}

/** Code de motif d'ajustement manuel (stock /adjust) — exposé pour le zod. */
export const ADJUST_REASON_CODES = [...COUNT_REASONS] as const;
