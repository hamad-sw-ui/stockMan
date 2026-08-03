import { PoolClient } from "pg";
import { query, withTransaction } from "../config/db";
import { HttpError } from "../lib/errors";
import { writeAudit } from "../lib/audit";
import { AuthUser } from "../middleware/auth";
import { createSale, SaleItemInput, SalePaymentInput } from "./saleService";
import { resolveDepot } from "../lib/resolveDepot";
import { toDateStr } from "../lib/dates";

/**
 * Devis / facture proforma (E3, B2B demi-gros) : pricing SERVEUR identique à
 * la caisse (autorité prix) mais SANS aucun mouvement de stock. Le prix figé
 * du devis est honoré à la conversion (un proforma engage le vendeur).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface QuoteItemInput {
  productId: string;
  variantId?: string | null;
  unitId?: string | null;
  quantity: number;
  discountPct?: number;
}

interface PricedLine {
  productId: string;
  variantId: string | null;
  unitId: string | null;
  quantity: number;
  baseQty: number;
  unitPrice: number;
  lineTotal: number;
}

/** Repricing serveur — même formule que saleService (conversion d'unité,
 *  supplément variante, remise %), sans toucher au stock. */
async function priceItems(
  client: PoolClient,
  tenantId: string,
  items: QuoteItemInput[],
): Promise<{ total: number; lines: PricedLine[] }> {
  const lines: PricedLine[] = [];
  let total = 0;
  for (const item of items) {
    const pr = await client.query<{
      id: string;
      name: string;
      selling_price: string;
      unit_id: string | null;
      archived_at: string | null;
    }>(
      "SELECT id, name, selling_price, unit_id, archived_at FROM products WHERE id=$1 AND tenant_id=$2",
      [item.productId, tenantId],
    );
    const product = pr.rows[0];
    if (!product || product.archived_at)
      throw HttpError.badRequest(
        "PRODUCT_UNKNOWN",
        `Produit introuvable ou archivé (${item.productId}).`,
      );
    let variantId: string | null = null;
    let additional = 0;
    if (item.variantId) {
      const vr = await client.query<{ additional_price: string }>(
        "SELECT additional_price FROM product_variants WHERE id=$1 AND product_id=$2",
        [item.variantId, product.id],
      );
      if (!vr.rows[0])
        throw HttpError.badRequest(
          "VARIANT_UNKNOWN",
          `Variante introuvable pour « ${product.name} ».`,
        );
      variantId = item.variantId;
      additional = parseFloat(vr.rows[0].additional_price);
    }
    const productUnitValue = product.unit_id
      ? parseFloat(
          (
            await client.query<{ base_value: string }>(
              "SELECT base_value FROM units WHERE id=$1 AND tenant_id=$2",
              [product.unit_id, tenantId],
            )
          ).rows[0]?.base_value ?? "1",
        )
      : 1;
    let factor = 1;
    let unitId: string | null = null;
    if (item.unitId) {
      const ur = await client.query<{ id: string; base_value: string }>(
        "SELECT id, base_value FROM units WHERE id=$1 AND tenant_id=$2",
        [item.unitId, tenantId],
      );
      if (!ur.rows[0])
        throw HttpError.badRequest("UNIT_UNKNOWN", "Unité inconnue.");
      unitId = ur.rows[0].id;
      factor = parseFloat(ur.rows[0].base_value) / productUnitValue;
    }
    const baseQty = round2(item.quantity * factor);
    if (baseQty <= 0)
      throw HttpError.badRequest(
        "QUANTITY_INVALID",
        "Quantité convertie invalide.",
      );
    const discount = Math.min(Math.max(item.discountPct ?? 0, 0), 100);
    const unitPrice = round2(
      (parseFloat(product.selling_price) + additional) *
        factor *
        (1 - discount / 100),
    );
    const lineTotal = round2(item.quantity * unitPrice);
    total = round2(total + lineTotal);
    lines.push({
      productId: product.id,
      variantId,
      unitId,
      quantity: item.quantity,
      baseQty,
      unitPrice,
      lineTotal,
    });
  }
  return { total, lines };
}

export interface CreateQuoteInput {
  depotId?: string;
  customerId?: string | null;
  note?: string | null;
  validUntil?: string | null;
  items: QuoteItemInput[];
}

export async function createQuote(user: AuthUser, input: CreateQuoteInput) {
  const depotId = resolveDepot(user, input.depotId);
  return withTransaction(async (client) => {
    if (input.customerId) {
      const c = await client.query(
        "SELECT 1 FROM customers WHERE id=$1 AND tenant_id=$2",
        [input.customerId, user.tenantId],
      );
      if (!c.rows[0])
        throw HttpError.badRequest("CUSTOMER_UNKNOWN", "Client introuvable.");
    }
    const { total, lines } = await priceItems(
      client,
      user.tenantId,
      input.items,
    );
    const q = await client.query<{ id: string }>(
      `INSERT INTO quotes (tenant_id, depot_id, customer_id, total_amount, note, valid_until, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        user.tenantId,
        depotId,
        input.customerId ?? null,
        total,
        input.note ?? null,
        input.validUntil ?? null,
        user.id,
      ],
    );
    const quoteId = q.rows[0]!.id;
    for (const l of lines) {
      await client.query(
        `INSERT INTO quote_items (quote_id, product_id, variant_id, unit_id, quantity, base_qty, unit_price, total_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          quoteId,
          l.productId,
          l.variantId,
          l.unitId,
          l.quantity,
          l.baseQty,
          l.unitPrice,
          l.lineTotal,
        ],
      );
    }
    await writeAudit(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        action: "QUOTE",
        entity: "quote",
        entityId: quoteId,
        depotId,
        newState: { total, lines: lines.length },
      },
      client,
    );
    return quoteById(client, user.tenantId, quoteId);
  });
}

export async function quoteById(
  client: PoolClient,
  tenantId: string,
  quoteId: string,
) {
  const q = await client.query(
    `SELECT q.*, c.name AS customer_name, d.name AS depot_name, usr.name AS created_by_name
       FROM quotes q
       LEFT JOIN customers c ON c.id = q.customer_id
       JOIN depots d ON d.id = q.depot_id
       LEFT JOIN users usr ON usr.id = q.created_by
      WHERE q.id=$1 AND q.tenant_id=$2`,
    [quoteId, tenantId],
  );
  if (!q.rows[0]) throw HttpError.notFound("Devis introuvable.");
  const items = await client.query(
    `SELECT qi.*, p.name AS product_name, v.name AS variant_name, un.symbol AS unit_symbol
       FROM quote_items qi
       JOIN products p ON p.id = qi.product_id
       LEFT JOIN product_variants v ON v.id = qi.variant_id
       LEFT JOIN units un ON un.id = qi.unit_id
      WHERE qi.quote_id=$1 ORDER BY qi.id`,
    [quoteId],
  );
  return { ...q.rows[0], items: items.rows };
}

export interface ConvertQuoteInput {
  paymentMethod?: "CASH" | "MTN_MOMO" | "ORANGE_MONEY";
  payments?: SalePaymentInput[];
  dueDate?: string | null;
  clientSaleId?: string;
}

/**
 * Conversion devis → vente AU PRIX FIGÉ du devis (priceOverride serveur).
 * Anti double-conversion : le passage à CONVERTED est posé AVANT la création
 * de la vente et compensé si celle-ci échoue (transaction séparée de
 * création : createSale est l'autorité d'écriture stock).
 */
export async function convertQuote(
  user: AuthUser,
  quoteId: string,
  input: ConvertQuoteInput,
) {
  // 1) Verrou + lecture (valide le statut et l'expiration)
  const { quote, items } = await withTransaction(async (client) => {
    const q = await client.query<{
      id: string;
      depot_id: string;
      customer_id: string | null;
      status: string;
      valid_until: string | null;
    }>(
      "SELECT id, depot_id, customer_id, status, valid_until FROM quotes WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
      [quoteId, user.tenantId],
    );
    const quote = q.rows[0];
    if (!quote) throw HttpError.notFound("Devis introuvable.");
    if (quote.status !== "DRAFT")
      throw HttpError.conflict(
        "QUOTE_ALREADY_CONVERTED",
        "Ce devis est déjà converti ou annulé.",
      );
    if (quote.valid_until) {
      const today = new Date().toISOString().slice(0, 10);
      const until = toDateStr(quote.valid_until);
      if (until && until < today)
        throw HttpError.conflict(
          "QUOTE_EXPIRED",
          "Ce devis est expiré : recréez-le aux prix du jour.",
        );
    }
    const items = await client.query<{
      product_id: string;
      variant_id: string | null;
      unit_id: string | null;
      quantity: string;
      unit_price: string;
    }>(
      "SELECT product_id, variant_id, unit_id, quantity, unit_price FROM quote_items WHERE quote_id=$1 ORDER BY id",
      [quoteId],
    );
    // Pose immédiate du verrou logique (un 2ᵉ convertisseur échouera dessus)
    await client.query(
      "UPDATE quotes SET status='CONVERTED' WHERE id=$1 AND status='DRAFT'",
      [quoteId],
    );
    return { quote, items: items.rows };
  });

  // 2) Création de la vente (autorité saleService, prix figés honorés)
  try {
    const saleItems: SaleItemInput[] = items.map((i) => ({
      productId: i.product_id,
      variantId: i.variant_id,
      unitId: i.unit_id,
      quantity: parseFloat(i.quantity),
      priceOverride: parseFloat(i.unit_price),
    }));
    const result = await createSale(user, {
      depotId: quote.depot_id,
      items: saleItems,
      paymentMethod: input.paymentMethod ?? "CASH",
      payments: input.payments,
      customerId: quote.customer_id ?? null,
      dueDate: input.dueDate ?? null,
      clientSaleId: input.clientSaleId,
    });
    // 3) Lien devis ↔ vente
    await query("UPDATE quotes SET converted_sale_id=$2 WHERE id=$1", [
      quoteId,
      result.sale.id,
    ]);
    await writeAudit({
      tenantId: user.tenantId,
      userId: user.id,
      userName: user.name,
      action: "QUOTE",
      entity: "quote",
      entityId: quoteId,
      depotId: quote.depot_id,
      newState: { status: "CONVERTED", saleId: result.sale.id },
    });
    return result;
  } catch (err) {
    // Compensation : la vente n'a pas eu lieu → le devis redevient DRAFT
    await query(
      "UPDATE quotes SET status='DRAFT' WHERE id=$1 AND converted_sale_id IS NULL",
      [quoteId],
    );
    throw err;
  }
}
