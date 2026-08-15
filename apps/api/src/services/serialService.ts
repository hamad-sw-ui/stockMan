import { PoolClient } from "pg";
import { query } from "../config/db";
import { writeAudit } from "../lib/audit";
import { HttpError } from "../lib/errors";
import { AuthUser } from "../middleware/auth";

/**
 * E8 — Sérialisation (IMEI / n° de série, électronique & téléphonie).
 *  Un produit sérialisé (requires_serial) se vend À L'UNITÉ identifiée :
 *   - entrée : les numéros sont enregistrés (statut IN_STOCK) au dépôt ;
 *   - vente : les numéros exacts sont validés (présents, en stock, bon dépôt)
 *     puis marqués SOLD avec la ligne de vente (garantie, vol, SAV) ;
 *   - annulation de la vente : les numéros redeviennent IN_STOCK ;
 *   - les retours PARTIELS de lignes sérialisées sont refusés (utiliser
 *     l'annulation totale puis une nouvelle vente — un numéro est
 *     indivisible).
 */

export interface SerialRow {
  id: string;
  product_id: string;
  product_name?: string;
  variant_id: string | null;
  depot_id: string;
  depot_name?: string;
  serial: string;
  status: "IN_STOCK" | "SOLD";
  sale_item_id: string | null;
  sold_at: string | null;
  created_at: string;
}

/** Enregistre des numéros en stock (réception ou saisie dédiée). */
export async function registerSerials(
  client: PoolClient,
  args: {
    tenantId: string;
    depotId: string;
    productId: string;
    variantId?: string | null;
    serials: string[];
  },
): Promise<number> {
  const clean = [...new Set(args.serials.map((s) => s.trim()).filter(Boolean))];
  if (clean.length === 0) return 0;
  // Doublons existants (même produit) → refus explicite liste à l'appui
  const ph = clean.map((_, i) => `$${i + 3}`).join(",");
  const dup = await client.query<{ serial: string }>(
    `SELECT serial FROM product_serials
      WHERE tenant_id=$1 AND product_id=$2 AND serial IN (${ph})`,
    [args.tenantId, args.productId, ...clean],
  );
  if (dup.rows.length > 0) {
    throw HttpError.conflict(
      "SERIAL_DUPLICATE",
      `Numéro(s) de série déjà enregistré(s) : ${dup.rows
        .map((r) => r.serial)
        .slice(0, 5)
        .join(", ")}.`,
      { serials: dup.rows.map((r) => r.serial) },
    );
  }
  for (const s of clean) {
    await client.query(
      `INSERT INTO product_serials (tenant_id, product_id, variant_id, depot_id, serial)
       VALUES ($1,$2,$3,$4,$5)`,
      [args.tenantId, args.productId, args.variantId ?? null, args.depotId, s],
    );
  }
  return clean.length;
}

/** Valide et vend les numéros exacts d'une ligne (transaction de vente). */
export async function markSerialsSold(
  client: PoolClient,
  args: {
    tenantId: string;
    depotId: string;
    productId: string;
    variantId: string | null;
    saleItemId: string;
    serials: string[];
  },
): Promise<void> {
  const ph = args.serials.map((_, i) => `$${i + 3}`).join(",");
  const found = await client.query<SerialRow>(
    `SELECT * FROM product_serials
      WHERE tenant_id=$1 AND product_id=$2 AND serial IN (${ph})
      FOR UPDATE`,
    [args.tenantId, args.productId, ...args.serials],
  );
  const bySerial = new Map(found.rows.map((r) => [r.serial, r]));
  for (const s of args.serials) {
    const row = bySerial.get(s);
    if (!row)
      throw HttpError.badRequest(
        "SERIAL_UNKNOWN",
        `Numéro de série inconnu pour ce produit : « ${s} ».`,
      );
    if (row.status !== "IN_STOCK")
      throw HttpError.conflict(
        "SERIAL_NOT_AVAILABLE",
        `Le numéro « ${s} » n'est pas en stock (statut : ${row.status}).`,
      );
    if (row.depot_id !== args.depotId)
      throw HttpError.conflict(
        "SERIAL_WRONG_DEPOT",
        `Le numéro « ${s} » n'est pas stocké sur ce dépôt.`,
      );
  }
  for (const s of args.serials) {
    await client.query(
      `UPDATE product_serials
          SET status='SOLD', sale_item_id=$2, sold_at=now()
        WHERE tenant_id=$1 AND serial=$3 AND product_id=$4`,
      [args.tenantId, args.saleItemId, s, args.productId],
    );
  }
}

/** Annulation de vente : les numéros vendus repassent en stock. */
export async function releaseSerialsOfSale(
  client: PoolClient,
  tenantId: string,
  saleId: string,
): Promise<number> {
  const r = await client.query<{ id: string }>(
    `UPDATE product_serials SET status='IN_STOCK', sale_item_id=NULL, sold_at=NULL
      WHERE tenant_id=$1 AND status='SOLD'
        AND sale_item_id IN (SELECT id FROM sale_items WHERE sale_id=$2)
      RETURNING id`,
    [tenantId, saleId],
  );
  return r.rows.length;
}

/**
 * Retour INTÉGRAL d'une ligne sérialisée : les numéros vendus sur cette
 * ligne repassent en stock (le retour partiel est refusé en amont —
 * indivisibilité d'un numéro de série).
 */
export async function releaseSerialsOfSaleItem(
  client: PoolClient,
  tenantId: string,
  saleItemId: string,
): Promise<number> {
  const r = await client.query<{ id: string }>(
    `UPDATE product_serials SET status='IN_STOCK', sale_item_id=NULL, sold_at=NULL
      WHERE tenant_id=$1 AND status='SOLD' AND sale_item_id=$2
      RETURNING id`,
    [tenantId, saleItemId],
  );
  return r.rows.length;
}

/** Consultation garantie/SAV : où est ce numéro, vendu quand et à qui ? */
export async function lookupSerial(tenantId: string, serial: string) {
  const r = await query<
    SerialRow & { product_name: string; depot_name: string }
  >(
    `SELECT ps.*, p.name AS product_name, d.name AS depot_name
       FROM product_serials ps
       JOIN products p ON p.id = ps.product_id
       JOIN depots d ON d.id = ps.depot_id
      WHERE ps.tenant_id=$1 AND ps.serial=$2
      ORDER BY ps.created_at DESC LIMIT 5`,
    [tenantId, serial.trim()],
  );
  const row = r.rows[0];
  if (!row) throw HttpError.notFound("Numéro de série introuvable.");
  // Détails de vente éventuels (client, n° facture) — requêtes séparées.
  let saleInfo: {
    saleId: string;
    at: string;
    customer: string | null;
    invoice: string | null;
  } | null = null;
  if (row.sale_item_id) {
    const s = await query<{
      sale_id: string;
      at: string;
      customer: string | null;
    }>(
      `SELECT s.id AS sale_id, s.created_at AS at, c.name AS customer
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         LEFT JOIN customers c ON c.id = s.customer_id
        WHERE si.id=$1`,
      [row.sale_item_id],
    );
    if (s.rows[0]) {
      const inv = await query<{ number: string }>(
        "SELECT number FROM invoices WHERE sale_id=$1 AND tenant_id=$2 AND kind='INVOICE'",
        [s.rows[0].sale_id, tenantId],
      );
      saleInfo = {
        saleId: s.rows[0].sale_id,
        at: s.rows[0].at,
        customer: s.rows[0].customer,
        invoice: inv.rows[0]?.number ?? null,
      };
    }
  }
  return {
    id: row.id,
    serial: row.serial,
    status: row.status,
    productId: row.product_id,
    productName: row.product_name,
    depotId: row.depot_id,
    depotName: row.depot_name,
    soldAt: row.sold_at,
    sale: saleInfo,
  };
}

/** Numéros en stock d'un produit/dépôt (aide à la vente, étiquetage). */
export async function serialsInStock(
  tenantId: string,
  productId: string,
  depotId?: string,
) {
  const r = await query<SerialRow & { depot_name: string }>(
    `SELECT ps.*, d.name AS depot_name
       FROM product_serials ps JOIN depots d ON d.id = ps.depot_id
      WHERE ps.tenant_id=$1 AND ps.product_id=$2 AND ps.status='IN_STOCK'
        ${depotId ? "AND ps.depot_id=$3" : ""}
      ORDER BY ps.serial`,
    depotId ? [tenantId, productId, depotId] : [tenantId, productId],
  );
  return r.rows;
}

/** Audit d'enregistrement série (traçabilité des entrées). */
export async function auditSerials(
  client: PoolClient,
  user: AuthUser,
  productId: string,
  count: number,
  depotId: string,
): Promise<void> {
  await writeAudit(
    {
      tenantId: user.tenantId,
      userId: user.id,
      userName: user.name,
      action: "SERIAL",
      entity: "product_serial",
      entityId: productId,
      depotId,
      newState: { registered: count },
    },
    client,
  );
}
