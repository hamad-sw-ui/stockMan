import { PoolClient } from "pg";
import { query } from "../config/db";
import { writeAudit } from "../lib/audit";
import { HttpError } from "../lib/errors";

/**
 * E7 — Facturation fiscale Cameroun.
 *
 *  - Prix catalogue = TTC. Ventilation FIGÉE par ligne :
 *    HT = TTC / (1 + taux) ; TVA = TTC − HT (arrondi 2 décimales).
 *  - Numérotation légale CONTINUE par dépôt / série (FAC factures, AV avoirs)
 *    / année : la séquence est incrémentée FOR UPDATE dans la transaction
 *    d'émission — sans trou ni réutilisation (un rollback l'annule aussi).
 *  - Facture IMMUABLE : jamais modifiée. Une annulation (ou un retour)
 *    émet un AVOIR (CREDIT_NOTE) référençant la facture d'origine.
 *  - Mentions obligatoires : raison sociale, NIU, RCCM du tenant (+ adresse,
 *    téléphone) — instantanés clients/produits figés sur la facture.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Ventilation d'un montant TTC en HT + TVA (arrondi à 2 décimales). */
export function vatSplit(ttc: number, rate: number) {
  const ht = round2(ttc / (1 + rate / 100));
  return { ht, vat: round2(ttc - ht) };
}

/** Slug court du dépôt pour le numéro légal (figé à l'émission). */
export function depotSlug(name: string): string {
  const s = name.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return (s || "DEP").slice(0, 4);
}

export interface InvoiceLineInput {
  productId: string | null;
  productName: string;
  variantName: string | null;
  unitSymbol: string | null;
  quantity: number; // en unité de vente
  unitPrice: number; // prix/base TTC
  taxRate: number;
  totalTtc: number;
}

export interface IssuedInvoice {
  id: string;
  number: string;
  kind: "INVOICE" | "CREDIT_NOTE";
  totalHt: number;
  totalVat: number;
  totalTtc: number;
}

/** Année fiscale courante côté tenant (bornée application, cohérent pg-mem). */
function fiscalYear(at: Date = new Date()): number {
  return at.getUTCFullYear();
}

/** Numéro suivant de la série (séquence verrouillée, continue). */
async function nextNumber(
  client: PoolClient,
  tenantId: string,
  depotId: string,
  depotName: string,
  series: "FAC" | "AV",
): Promise<{ number: string; year: number; seq: number; slug: string }> {
  const year = fiscalYear();
  const r = await client.query<{ last_number: number }>(
    `INSERT INTO invoice_sequences (tenant_id, depot_id, series, year, last_number)
     VALUES ($1,$2,$3,$4,1)
     ON CONFLICT (tenant_id, depot_id, series, year)
     DO UPDATE SET last_number = invoice_sequences.last_number + 1
     RETURNING last_number`,
    [tenantId, depotId, series, year],
  );
  const seq = r.rows[0]!.last_number;
  const slug = depotSlug(depotName);
  return {
    number: `${series}-${slug}-${year}-${String(seq).padStart(6, "0")}`,
    year,
    seq,
    slug,
  };
}

/** Émission (transactionnelle — appelée DANS la transaction métier). */
async function insertInvoice(
  client: PoolClient,
  args: {
    tenantId: string;
    depotId: string;
    depotName: string;
    kind: "INVOICE" | "CREDIT_NOTE";
    saleId?: string | null;
    saleReturnId?: string | null;
    parentInvoiceId?: string | null;
    customerId?: string | null;
    customerName?: string | null;
    lines: InvoiceLineInput[];
    note?: string | null;
    issuedBy: string | null;
    issuedAt?: string | null;
  },
): Promise<IssuedInvoice> {
  const series = args.kind === "INVOICE" ? "FAC" : "AV";
  const { number, year, seq, slug } = await nextNumber(
    client,
    args.tenantId,
    args.depotId,
    args.depotName,
    series,
  );
  let totalHt = 0;
  let totalVat = 0;
  let totalTtc = 0;
  const prepared = args.lines.map((l) => {
    const { ht, vat } = vatSplit(l.totalTtc, l.taxRate);
    totalHt = round2(totalHt + ht);
    totalVat = round2(totalVat + vat);
    totalTtc = round2(totalTtc + l.totalTtc);
    return { ...l, totalHt: ht, totalVat: vat };
  });

  const inv = await client.query<{ id: string }>(
    `INSERT INTO invoices (tenant_id, depot_id, depot_label, kind, series, year, seq, number,
                           sale_id, sale_return_id, parent_invoice_id, customer_id, customer_name,
                           total_ht, total_vat, total_ttc, note, issued_by, issued_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, COALESCE($19::timestamptz, now()))
     RETURNING id`,
    [
      args.tenantId,
      args.depotId,
      slug,
      args.kind,
      series,
      year,
      seq,
      number,
      args.saleId ?? null,
      args.saleReturnId ?? null,
      args.parentInvoiceId ?? null,
      args.customerId ?? null,
      args.customerName ?? null,
      totalHt,
      totalVat,
      totalTtc,
      args.note ?? null,
      args.issuedBy,
      args.issuedAt ?? null,
    ],
  );
  const id = inv.rows[0]!.id;
  for (const l of prepared) {
    await client.query(
      `INSERT INTO invoice_items (invoice_id, product_id, product_name, variant_name, unit_symbol,
                                  quantity, unit_price, tax_rate, total_ht, total_vat, total_ttc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        l.productId,
        l.productName,
        l.variantName,
        l.unitSymbol,
        l.quantity,
        l.unitPrice,
        l.taxRate,
        l.totalHt,
        l.totalVat,
        l.totalTtc,
      ],
    );
  }
  return { id, number, kind: args.kind, totalHt, totalVat, totalTtc };
}

/** Regroupement d'imprimé : (produit, variante, unité, prix, taux) —
 *  les ventilations par lot de sale_items fusionnent en une ligne client. */
export function groupInvoiceLines(
  lines: InvoiceLineInput[],
): InvoiceLineInput[] {
  const key = (l: InvoiceLineInput) =>
    [l.productId, l.variantName, l.unitSymbol, l.unitPrice, l.taxRate].join(
      "|",
    );
  const grouped = new Map<string, InvoiceLineInput>();
  for (const l of lines) {
    const g = grouped.get(key(l));
    if (g) {
      g.quantity = round2(g.quantity + l.quantity);
      g.totalTtc = round2(g.totalTtc + l.totalTtc);
    } else {
      grouped.set(key(l), { ...l });
    }
  }
  return [...grouped.values()];
}

/**
 * Facture de la vente (série FAC), émise dans la transaction de vente.
 * `lines` = lignes sale_items insérées (avec noms produits/variantes/unités
 * et taux FIGÉ). Les lignes sont regroupées pour l'imprimé (un produit
 * prélevé sur plusieurs lots n'apparaît qu'une fois).
 */
export async function issueInvoiceForSale(
  client: PoolClient,
  args: {
    tenantId: string;
    depotId: string;
    depotName: string;
    saleId: string;
    customerId: string | null;
    customerName: string | null;
    issuedBy: string;
    issuedAt: string;
    lines: InvoiceLineInput[];
  },
): Promise<IssuedInvoice> {
  const issued = await insertInvoice(client, {
    ...args,
    kind: "INVOICE",
    lines: groupInvoiceLines(args.lines),
  });
  await writeAudit(
    {
      tenantId: args.tenantId,
      userId: args.issuedBy,
      action: "INVOICE",
      entity: "invoice",
      entityId: issued.id,
      depotId: args.depotId,
      newState: { number: issued.number, totalTtc: issued.totalTtc },
    },
    client,
  );
  return issued;
}

/**
 * Avoir (série AV) pour une annulation ou un retour : reprend EXACTEMENT les
 * lignes de la facture d'origine (annulation) ou les lignes retournées
 * (retour partiel, taux d'origine). Aucune facture n'est jamais modifiée.
 */
export async function issueCreditNote(
  client: PoolClient,
  args: {
    tenantId: string;
    depotId: string;
    depotName: string;
    saleId: string;
    saleReturnId?: string | null;
    customerId: string | null;
    customerName: string | null;
    issuedBy: string;
    lines: InvoiceLineInput[];
    note: string | null;
  },
): Promise<IssuedInvoice | null> {
  if (args.lines.length === 0) return null;
  const parent = await client.query<{ id: string; number: string }>(
    `SELECT id, number FROM invoices
      WHERE sale_id=$1 AND tenant_id=$2 AND kind='INVOICE'
      ORDER BY issued_at DESC LIMIT 1`,
    [args.saleId, args.tenantId],
  );
  const issued = await insertInvoice(client, {
    ...args,
    kind: "CREDIT_NOTE",
    parentInvoiceId: parent.rows[0]?.id ?? null,
    note: args.note
      ? `${args.note} (réf. ${parent.rows[0]?.number ?? "vente hors facturation"})`
      : `Avoir réf. ${parent.rows[0]?.number ?? "vente hors facturation"}`,
  });
  await writeAudit(
    {
      tenantId: args.tenantId,
      userId: args.issuedBy,
      action: "INVOICE",
      entity: "invoice",
      entityId: issued.id,
      depotId: args.depotId,
      newState: {
        number: issued.number,
        kind: "CREDIT_NOTE",
        parent: parent.rows[0]?.number ?? null,
        totalTtc: issued.totalTtc,
      },
    },
    client,
  );
  return issued;
}

// ============================ LECTURES ======================================

export interface InvoiceRow {
  id: string;
  depot_id: string;
  depot_name: string;
  kind: "INVOICE" | "CREDIT_NOTE";
  series: "FAC" | "AV";
  year: number;
  seq: number;
  number: string;
  sale_id: string | null;
  sale_return_id: string | null;
  parent_invoice_id: string | null;
  parent_number: string | null;
  customer_id: string | null;
  customer_name: string | null;
  total_ht: number;
  total_vat: number;
  total_ttc: number;
  note: string | null;
  issued_by_name: string | null;
  issued_at: string;
}

function formatInvoice(r: InvoiceRow) {
  return {
    id: r.id,
    depotId: r.depot_id,
    depotName: r.depot_name,
    kind: r.kind,
    series: r.series,
    year: r.year,
    seq: r.seq,
    number: r.number,
    saleId: r.sale_id,
    saleReturnId: r.sale_return_id,
    parentInvoiceId: r.parent_invoice_id,
    parentNumber: r.parent_number,
    customerId: r.customer_id,
    customerName: r.customer_name,
    totalHt: r.total_ht,
    totalVat: r.total_vat,
    totalTtc: r.total_ttc,
    note: r.note,
    issuedByName: r.issued_by_name,
    issuedAt: r.issued_at,
  };
}

const BASE_SELECT = `
  SELECT i.id, i.depot_id, d.name AS depot_name, i.kind, i.series, i.year, i.seq,
         i.number, i.sale_id, i.sale_return_id, i.parent_invoice_id, p.number AS parent_number,
         i.customer_id, i.customer_name,
         i.total_ht::float, i.total_vat::float, i.total_ttc::float,
         i.note, u.name AS issued_by_name, i.issued_at
    FROM invoices i
    JOIN depots d ON d.id = i.depot_id
    LEFT JOIN invoices p ON p.id = i.parent_invoice_id
    LEFT JOIN users u ON u.id = i.issued_by`;

export async function invoiceById(tenantId: string, id: string) {
  const r = await query<InvoiceRow>(
    `${BASE_SELECT} WHERE i.id=$1 AND i.tenant_id=$2`,
    [id, tenantId],
  );
  const inv = r.rows[0];
  if (!inv) throw HttpError.notFound("Facture introuvable.");
  const items = await query<{
    id: string;
    product_id: string | null;
    product_name: string;
    variant_name: string | null;
    unit_symbol: string | null;
    quantity: number;
    unit_price: number;
    tax_rate: number;
    total_ht: number;
    total_vat: number;
    total_ttc: number;
  }>(
    `SELECT id, product_id, product_name, variant_name, unit_symbol,
            quantity::float, unit_price::float, tax_rate::float,
            total_ht::float, total_vat::float, total_ttc::float
       FROM invoice_items WHERE invoice_id=$1 ORDER BY id`,
    [id],
  );
  return { ...formatInvoice(inv), items: items.rows };
}

/** Facture (et avoirs éventuels) associés à une vente — pour le reçu. */
export async function invoicesForSale(tenantId: string, saleId: string) {
  const r = await query<InvoiceRow>(
    `${BASE_SELECT} WHERE i.sale_id=$1 AND i.tenant_id=$2 ORDER BY i.issued_at ASC, i.seq ASC`,
    [saleId, tenantId],
  );
  return r.rows.map(formatInvoice);
}

export async function listInvoices(
  tenantId: string,
  q: {
    depotId?: string;
    kind?: "INVOICE" | "CREDIT_NOTE";
    from?: string;
    to?: string;
    limit: number;
    offset: number;
  },
) {
  const cond: string[] = ["i.tenant_id=$1"];
  const params: unknown[] = [tenantId];
  if (q.depotId) {
    params.push(q.depotId);
    cond.push(`i.depot_id=$${params.length}`);
  }
  if (q.kind) {
    params.push(q.kind);
    cond.push(`i.kind=$${params.length}`);
  }
  if (q.from) {
    params.push(q.from);
    cond.push(`i.issued_at >= $${params.length}`);
  }
  if (q.to) {
    // Lendemain exclusif calculé en JS (parité pg-mem : pas d'arithmétique SQL)
    params.push(
      new Date(new Date(q.to).getTime() + 86_400_000)
        .toISOString()
        .slice(0, 10),
    );
    cond.push(`i.issued_at < $${params.length}`);
  }
  const where = cond.join(" AND ");
  const total = (
    await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices i WHERE ${where}`,
      params,
    )
  ).rows[0]!.n;
  const rows = await query<InvoiceRow>(
    `${BASE_SELECT} WHERE ${where}
      ORDER BY i.issued_at DESC, i.number DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.limit, q.offset],
  );
  return { rows: rows.rows.map(formatInvoice), total };
}

/** Mentions légales du tenant pour l'imprimé de facture/reçu. */
export async function tenantLegal(tenantId: string) {
  const r = await query<{
    name: string;
    phone: string | null;
    niu: string | null;
    rccm: string | null;
    address: string | null;
    invoice_footer: string | null;
    currency: string;
  }>(
    "SELECT name, phone, niu, rccm, address, invoice_footer, currency FROM tenants WHERE id=$1",
    [tenantId],
  );
  return r.rows[0] ?? null;
}
