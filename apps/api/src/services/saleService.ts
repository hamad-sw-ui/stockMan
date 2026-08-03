import { PoolClient } from "pg";
import { query, withTransaction } from "../config/db";
import { getEnv } from "../config/env";
import { HttpError } from "../lib/errors";
import { writeAudit } from "../lib/audit";
import { AuthUser } from "../middleware/auth";
import {
  decreaseLevel,
  fefoConsume,
  lockLevelReserved,
  recordMovement,
  restock,
  StockScope,
} from "./stockService";
import {
  applyInflowCost,
  currentAvgCost,
  effectiveBatchCost,
} from "./costingService";
import { assertDepotNotFrozen } from "./inventoryService";
import { getOpenSession, isSessionRequired } from "./cashSessionService";
import {
  groupInvoiceLines,
  invoicesForSale,
  issueCreditNote,
  issueInvoiceForSale,
  vatSplit,
} from "./invoiceService";
import {
  effectiveMaxDiscount,
  loadUserDiscountCap,
  resolveLinePrice,
} from "./pricingService";
import {
  markSerialsSold,
  releaseSerialsOfSale,
  releaseSerialsOfSaleItem,
} from "./serialService";

export interface SaleItemInput {
  productId: string;
  variantId?: string | null;
  unitId?: string | null;
  quantity: number;
  discountPct?: number;
  /** E8 — produit sérialisé (IMEI) : numéros EXACTS vendus (qté = nb de
   *  numéros, en unité de base). */
  serialNumbers?: string[];
  /** Prix unitaire (unité de vente) imposé SERVEUR-SERVEUR — réservé à la
   *  conversion de devis (le prix figé du devis est honoré). Jamais accepté
   *  depuis le schéma client de l'API. */
  priceOverride?: number;
}

export interface SalePaymentInput {
  method: "CASH" | "MTN_MOMO" | "ORANGE_MONEY";
  amount: number;
  reference?: string;
  clientPaymentId?: string;
}

export interface CreateSaleInput {
  depotId?: string;
  items: SaleItemInput[];
  /** Méthode principale / prévue (exigée aussi pour une vente 100 % crédit :
   *  c'est la méthode probable du règlement). */
  paymentMethod: "CASH" | "MTN_MOMO" | "ORANGE_MONEY";
  paymentReference?: string;
  clientSaleId?: string;
  createdAt?: string;
  amountReceived?: number;
  customerId?: string | null;
  dueDate?: string | null; // échéance du crédit (YYYY-MM-DD)
  /** Versements initiaux (paiement mixte). Omis = un versement unique
   *  intégral de la méthode principale (comportement historique). */
  payments?: SalePaymentInput[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Dépôt effectif de l'opération — implémentation partagée (lib/resolveDepot)
 *  ré-exportée pour compatibilité des imports existants. */
import { resolveDepot } from "../lib/resolveDepot";
export { resolveDepot };

interface ProductRow {
  id: string;
  name: string;
  selling_price: string;
  tax_rate: string; // E7 — taux de TVA (%) du produit, figé sur la ligne
  wholesale_price: string | null; // E8 — grille de gros
  wholesale_min_qty: string;
  requires_serial: boolean; // E8 — vente à l'unité identifiée (IMEI)
  unit_id: string | null;
  archived_at: string | null;
  has_variants: boolean;
}

async function loadUnit(client: PoolClient, tenantId: string, unitId: string) {
  const r = await client.query<{
    id: string;
    base_value: string;
    symbol: string;
  }>("SELECT id, base_value, symbol FROM units WHERE id=$1 AND tenant_id=$2", [
    unitId,
    tenantId,
  ]);
  const u = r.rows[0];
  if (!u)
    throw HttpError.badRequest(
      "UNIT_UNKNOWN",
      "Unité inconnue pour ce tenant.",
    );
  return u;
}

async function fullSaleById(
  client: PoolClient,
  tenantId: string,
  saleId: string,
) {
  const s = await client.query(
    `SELECT s.*, u.name AS vendor_name, d.name AS depot_name,
            c.name AS customer_name, c.phone AS customer_phone
       FROM sales s JOIN users u ON u.id = s.vendor_id JOIN depots d ON d.id = s.depot_id
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id=$1 AND s.tenant_id=$2`,
    [saleId, tenantId],
  );
  if (s.rows.length === 0) throw HttpError.notFound("Vente introuvable.");
  const items = await client.query(
    `SELECT si.*, p.name AS product_name, p.requires_serial, v.name AS variant_name, un.symbol AS unit_symbol,
            bt.batch_number
       FROM sale_items si
       JOIN products p ON p.id = si.product_id
       LEFT JOIN product_variants v ON v.id = si.variant_id
       LEFT JOIN units un ON un.id = si.unit_id
       LEFT JOIN stock_batches bt ON bt.id = si.batch_id
      WHERE si.sale_id=$1 ORDER BY si.id`,
    [saleId],
  );
  const payments = await client.query(
    `SELECT id, method, amount::float, reference, created_at
       FROM sale_payments WHERE sale_id=$1 ORDER BY created_at ASC, id ASC`,
    [saleId],
  );
  return { ...s.rows[0], items: items.rows, payments: payments.rows };
}

/**
 * Création de vente — autorité serveur (corrige SEC-06/SEC-07) :
 *  - prix et total RECALCULÉS depuis la base ;
 *  - idempotence par `clientSaleId` (retry offline = même vente renvoyée) ;
 *  - FEFO transactionnel + niveaux de stock + mouvements.
 */
export async function createSale(user: AuthUser, input: CreateSaleInput) {
  const depotId = resolveDepot(user, input.depotId);
  const env = getEnv();

  // Idempotence : même clientSaleId → même vente, jamais de doublon.
  if (input.clientSaleId) {
    const dup = await query(
      "SELECT id FROM sales WHERE tenant_id=$1 AND client_sale_id=$2",
      [user.tenantId, input.clientSaleId],
    );
    if (dup.rows[0]) {
      const sale = await withTransaction((c) =>
        fullSaleById(c, user.tenantId, dup.rows[0]!.id),
      );
      return { sale, deduplicated: true };
    }
  }

  // Borne de la date métier (anti antidatation / sync offline)
  if (input.createdAt) {
    const ts = new Date(input.createdAt);
    if (Number.isNaN(ts.getTime()))
      throw HttpError.badRequest("DATE_INVALID", "Date de vente invalide.");
    const ageH = (Date.now() - ts.getTime()) / 3600000;
    if (ageH < -0.25)
      throw HttpError.badRequest(
        "DATE_FUTURE",
        "Une vente ne peut pas être datée dans le futur.",
      );
    if (ageH > env.MAX_SYNC_AGE_HOURS) {
      throw HttpError.badRequest(
        "SALE_TOO_OLD",
        `Vente trop ancienne pour la synchronisation (> ${env.MAX_SYNC_AGE_HOURS} h).`,
      );
    }
  }

  return withTransaction(async (client) => {
    // Dépôt actif obligatoire
    const depotCheck = await client.query(
      "SELECT is_active, name FROM depots WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
      [depotId, user.tenantId],
    );
    if (!depotCheck.rows[0])
      throw HttpError.badRequest("DEPOT_UNKNOWN", "Dépôt introuvable.");
    if (!depotCheck.rows[0].is_active)
      throw HttpError.badRequest("DEPOT_INACTIVE", "Ce dépôt est désactivé.");

    // Gel inventaire (E5) : aucune vente pendant un comptage « gelé ».
    await assertDepotNotFrozen(client, user.tenantId, depotId);

    // Session de caisse (E6) : la vente se rattache à la session ouverte ;
    // si le tenant exige une session, vendre hors caisse est interdit.
    const session = await getOpenSession(client, user.tenantId, depotId);
    if (!session && (await isSessionRequired(user.tenantId))) {
      throw HttpError.conflict(
        "NO_CASH_SESSION",
        "Aucune session de caisse ouverte sur ce dépôt — ouvrez la caisse avant de vendre.",
      );
    }
    const cashSessionId = session?.id ?? null;

    // Client : obligatoire dès qu'une part reste à crédit (E3), et canal de
    // prix pour la grille gros/détail (E8) — chargé AVANT la boucle des
    // lignes (le prix dépend du canal).
    let customer: {
      id: string;
      name: string;
      balance: number;
      credit_limit: number;
      price_channel: "DETAIL" | "WHOLESALE";
    } | null = null;
    if (input.customerId) {
      const cr = await client.query<{
        id: string;
        name: string;
        balance: number;
        credit_limit: number;
        price_channel: "DETAIL" | "WHOLESALE";
      }>(
        "SELECT id, name, balance::float, credit_limit::float, price_channel FROM customers WHERE id=$1 AND tenant_id=$2 AND is_active FOR UPDATE",
        [input.customerId, user.tenantId],
      );
      customer = cr.rows[0] ?? null;
      if (!customer)
        throw HttpError.badRequest(
          "CUSTOMER_UNKNOWN",
          "Client introuvable ou désactivé.",
        );
    }

    let total = 0;
    // E8 — plafond de remise manuelle de l'utilisateur (chargé une fois,
    // uniquement si une ligne demande une remise).
    let discountCap: number | null = null;
    const prepared: Array<{
      product: ProductRow;
      variantId: string | null;
      variantName: string | null; // instantané pour la facture (E7)
      unitId: string | null;
      unitSymbol: string | null;
      quantity: number;
      factor: number;
      baseQty: number;
      unitPrice: number;
      lineTotal: number;
      promoPct: number; // E8 — remise promotionnelle appliquée (figée)
      promoName: string | null;
      serialNumbers: string[] | null; // E8 — IMEI vendus (produit sérialisé)
    }> = [];

    for (const item of input.items) {
      const pr = await client.query<ProductRow>(
        `SELECT id, name, selling_price, tax_rate, wholesale_price, wholesale_min_qty,
                requires_serial, unit_id, archived_at, has_variants
           FROM products WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [item.productId, user.tenantId],
      );
      const product = pr.rows[0];
      if (!product || product.archived_at) {
        throw HttpError.badRequest(
          "PRODUCT_UNKNOWN",
          `Produit introuvable ou archivé (${item.productId}).`,
        );
      }

      let variantId: string | null = null;
      let variantName: string | null = null;
      let additional = 0;
      if (item.variantId) {
        const vr = await client.query<{
          additional_price: string;
          name: string;
        }>(
          "SELECT additional_price, name FROM product_variants WHERE id=$1 AND product_id=$2",
          [item.variantId, product.id],
        );
        if (!vr.rows[0])
          throw HttpError.badRequest(
            "VARIANT_UNKNOWN",
            `Variante introuvable pour « ${product.name} ».`,
          );
        variantId = item.variantId;
        variantName = vr.rows[0].name;
        additional = parseFloat(vr.rows[0].additional_price);
      }

      // Conversion d'unité : base_qty = qty × (base_value unité de vente / base_value unité produit)
      const productUnitValue = product.unit_id
        ? parseFloat(
            (await loadUnit(client, user.tenantId, product.unit_id)).base_value,
          )
        : 1;
      let unitId: string | null = null;
      let unitSymbol: string | null = null;
      let factor = 1;
      if (item.unitId) {
        const saleUnit = await loadUnit(client, user.tenantId, item.unitId);
        unitId = saleUnit.id;
        unitSymbol = saleUnit.symbol;
        factor = parseFloat(saleUnit.base_value) / productUnitValue;
      }
      const baseQty = round2(item.quantity * factor);
      if (baseQty <= 0)
        throw HttpError.badRequest(
          "QUANTITY_INVALID",
          "Quantité convertie invalide.",
        );

      // ---- E8 : produit sérialisé (IMEI) — unité de base uniquement, ------
      // quantité entière = nombre de numéros fournis.
      let serialNumbers: string[] | null = null;
      if (product.requires_serial) {
        if (factor !== 1)
          throw HttpError.badRequest(
            "SERIAL_BASE_UNIT_ONLY",
            `« ${product.name} » est sérialisé : vente à l'unité de base uniquement.`,
          );
        if (!Number.isInteger(item.quantity))
          throw HttpError.badRequest(
            "SERIAL_QTY_INTEGER",
            `« ${product.name} » est sérialisé : quantité entière attendue.`,
          );
        serialNumbers = (item.serialNumbers ?? [])
          .map((s) => s.trim())
          .filter(Boolean);
        if (new Set(serialNumbers).size !== serialNumbers.length)
          throw HttpError.badRequest(
            "SERIAL_DUP_IN_LINE",
            "Un même numéro de série apparaît deux fois dans la ligne.",
          );
        if (serialNumbers.length !== Math.round(baseQty))
          throw HttpError.badRequest(
            "SERIAL_COUNT_MISMATCH",
            `« ${product.name} » : ${Math.round(baseQty)} numéro(s) de série attendu(s), ${serialNumbers.length} fourni(s).`,
          );
      }

      const discount = Math.min(Math.max(item.discountPct ?? 0, 0), 100);
      // E8 — plafond de remise manuelle (403 explicite au dépassement)
      if (discount > 0) {
        discountCap ??= effectiveMaxDiscount({
          role: user.role,
          maxDiscountPct: await loadUserDiscountCap(client, user.id),
        });
        if (discount > discountCap + 1e-9)
          throw HttpError.forbidden(
            `Remise de ${discount} % supérieure à votre plafond (${discountCap} %).`,
            "DISCOUNT_LIMIT_EXCEEDED",
          );
      }

      // ---- Prix : figé devis > grille gros/promo datée > catalogue (E8) ---
      let unitPrice: number;
      let lineTotal: number;
      let promoPct = 0;
      let promoName: string | null = null;
      if (item.priceOverride !== undefined) {
        unitPrice = round2(item.priceOverride * (1 - discount / 100));
        lineTotal = round2(
          item.quantity * item.priceOverride * (1 - discount / 100),
        );
      } else {
        const resolved = await resolveLinePrice(client, {
          tenantId: user.tenantId,
          productId: product.id,
          detailUnitTtc: parseFloat(product.selling_price) + additional,
          wholesalePrice:
            product.wholesale_price == null
              ? null
              : parseFloat(product.wholesale_price),
          wholesaleMinQty: parseFloat(product.wholesale_min_qty),
          customerChannel: customer?.price_channel ?? "DETAIL",
          baseQty,
          at: input.createdAt ? new Date(input.createdAt) : undefined,
        });
        promoPct = resolved.promoPct;
        promoName = resolved.promoName;
        unitPrice = round2(resolved.unitTtc * factor * (1 - discount / 100));
        lineTotal = round2(resolved.unitTtc * baseQty * (1 - discount / 100));
      }
      total = round2(total + lineTotal);

      prepared.push({
        product,
        variantId,
        variantName,
        unitId,
        unitSymbol,
        quantity: item.quantity,
        factor,
        baseQty,
        unitPrice,
        lineTotal,
        promoPct,
        promoName,
        serialNumbers,
      });
    }

    // ---------------------------- CRÉDIT & VERSEMENTS (E3) -----------------
    // Versements initiaux : liste fournie (mixte ; liste VIDE = vente 100 %
    // crédit, aucun versement initial) ou versement unique implicite intégral
    // de la méthode principale (comportement historique préservé).
    const payments: SalePaymentInput[] =
      input.payments !== undefined
        ? input.payments
        : [{ method: input.paymentMethod, amount: total }];
    for (const pay of payments) {
      if (!(pay.amount > 0))
        throw HttpError.badRequest(
          "PAYMENT_INVALID",
          "Chaque versement doit être strictement positif.",
        );
    }
    const received = round2(payments.reduce((a, p) => a + p.amount, 0));
    if (received > total + 1e-9) {
      // Seul un paiement CASH unique peut excéder le total (monnaie à rendre) ;
      // le comptant excédentaire est ensuite géré en caisse.
      if (!(payments.length === 1 && payments[0]!.method === "CASH")) {
        throw HttpError.badRequest(
          "OVERPAY_INVALID",
          "Le total des versements dépasse le montant de la vente (sauf monnaie espèces).",
        );
      }
    }
    const amountPaid = Math.min(total, received);
    const credit = round2(total - amountPaid);
    const paymentStatus =
      credit > 1e-9 ? (amountPaid > 1e-9 ? "PARTIAL" : "CREDIT") : "PAID";

    if (credit > 1e-9) {
      if (!customer)
        throw HttpError.badRequest(
          "CREDIT_REQUIRES_CUSTOMER",
          "Une vente à crédit (ou partiellement payée) exige un client.",
        );
      if (
        customer.credit_limit > 0 &&
        round2(customer.balance + credit) > customer.credit_limit + 1e-9
      ) {
        throw HttpError.conflict(
          "CREDIT_LIMIT_EXCEEDED",
          `Plafond de crédit dépassé pour « ${customer.name} » (solde ${customer.balance}, plafond ${customer.credit_limit}).`,
          { balance: customer.balance, creditLimit: customer.credit_limit },
        );
      }
      await client.query(
        "UPDATE customers SET balance = balance + $2, updated_at=now() WHERE id=$1",
        [customer.id, credit],
      );
    }

    const saleIns = await client.query<{ id: string }>(
      `INSERT INTO sales (tenant_id, depot_id, vendor_id, total_amount, payment_method, payment_reference, client_sale_id, created_at,
                          customer_id, due_date, payment_status, amount_paid, cash_session_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::timestamptz, now()), $9,$10,$11,$12,$13) RETURNING id`,
      [
        user.tenantId,
        depotId,
        user.id,
        total,
        input.paymentMethod,
        input.paymentReference ?? null,
        input.clientSaleId ?? null,
        input.createdAt ?? null,
        customer?.id ?? null,
        input.dueDate ?? null,
        paymentStatus,
        amountPaid,
        cashSessionId,
      ],
    );
    const saleId = saleIns.rows[0]!.id;
    // E7 — ventilation TVA : taux figé par ligne, HT/TVA exacts, facture
    // émise dans la même transaction (numérotation continue et verrouillée).
    let saleHt = 0;
    let saleVat = 0;
    const invoiceLines: Array<{
      productId: string | null;
      productName: string;
      variantName: string | null;
      unitSymbol: string | null;
      quantity: number;
      unitPrice: number;
      taxRate: number;
      totalTtc: number;
    }> = [];

    for (const pay of payments) {
      await client.query(
        `INSERT INTO sale_payments (tenant_id, sale_id, customer_id, method, amount, reference, received_by, created_at, cash_session_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::timestamptz, now()), $9)`,
        [
          user.tenantId,
          saleId,
          customer?.id ?? null,
          pay.method,
          pay.amount,
          pay.reference ?? input.paymentReference ?? null,
          user.id,
          input.createdAt ?? null,
          cashSessionId,
        ],
      );
    }

    for (const p of prepared) {
      const scope: StockScope = {
        tenantId: user.tenantId,
        depotId,
        productId: p.product.id,
        variantId: p.variantId,
      };
      // E8 — stock réservé : la vente ne peut pas entamer les quantités
      // réservées (préparation de commandes, mises de côté clients). La garde
      // ne parle QUE si la réservation est le facteur bloquant : un stock
      // globalement insuffisant conserve le code historique STOCK_INSUFFICIENT
      // émis par fefoConsume (compat client POS hors-ligne).
      const avail = await lockLevelReserved(client, scope);
      if (
        p.baseQty <= avail.quantity + 1e-9 &&
        p.baseQty > avail.quantity - avail.reserved + 1e-9
      )
        throw HttpError.conflict(
          "STOCK_RESERVED",
          `« ${p.product.name} » : ${round2(avail.reserved)} réservée(s) — disponible à la vente ${round2(Math.max(0, avail.quantity - avail.reserved))}.`,
        );
      // FEFO : la consommation par lot renvoie lot + coût du lot (E1/E2).
      const deductions = await fefoConsume(client, scope, p.baseQty);
      const lvl = await decreaseLevel(client, scope, p.baseQty); // source de vérité
      const avg = await currentAvgCost(client, user.tenantId, p.product.id);

      // Une ligne de vente PAR LOT prélevé (traçabilité + coût figé exact) ;
      // sans lots gérés : une ligne unique au CUMP du jour. La dernière ligne
      // absorbe l'écart d'arrondi pour un total exact.
      const lines: Array<{
        batchId: string | null;
        unitCost: number;
        baseQty: number;
        qtySell: number;
        lineTotal: number;
      }> = [];
      if (deductions.length > 0) {
        let assignedQty = 0;
        let assignedTotal = 0;
        deductions.forEach((d, idx) => {
          const isLast = idx === deductions.length - 1;
          const qtySell = isLast
            ? round2(p.quantity - assignedQty)
            : round2(d.deducted / p.factor);
          const lineTotal = isLast
            ? round2(p.lineTotal - assignedTotal)
            : round2(p.unitPrice * qtySell);
          assignedQty += qtySell;
          assignedTotal += lineTotal;
          lines.push({
            batchId: d.batchId,
            unitCost: effectiveBatchCost(d.unitCost, avg),
            baseQty: d.deducted,
            qtySell,
            lineTotal,
          });
        });
      } else {
        lines.push({
          batchId: null,
          unitCost: avg,
          baseQty: p.baseQty,
          qtySell: p.quantity,
          lineTotal: p.lineTotal,
        });
      }

      let consumed = 0;
      let firstSaleItemId: string | null = null;
      for (const line of lines) {
        const taxRate = parseFloat(p.product.tax_rate);
        const { ht: lineHt, vat: lineVat } = vatSplit(line.lineTotal, taxRate);
        saleHt = round2(saleHt + lineHt);
        saleVat = round2(saleVat + lineVat);
        invoiceLines.push({
          productId: p.product.id,
          productName: p.product.name,
          variantName: p.variantName,
          unitSymbol: p.unitSymbol,
          quantity: line.qtySell,
          unitPrice: p.unitPrice,
          taxRate,
          totalTtc: line.lineTotal,
        });
        const insItem = await client.query<{ id: string }>(
          `INSERT INTO sale_items (sale_id, product_id, variant_id, unit_id, quantity, base_qty, unit_price, total_price, unit_cost, batch_id,
                                   tax_rate, total_ht, total_vat, promo_pct)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
          [
            saleId,
            p.product.id,
            p.variantId,
            p.unitId,
            line.qtySell,
            line.baseQty,
            p.unitPrice,
            line.lineTotal,
            line.unitCost,
            line.batchId,
            taxRate,
            lineHt,
            lineVat,
            p.promoPct > 0 ? p.promoPct : null,
          ],
        );
        firstSaleItemId ??= insItem.rows[0]!.id;
        const prevStock = round2(lvl.previous - consumed);
        consumed = round2(consumed + line.baseQty);
        await recordMovement(client, {
          ...scope,
          userId: user.id,
          type: "SALE",
          quantity: line.baseQty,
          previousStock: prevStock,
          newStock: round2(prevStock - line.baseQty),
          referenceId: saleId,
          batchId: line.batchId,
          unitCost: line.unitCost,
        });
      }
      // E8 — IMEI : les numéros exacts sont marqués vendus (garantie/SAV),
      // rattachés à la première ligne de vente du produit.
      if (p.serialNumbers && firstSaleItemId) {
        await markSerialsSold(client, {
          tenantId: user.tenantId,
          depotId,
          productId: p.product.id,
          variantId: p.variantId,
          saleItemId: firstSaleItemId,
          serials: p.serialNumbers,
        });
      }
    }

    // E7 — totaux ventilés figés sur la vente…
    await client.query(
      "UPDATE sales SET total_ht=$2, total_vat=$3 WHERE id=$1",
      [saleId, saleHt, saleVat],
    );
    // …et facture légale émise dans la même transaction (continuité FAC).
    const invoice = await issueInvoiceForSale(client, {
      tenantId: user.tenantId,
      depotId,
      depotName: depotCheck.rows[0]!.name,
      saleId,
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? null,
      issuedBy: user.id,
      issuedAt: input.createdAt ?? new Date().toISOString(),
      lines: invoiceLines,
    });

    await writeAudit(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        action: "SALE",
        entity: "sale",
        entityId: saleId,
        depotId,
        newState: {
          total,
          totalHt: saleHt,
          totalVat: saleVat,
          invoice: invoice.number,
          paymentMethod: input.paymentMethod,
          items: prepared.length,
        },
      },
      client,
    );

    const sale = await fullSaleById(client, user.tenantId, saleId);
    return { sale, deduplicated: false };
  });
}

/** Annulation (avoir) : ADMIN uniquement, même jour par défaut. */
export async function voidSale(
  user: AuthUser,
  saleId: string,
  reason?: string,
) {
  return withTransaction(async (client) => {
    const sale = await fullSaleById(client, user.tenantId, saleId);
    if (sale.status === "VOIDED")
      throw HttpError.conflict(
        "ALREADY_VOIDED",
        "Cette vente est déjà annulée.",
      );

    const sameDay =
      new Date(sale.created_at).toDateString() === new Date().toDateString();
    if (!sameDay && user.role !== "SUPER_ADMIN") {
      throw HttpError.forbidden(
        "Annulation limitée au jour même de la vente.",
        "VOID_WINDOW",
      );
    }
    // Journée verrouillée (E6) : le Z de la session d'origine est émis —
    // l'annulation d'une vente de cette journée est verrouillée.
    if (sale.cash_session_id && user.role !== "SUPER_ADMIN") {
      const sess = await client.query<{ status: string }>(
        "SELECT status FROM cash_sessions WHERE id=$1",
        [sale.cash_session_id],
      );
      if (sess.rows[0]?.status === "CLOSED") {
        throw HttpError.conflict(
          "SESSION_DAY_LOCKED",
          "Journée clôturée : le Z de caisse est émis, l'annulation est verrouillée.",
        );
      }
    }
    // Gel inventaire (E5) : l'annulation recrédite le stock.
    await assertDepotNotFrozen(client, user.tenantId, sale.depot_id);

    await client.query("UPDATE sales SET status='VOIDED' WHERE id=$1", [
      saleId,
    ]);
    // E8 — les numéros de série vendus repassent en stock (indivisibles).
    await releaseSerialsOfSale(client, user.tenantId, saleId);
    // Libération du crédit client : la part non réglée de la vente annulée
    // ne doit plus peser sur son solde (les versements déjà encaissés restent
    // tracés — la restitution d'espèces est une opération de caisse manuelle).
    if (sale.customer_id) {
      const outstanding = round2(
        parseFloat(sale.total_amount) - parseFloat(sale.amount_paid),
      );
      if (outstanding > 1e-9) {
        const cb = await client.query<{ balance: number }>(
          "SELECT balance::float FROM customers WHERE id=$1 FOR UPDATE",
          [sale.customer_id],
        );
        const nb = Math.max(
          0,
          round2((cb.rows[0]?.balance ?? 0) - outstanding),
        );
        await client.query(
          "UPDATE customers SET balance=$2, updated_at=now() WHERE id=$1",
          [sale.customer_id, nb],
        );
      }
    }
    for (const item of sale.items) {
      const scope: StockScope = {
        tenantId: user.tenantId,
        depotId: sale.depot_id,
        productId: item.product_id,
        variantId: item.variant_id,
      };
      const lineQty = parseFloat(item.base_qty);
      const lineCost = Number(item.unit_cost) || 0;
      // Réintégration valorisée : CUMP ré-pondéré (entrée au coût figé de la
      // ligne) AVANT la hausse physique, puis recrédit du lot d'origine.
      await applyInflowCost(
        client,
        user.tenantId,
        item.product_id,
        lineQty,
        lineCost,
      );
      const lvl = await restock(client, scope, lineQty, {
        batchId: item.batch_id,
      });
      await recordMovement(client, {
        ...scope,
        userId: user.id,
        type: "VOID",
        quantity: lineQty,
        previousStock: lvl.previous,
        newStock: lvl.next,
        reason: reason ?? "Annulation de vente",
        referenceId: saleId,
        batchId: item.batch_id,
        unitCost: lineCost,
      });
    }
    // E7 — avoir (note de crédit) : la facture d'origine est IMMUABLE,
    // l'annulation émet un AV-… qui la référence (réplique exacte des lignes,
    // taux de TVA d'origine figés sur les lignes de vente).
    await issueCreditNote(client, {
      tenantId: user.tenantId,
      depotId: sale.depot_id,
      depotName: sale.depot_name,
      saleId,
      customerId: sale.customer_id,
      customerName: sale.customer_name ?? null,
      issuedBy: user.id,
      lines: groupInvoiceLines(
        sale.items.map(
          (i: {
            product_id: string;
            product_name: string;
            variant_name: string | null;
            unit_symbol: string | null;
            quantity: string;
            unit_price: string;
            total_price: string;
            tax_rate: string | null;
          }) => ({
            productId: i.product_id,
            productName: i.product_name,
            variantName: i.variant_name,
            unitSymbol: i.unit_symbol,
            quantity: parseFloat(i.quantity),
            unitPrice: parseFloat(i.unit_price),
            taxRate: Number(i.tax_rate) || 19.25,
            totalTtc: parseFloat(i.total_price),
          }),
        ),
      ),
      note: reason ?? "Annulation de vente",
    });

    await writeAudit(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        action: "VOID",
        entity: "sale",
        entityId: saleId,
        depotId: sale.depot_id,
        previousState: { status: "COMPLETED", total: sale.total_amount },
        newState: { status: "VOIDED" },
        details: reason,
      },
      client,
    );
    return fullSaleById(client, user.tenantId, saleId);
  });
}

/** Retour partiel : restocke et journalise, vente conservée. */
export async function returnSaleItems(
  user: AuthUser,
  saleId: string,
  items: Array<{ saleItemId: string; baseQty: number }>,
  reason?: string,
) {
  return withTransaction(async (client) => {
    const sale = await fullSaleById(client, user.tenantId, saleId);
    if (sale.status === "VOIDED")
      throw HttpError.conflict(
        "SALE_VOIDED",
        "Impossible de retourner une vente annulée.",
      );
    // Gel inventaire (E5) : le retour recrédite le stock.
    await assertDepotNotFrozen(client, user.tenantId, sale.depot_id);

    // Quantités déjà retournées (aggrégat en 2 requêtes : pas de SUM sur jointure)
    const priorReturns = await client.query<{ id: string }>(
      "SELECT id FROM sale_returns WHERE sale_id=$1",
      [saleId],
    );
    const returnedByLine = new Map<string, number>();
    if (priorReturns.rows.length > 0) {
      const ph = priorReturns.rows.map((_, i) => `$${i + 1}`).join(",");
      const priorItems = await client.query<{
        product_id: string;
        variant_id: string | null;
        sale_item_id: string | null;
        base_qty: string;
      }>(
        `SELECT product_id, variant_id, sale_item_id, base_qty FROM sale_return_items WHERE return_id IN (${ph})`,
        priorReturns.rows.map((r) => r.id),
      );
      for (const row of priorItems.rows) {
        // Lignes héritées sans rattachement exact : imputées à la première
        // ligne de vente du même produit/variante (déterministe).
        let key = row.sale_item_id;
        if (!key) {
          key =
            sale.items.find(
              (i: { product_id: string; variant_id: string | null }) =>
                i.product_id === row.product_id &&
                (i.variant_id ?? null) === (row.variant_id ?? null),
            )?.id ?? null;
        }
        if (key)
          returnedByLine.set(
            key,
            (returnedByLine.get(key) ?? 0) + parseFloat(row.base_qty),
          );
      }
    }

    // 1) VALIDATION INTÉGRALE AVANT TOUTE ÉCRITURE (aucune ligne partielle)
    interface PreparedReturn {
      line: (typeof sale.items)[number];
      baseQty: number;
      unitPrice: number;
    }
    const prepared: PreparedReturn[] = [];
    let refundedTotal = 0;
    for (const it of items) {
      const line = sale.items.find(
        (i: { id: string }) => i.id === it.saleItemId,
      );
      if (!line)
        throw HttpError.badRequest(
          "LINE_UNKNOWN",
          "Ligne de vente introuvable.",
        );
      const alreadyReturned = returnedByLine.get(line.id) ?? 0;
      if (alreadyReturned + it.baseQty > parseFloat(line.base_qty) + 1e-9) {
        throw HttpError.badRequest(
          "RETURN_EXCEEDS",
          `Retour supérieur à la quantité vendue pour « ${line.product_name} ».`,
        );
      }
      // E8 — Ligne sérialisée (IMEI) : retour INTÉGRAL de la ligne
      // uniquement (un numéro de série est indivisible ; pour un retour
      // partiel : annuler la vente puis en créer une nouvelle).
      if (
        line.requires_serial &&
        alreadyReturned + it.baseQty < parseFloat(line.base_qty) - 1e-9
      )
        throw HttpError.badRequest(
          "SERIAL_PARTIAL_RETURN",
          `« ${line.product_name} » est sérialisé : retour de la ligne entière uniquement.`,
        );
      const unitPrice = parseFloat(line.unit_price);
      refundedTotal = round2(refundedTotal + it.baseQty * unitPrice);
      prepared.push({ line, baseQty: it.baseQty, unitPrice });
    }

    // 2) Écritures
    const ret = await client.query<{ id: string }>(
      "INSERT INTO sale_returns (sale_id, reason, created_by) VALUES ($1,$2,$3) RETURNING id",
      [saleId, reason ?? null, user.id],
    );
    const returnId = ret.rows[0]!.id;
    for (const p of prepared) {
      const lineCost = Number(p.line.unit_cost) || 0;
      await client.query(
        `INSERT INTO sale_return_items (return_id, product_id, variant_id, base_qty, unit_price, sale_item_id, unit_cost, batch_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          returnId,
          p.line.product_id,
          p.line.variant_id,
          p.baseQty,
          p.unitPrice,
          p.line.id,
          lineCost,
          p.line.batch_id ?? null,
        ],
      );
      const scope: StockScope = {
        tenantId: user.tenantId,
        depotId: sale.depot_id,
        productId: p.line.product_id,
        variantId: p.line.variant_id,
      };
      // CUMP ré-pondéré AVANT la hausse physique ; le lot d'origine de la
      // ligne est recrédité (traçabilité lot conservée au retour).
      await applyInflowCost(
        client,
        user.tenantId,
        p.line.product_id,
        p.baseQty,
        lineCost,
      );
      const lvl = await restock(client, scope, p.baseQty, {
        batchId: p.line.batch_id,
      });
      await recordMovement(client, {
        ...scope,
        userId: user.id,
        type: "RETURN",
        quantity: p.baseQty,
        previousStock: lvl.previous,
        newStock: lvl.next,
        reason: reason ?? "Retour client",
        referenceId: saleId,
        batchId: p.line.batch_id ?? null,
        unitCost: lineCost,
      });
      // E8 — retour (forcément intégral, cf. garde) d'une ligne sérialisée :
      // ses numéros repassent en stock sur le dépôt d'origine.
      if (p.line.requires_serial)
        await releaseSerialsOfSaleItem(client, user.tenantId, p.line.id);
    }
    // E7 — avoir partiel : les quantités retournées font l'objet d'une note
    // de crédit (AV-…) référençant la facture d'origine, taux d'origine figé.
    await issueCreditNote(client, {
      tenantId: user.tenantId,
      depotId: sale.depot_id,
      depotName: sale.depot_name,
      saleId,
      saleReturnId: returnId,
      customerId: sale.customer_id,
      customerName: sale.customer_name ?? null,
      issuedBy: user.id,
      lines: groupInvoiceLines(
        prepared.map((p) => {
          const factor =
            parseFloat(p.line.base_qty) / parseFloat(p.line.quantity);
          return {
            productId: p.line.product_id,
            productName: p.line.product_name,
            variantName: p.line.variant_name,
            unitSymbol: p.line.unit_symbol,
            quantity: round2(p.baseQty / (factor || 1)),
            unitPrice: p.unitPrice,
            taxRate: Number(p.line.tax_rate) || 19.25,
            totalTtc: round2(p.baseQty * p.unitPrice),
          };
        }),
      ),
      note: reason ?? "Retour client",
    });

    await writeAudit(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        action: "RETURN",
        entity: "sale",
        entityId: saleId,
        depotId: sale.depot_id,
        newState: { returnId, refundedTotal },
      },
      client,
    );
    return {
      returnId,
      refundedTotal,
      sale: await fullSaleById(client, user.tenantId, saleId),
    };
  });
}

/** Versement sur une vente (règlement de crédit ou avance) — idempotent
 *  hors-ligne via clientPaymentId, solde client tenu à jour. */
export async function addPayment(
  user: AuthUser,
  saleId: string,
  input: SalePaymentInput,
) {
  return withTransaction(async (client) => {
    if (input.clientPaymentId) {
      const dup = await client.query<{ id: string }>(
        "SELECT id FROM sale_payments WHERE tenant_id=$1 AND client_payment_id=$2",
        [user.tenantId, input.clientPaymentId],
      );
      if (dup.rows[0]) {
        const sale = await fullSaleById(client, user.tenantId, saleId);
        return { sale, deduplicated: true };
      }
    }
    const sr = await client.query<{
      id: string;
      depot_id: string;
      status: string;
      total_amount: string;
      amount_paid: string;
      customer_id: string | null;
    }>(
      "SELECT id, depot_id, status, total_amount, amount_paid, customer_id FROM sales WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
      [saleId, user.tenantId],
    );
    const sale = sr.rows[0];
    if (!sale) throw HttpError.notFound("Vente introuvable.");
    if (user.role === "VENDEUR" && sale.depot_id !== user.depotId) {
      throw HttpError.forbidden(
        "Un vendeur ne peut encaisser que sur son propre dépôt.",
        "DEPOT_FORBIDDEN",
      );
    }
    if (sale.status === "VOIDED")
      throw HttpError.conflict(
        "SALE_VOIDED_FOR_PAYMENT",
        "Impossible d'encaisser sur une vente annulée.",
      );
    if (!(input.amount > 0))
      throw HttpError.badRequest(
        "PAYMENT_INVALID",
        "Le versement doit être strictement positif.",
      );
    const outstanding = round2(
      parseFloat(sale.total_amount) - parseFloat(sale.amount_paid),
    );
    if (input.amount > outstanding + 1e-9)
      throw HttpError.conflict(
        "OVERPAY_INVALID",
        `Versement supérieur au reste à payer (${outstanding}).`,
        { outstanding },
      );

    // Session de caisse (E6) : l'encaissement est un mouvement de caisse du
    // jour — il se rattache à la session actuellement ouverte du dépôt.
    const paySession = await getOpenSession(
      client,
      user.tenantId,
      sale.depot_id,
    );
    if (!paySession && (await isSessionRequired(user.tenantId))) {
      throw HttpError.conflict(
        "NO_CASH_SESSION",
        "Aucune session de caisse ouverte sur ce dépôt — ouvrez la caisse avant d'encaisser.",
      );
    }

    await client.query(
      `INSERT INTO sale_payments (tenant_id, sale_id, customer_id, method, amount, reference, received_by, client_payment_id, cash_session_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        user.tenantId,
        saleId,
        sale.customer_id,
        input.method,
        input.amount,
        input.reference ?? null,
        user.id,
        input.clientPaymentId ?? null,
        paySession?.id ?? null,
      ],
    );

    const newPaid = round2(parseFloat(sale.amount_paid) + input.amount);
    const newStatus =
      parseFloat(sale.total_amount) - newPaid <= 1e-9 ? "PAID" : "PARTIAL";
    await client.query(
      "UPDATE sales SET amount_paid=$2, payment_status=$3 WHERE id=$1",
      [saleId, newPaid, newStatus],
    );
    if (sale.customer_id) {
      const cb = await client.query<{ balance: number }>(
        "SELECT balance::float FROM customers WHERE id=$1 FOR UPDATE",
        [sale.customer_id],
      );
      const nb = Math.max(0, round2((cb.rows[0]?.balance ?? 0) - input.amount));
      await client.query(
        "UPDATE customers SET balance=$2, updated_at=now() WHERE id=$1",
        [sale.customer_id, nb],
      );
    }
    await writeAudit(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        action: "PAYMENT",
        entity: "sale",
        entityId: saleId,
        depotId: sale.depot_id,
        newState: {
          method: input.method,
          amount: input.amount,
          newPaid,
          newStatus,
        },
      },
      client,
    );
    return {
      sale: await fullSaleById(client, user.tenantId, saleId),
      deduplicated: false,
    };
  });
}

/** Données de ticket de caisse (reçu 80 mm / partage WhatsApp). */
export async function receiptData(tenantId: string, saleId: string) {
  const sale = await withTransaction((c) => fullSaleById(c, tenantId, saleId));
  const t = await query(
    "SELECT name, phone, currency, niu, rccm, address, invoice_footer FROM tenants WHERE id=$1",
    [tenantId],
  );
  const tenant = t.rows[0]!;
  // E7 — facture légale associée (les ventes d'avant V009 n'en ont pas :
  // le reçu reste délivré, avec la mention « ticket » historique).
  const inv = await invoicesForSale(tenantId, saleId);
  const invoice = inv.find((i) => i.kind === "INVOICE") ?? null;
  const creditNotes = inv.filter((i) => i.kind === "CREDIT_NOTE");
  const lines = sale.items.map(
    (i: {
      product_name: string;
      variant_name: string | null;
      quantity: string;
      unit_symbol: string | null;
      unit_price: string;
      total_price: string;
      tax_rate: string | null;
    }) => ({
      label: i.product_name + (i.variant_name ? ` (${i.variant_name})` : ""),
      qty: parseFloat(i.quantity),
      unit: i.unit_symbol ?? "",
      unitPrice: parseFloat(i.unit_price),
      total: parseFloat(i.total_price),
      taxRate: i.tax_rate == null ? null : parseFloat(i.tax_rate),
    }),
  );
  const outstanding = round2(
    parseFloat(sale.total_amount) - parseFloat(sale.amount_paid ?? "0"),
  );
  // Ventilation HT/TVA (figée si vente post-V009, sinon recalculée du TTC à
  // 19,25 % — approximation historique documentée en migration).
  const totalHt =
    sale.total_ht != null
      ? parseFloat(sale.total_ht)
      : vatSplit(parseFloat(sale.total_amount), 19.25).ht;
  const totalVat =
    sale.total_vat != null
      ? parseFloat(sale.total_vat)
      : vatSplit(parseFloat(sale.total_amount), 19.25).vat;
  const text = [
    `${tenant.name}`,
    ...(tenant.address ? [tenant.address] : []),
    ...(tenant.phone ? [`Tél : ${tenant.phone}`] : []),
    ...(tenant.niu ? [`NIU : ${tenant.niu}`] : []),
    ...(tenant.rccm ? [`RCCM : ${tenant.rccm}`] : []),
    invoice
      ? `FACTURE ${invoice.number} — ${new Date(sale.created_at).toLocaleString("fr-FR")}`
      : `Ticket #${sale.id.slice(0, 8)} — ${new Date(sale.created_at).toLocaleString("fr-FR")}`,
    `Dépôt : ${sale.depot_name} · Vendeur : ${sale.vendor_name}`,
    ...(sale.customer_name ? [`Client : ${sale.customer_name}`] : []),
    "--------------------------------",
    ...lines.map(
      (l: { label: string; qty: number; unit: string; total: number }) =>
        `${l.label}\n  ${l.qty} ${l.unit}  —  ${l.total.toLocaleString("fr-FR")} ${tenant.currency}`,
    ),
    "--------------------------------",
    `TOTAL TTC : ${parseFloat(sale.total_amount).toLocaleString("fr-FR")} ${tenant.currency}`,
    `dont HT : ${totalHt.toLocaleString("fr-FR")} — TVA : ${totalVat.toLocaleString("fr-FR")}`,
    `Paiement : ${sale.payment_method}${sale.payment_reference ? ` (réf. ${sale.payment_reference})` : ""}`,
    `Payé : ${parseFloat(sale.amount_paid ?? "0").toLocaleString("fr-FR")} ${tenant.currency}`,
    ...(outstanding > 1e-9
      ? [
          `RESTE À PAYER : ${outstanding.toLocaleString("fr-FR")} ${tenant.currency}`,
          ...(sale.due_date
            ? [`Échéance : ${String(sale.due_date).slice(0, 10)}`]
            : []),
        ]
      : []),
    ...creditNotes.map((c) => `Avoir émis : ${c.number}`),
    ...(tenant.invoice_footer ? [tenant.invoice_footer] : []),
    "Merci de votre visite !",
  ].join("\n");
  return {
    sale,
    tenant,
    lines,
    text,
    outstanding,
    invoice,
    creditNotes,
    totals: {
      ttc: parseFloat(sale.total_amount),
      ht: totalHt,
      vat: totalVat,
    },
  };
}
