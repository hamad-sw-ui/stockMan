import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../config/db";
import { h } from "../lib/asyncHandler";
import { HttpError } from "../lib/errors";
import { writeAudit } from "../lib/audit";
import {
  pageParams,
  paged,
  pageQuerySchema,
  encodeCursor,
  decodeCursor,
} from "../lib/pagination";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import { requireActiveLicense } from "../middleware/license";
import {
  validateBody,
  validateParams,
  validateQuery,
  uuidParam,
  money,
  qty,
} from "../middleware/validate";
import { PoolClient } from "pg";
import {
  decreaseLevel,
  fefoConsume,
  increaseLevel,
  lockLevel,
  lockLevelReserved,
  NO_VARIANT,
  recordMovement,
  setLevel,
} from "../services/stockService";
import { normHeader, parseCsv, parseMoney } from "../lib/csv";
import { currentAvgCost } from "../services/costingService";
import { receiveReceiptItems } from "../services/receiptService";
import { resolveDepot } from "../services/saleService";
import {
  ADJUST_REASON_CODES,
  assertDepotNotFrozen,
} from "../services/inventoryService";

const router = Router();
router.use(authenticate);
const adminWrite = [requireRole("ADMIN"), requireActiveLicense()];
const round2 = (n: number) => Math.round(n * 100) / 100;

// ============================ RÉCEPTIONS FOURNISSEURS (IN) ==================
const receiptInput = z.object({
  depotId: z.string().uuid().optional(),
  supplierId: z.string().uuid().nullish(),
  reference: z.string().trim().max(100).nullish(),
  note: z.string().trim().max(2000).nullish(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullish(),
        quantity: qty,
        unitId: z.string().uuid().nullish(),
        unitCost: money.default(0),
        batchNumber: z.string().trim().max(100).nullish(),
        expiryDate: z.string().date().nullish(),
        serials: z.array(z.string().trim().min(1).max(100)).max(500).nullish(),
      }),
    )
    .min(1, "Au moins une ligne est requise")
    .max(200),
});

router.post(
  "/receipts",
  ...adminWrite,
  validateBody(receiptInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof receiptInput>;
    const depotId = resolveDepot(u, b.depotId);

    const created = await withTransaction(async (client) => {
      const rec = await client.query<{ id: string }>(
        `INSERT INTO stock_receipts (tenant_id, depot_id, supplier_id, received_by, reference, note)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          u.tenantId,
          depotId,
          b.supplierId ?? null,
          u.id,
          b.reference ?? null,
          b.note ?? null,
        ],
      );
      const receiptId = rec.rows[0]!.id;

      // Moteur partagé (E4) : CUMP repondéré, lots à coût réel, mouvements.
      const { totalCost } = await receiveReceiptItems(client, {
        tenantId: u.tenantId,
        depotId,
        userId: u.id,
        supplierId: b.supplierId ?? null,
        receiptId,
        movementReason: b.reference
          ? `Réception ${b.reference}`
          : "Réception fournisseur",
        items: b.items,
      });

      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "RECEIPT",
          entity: "receipt",
          entityId: receiptId,
          depotId,
          newState: { lines: b.items.length, totalCost },
        },
        client,
      );
      return { receiptId, totalCost, lines: b.items.length };
    });
    res.status(201).json(created);
  }),
);

const receiptListQuery = pageQuerySchema.extend({
  supplierId: z.string().uuid().optional(),
  depotId: z.string().uuid().optional(),
});

router.get(
  "/receipts",
  requireRole("ADMIN"),
  validateQuery(receiptListQuery),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const q = req.query as unknown as z.infer<typeof receiptListQuery>;
    const { limit, offset } = pageParams(q);
    const params: unknown[] = [t];
    const conds = ["r.tenant_id = $1"];
    if (q.supplierId)
      conds.push(`r.supplier_id = $${params.push(q.supplierId)}`);
    if (q.depotId) conds.push(`r.depot_id = $${params.push(q.depotId)}`);
    const where = `WHERE ${conds.join(" AND ")}`;
    const count = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM stock_receipts r ${where}`,
      params,
    );
    const rows = await query(
      `SELECT r.*, s.name AS supplier_name, d.name AS depot_name, usr.name AS received_by_name,
              COALESCE(agg.line_count, 0)::int AS line_count, COALESCE(agg.total_cost, 0)::float AS total_cost
         FROM stock_receipts r
         LEFT JOIN suppliers s ON s.id=r.supplier_id
         JOIN depots d ON d.id=r.depot_id
         LEFT JOIN users usr ON usr.id=r.received_by
         LEFT JOIN (SELECT receipt_id, COUNT(*)::int AS line_count, SUM(base_qty * unit_cost)::float AS total_cost
                      FROM stock_receipt_items GROUP BY receipt_id) agg ON agg.receipt_id = r.id
        ${where}
        ORDER BY r.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json(paged(rows.rows, count.rows[0]!.n, q));
  }),
);

router.get(
  "/receipts/:id",
  requireRole("ADMIN"),
  validateParams(uuidParam),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const r = await query(
      `SELECT r.*, s.name AS supplier_name, d.name AS depot_name, usr.name AS received_by_name
         FROM stock_receipts r LEFT JOIN suppliers s ON s.id=r.supplier_id
         JOIN depots d ON d.id=r.depot_id LEFT JOIN users usr ON usr.id=r.received_by
        WHERE r.id=$1 AND r.tenant_id=$2`,
      [req.params.id!, t],
    );
    if (!r.rows[0]) throw HttpError.notFound("Réception introuvable.");
    // C4 — les codes et le prix de vente accompagnent chaque ligne : le
    // détail d'une réception doit pouvoir imprimer ses étiquettes en un
    // clic (code de la variante si la ligne en porte une).
    const items = await query(
      `SELECT i.*, p.name AS product_name, v.name AS variant_name, bt.batch_number,
              p.barcode AS product_barcode, v.barcode AS variant_barcode,
              p.selling_price::float AS selling_price
         FROM stock_receipt_items i
         JOIN products p ON p.id=i.product_id
         LEFT JOIN product_variants v ON v.id=i.variant_id
         LEFT JOIN stock_batches bt ON bt.id=i.batch_id
        WHERE i.receipt_id=$1`,
      [req.params.id],
    );
    res.json({ ...r.rows[0], items: items.rows });
  }),
);

/** (Re)crédite un lot transféré dans un dépôt : fusion pondérée si le même
 *  numéro de lot s'y trouve déjà, sinon recréation à l'identique (numéro,
 *  expiration et coût préservés — traçabilité inter-dépôts). */
async function creditBatchInDepot(
  client: PoolClient,
  depotId: string,
  productId: string,
  variantId: string | null,
  alloc: {
    batch_number: string;
    expiry_date: string | null;
    unit_cost: number;
    quantity: number;
  },
): Promise<string> {
  const existing = await client.query<{
    id: string;
    quantity: number;
    unit_cost: number;
  }>(
    `SELECT id, quantity::float, unit_cost::float FROM stock_batches
      WHERE product_id=$1 AND depot_id=$2 AND batch_number=$3
        AND COALESCE(variant_id, $4::uuid) = $4::uuid
      FOR UPDATE`,
    [productId, depotId, alloc.batch_number, variantId ?? NO_VARIANT],
  );
  if (existing.rows[0]) {
    const oldQty = Number(existing.rows[0].quantity) || 0;
    const oldCost = Number(existing.rows[0].unit_cost) || 0;
    const tot = oldQty + alloc.quantity;
    const merged =
      tot > 1e-9
        ? round2((oldQty * oldCost + alloc.quantity * alloc.unit_cost) / tot)
        : alloc.unit_cost;
    await client.query(
      "UPDATE stock_batches SET quantity = quantity + $2, unit_cost=$3 WHERE id=$1",
      [existing.rows[0].id, alloc.quantity, merged],
    );
    return existing.rows[0].id;
  }
  const ins = await client.query<{ id: string }>(
    `INSERT INTO stock_batches (product_id, variant_id, depot_id, batch_number, quantity, expiry_date, unit_cost)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      productId,
      variantId,
      depotId,
      alloc.batch_number,
      alloc.quantity,
      alloc.expiry_date,
      alloc.unit_cost,
    ],
  );
  return ins.rows[0]!.id;
}

// ============================ STOCK RÉSERVÉ (E8) =============================
// Quantités mises de côté (commande client confirmée non livrée, acompte sur
// marchandise) : elles restent en stock PHYSIQUE mais ne sont plus vendables
// — la caisse contrôle (quantity − reserved_qty) serveur à chaque vente.
const reservationInput = z.object({
  depotId: z.string().uuid().optional(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullish(),
  quantity: qty,
  reason: z.string().trim().max(500).nullish(),
});

router.post(
  "/reserve",
  ...adminWrite,
  validateBody(reservationInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof reservationInput>;
    const depotId = resolveDepot(u, b.depotId);
    const result = await withTransaction(async (client) => {
      const scope = {
        tenantId: u.tenantId,
        depotId,
        productId: b.productId,
        variantId: b.variantId ?? null,
      };
      const lv = await lockLevelReserved(client, scope);
      const available = round2(lv.quantity - lv.reserved);
      if (b.quantity > available + 1e-9)
        throw HttpError.conflict(
          "STOCK_RESERVE_EXCEEDS",
          `Réservation impossible : ${round2(available)} disponible(s) (stock ${round2(lv.quantity)} dont ${round2(lv.reserved)} déjà réservée(s)).`,
        );
      await client.query(
        `UPDATE stock_levels SET reserved_qty = reserved_qty + $4
          WHERE product_id=$1 AND depot_id=$2
            AND COALESCE(variant_id, $3::uuid) = $3::uuid`,
        [b.productId, depotId, b.variantId ?? NO_VARIANT, b.quantity],
      );
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "ADJUST",
          entity: "stock_reservation",
          entityId: b.productId,
          depotId,
          newState: {
            op: "RESERVE",
            quantity: b.quantity,
            reason: b.reason ?? null,
          },
        },
        client,
      );
      return {
        reserved: round2(lv.reserved + b.quantity),
        available: round2(available - b.quantity),
      };
    });
    res.status(201).json(result);
  }),
);

router.post(
  "/release",
  ...adminWrite,
  validateBody(reservationInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof reservationInput>;
    const depotId = resolveDepot(u, b.depotId);
    const result = await withTransaction(async (client) => {
      const scope = {
        tenantId: u.tenantId,
        depotId,
        productId: b.productId,
        variantId: b.variantId ?? null,
      };
      const lv = await lockLevelReserved(client, scope);
      if (b.quantity > lv.reserved + 1e-9)
        throw HttpError.conflict(
          "RELEASE_EXCEEDS",
          `Libération impossible : ${round2(lv.reserved)} réservée(s) seulement.`,
        );
      await client.query(
        `UPDATE stock_levels SET reserved_qty = reserved_qty - $4
          WHERE product_id=$1 AND depot_id=$2
            AND COALESCE(variant_id, $3::uuid) = $3::uuid`,
        [b.productId, depotId, b.variantId ?? NO_VARIANT, b.quantity],
      );
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "ADJUST",
          entity: "stock_reservation",
          entityId: b.productId,
          depotId,
          newState: {
            op: "RELEASE",
            quantity: b.quantity,
            reason: b.reason ?? null,
          },
        },
        client,
      );
      return {
        reserved: round2(lv.reserved - b.quantity),
        available: round2(lv.quantity - (lv.reserved - b.quantity)),
      };
    });
    res.json(result);
  }),
);

// ============================ IMPORT CSV — STOCK INITIAL (E8) ================
// Prise d'inventaire d'ouverture : une réception groupée (moteur E4, CUMP
// pondéré, lots créés). Colonnes reconnues (accents indifférents) :
// Produit (code-barres OU nom exact) ; Quantité ; Coût (optionnel → coût
// catalogue) ; Lot (optionnel) ; Expiration (optionnelle).
// Produit SÉRIALISÉ refusé : ses entrées passent par une réception avec
// numéros de série (invariant stock physique = numéros en stock).
// Les lignes invalides sont rapportées sans bloquer les lignes valides.
const STOCK_IMPORT_MAX_ROWS = 500;
const stockImportInput = z.object({
  depotId: z.string().uuid().optional(),
  reference: z.string().trim().max(100).nullish(),
  csv: z.string().min(1, "Contenu CSV attendu dans le champ « csv »."),
});

router.post(
  "/import",
  ...adminWrite,
  validateBody(stockImportInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof stockImportInput>;
    const depotId = resolveDepot(u, b.depotId);
    const rows = parseCsv(b.csv);
    if (rows.length < 2)
      throw HttpError.badRequest(
        "CSV_EMPTY",
        "Le fichier ne contient aucune ligne de données.",
      );
    const header = rows[0]!.map(normHeader);
    const findCol = (preds: string[], prefix = false) =>
      header.findIndex((hh) =>
        prefix ? preds.some((p) => hh.startsWith(p)) : preds.includes(hh),
      );
    const cols = {
      product: findCol([
        "produit",
        "nom",
        "designation",
        "code barres",
        "code barre",
        "barcode",
        "ean",
      ]),
      quantity: findCol(["quantite", "qte", "qty"], true),
      cost: findCol(["cout", "prix achat", "cost", "pa"], true),
      batch: findCol(["lot", "numero lot", "batch"], true),
      expiry: findCol(["expiration", "dlc", "ddm", "expiry"], true),
    };
    if (cols.product < 0 || cols.quantity < 0)
      throw HttpError.badRequest(
        "CSV_HEADER",
        "Colonnes reconnues : Produit;Quantité;Coût;Lot;Expiration.",
      );
    const dataRows = rows.slice(1);
    if (dataRows.length > STOCK_IMPORT_MAX_ROWS)
      throw HttpError.badRequest(
        "CSV_TOO_MANY",
        `Maximum ${STOCK_IMPORT_MAX_ROWS} lignes par import (${dataRows.length} reçues) : découpez le fichier.`,
      );

    // ---- Validation de CHAQUE ligne (aucune écriture stock ici) -----------
    interface ImportLine {
      productId: string;
      quantity: number;
      unitCost: number;
      batchNumber: string | null;
      expiryDate: string | null;
    }
    const valid: ImportLine[] = [];
    const errors: Array<{ ligne: number; message: string }> = [];
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    for (let i = 0; i < dataRows.length; i += 1) {
      const ligne = i + 2;
      const row = dataRows[i]!;
      const cellv = (idx: number) => (idx >= 0 ? (row[idx] ?? "").trim() : "");
      try {
        const key = cellv(cols.product);
        if (!key) throw new Error("Produit manquant.");
        const prod = await query<{
          id: string;
          track_batch: boolean;
          requires_serial: boolean;
        }>(
          `SELECT id, track_batch, requires_serial FROM products
            WHERE tenant_id=$1 AND archived_at IS NULL
              AND (barcode = $2 OR lower(name) = lower($2))
            LIMIT 1`,
          [u.tenantId, key],
        );
        const p = prod.rows[0];
        if (!p)
          throw new Error(
            `Produit inconnu : « ${key} » (créez-le d'abord au catalogue).`,
          );
        if (p.requires_serial)
          throw new Error(
            "Produit sérialisé : import impossible (saisir une réception avec numéros de série).",
          );
        const qtyRaw = cellv(cols.quantity);
        const quantity = parseMoney(qtyRaw);
        if (quantity == null || quantity <= 0)
          throw new Error(`Quantité illisible : « ${qtyRaw} ».`);
        const costRaw = cellv(cols.cost);
        const unitCost = costRaw === "" ? 0 : (parseMoney(costRaw) ?? -1);
        if (unitCost < 0) throw new Error(`Coût illisible : « ${costRaw} ».`);
        const batchNumber = cellv(cols.batch) || null;
        if (p.track_batch && !batchNumber)
          throw new Error(
            "Produit géré par lots : colonne « Lot » obligatoire.",
          );
        const expiryRaw = cellv(cols.expiry);
        if (expiryRaw && !isoDate.test(expiryRaw))
          throw new Error(
            `Expiration illisible (AAAA-MM-JJ attendu) : « ${expiryRaw} ».`,
          );
        valid.push({
          productId: p.id,
          quantity,
          unitCost,
          batchNumber,
          expiryDate: expiryRaw || null,
        });
      } catch (e) {
        errors.push({
          ligne,
          message: e instanceof Error ? e.message : "Ligne illisible.",
        });
      }
    }

    // ---- Une réception groupée et atomique pour toutes les lignes valides -
    let receiptId: string | null = null;
    if (valid.length > 0) {
      receiptId = await withTransaction(async (client) => {
        const rec = await client.query<{ id: string }>(
          `INSERT INTO stock_receipts (tenant_id, depot_id, received_by, reference, note)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [
            u.tenantId,
            depotId,
            u.id,
            b.reference ?? null,
            `Import stock initial (${valid.length} ligne(s))`,
          ],
        );
        await receiveReceiptItems(client, {
          tenantId: u.tenantId,
          depotId,
          userId: u.id,
          receiptId: rec.rows[0]!.id,
          movementReason: b.reference
            ? `Import ${b.reference}`
            : "Import stock initial",
          items: valid.map((vl) => ({
            productId: vl.productId,
            quantity: vl.quantity,
            unitCost: vl.unitCost,
            batchNumber: vl.batchNumber,
            expiryDate: vl.expiryDate,
          })),
        });
        await writeAudit(
          {
            tenantId: u.tenantId,
            userId: u.id,
            userName: u.name,
            action: "IMPORT",
            entity: "stock_import",
            entityId: rec.rows[0]!.id,
            depotId,
            newState: { imported: valid.length, rejected: errors.length },
          },
          client,
        );
        return rec.rows[0]!.id;
      });
    }
    res.status(valid.length > 0 ? 201 : 200).json({
      receiptId,
      imported: valid.length,
      errors,
    });
  }),
);

// ============================ TRANSFERTS INTER-DÉPÔTS =======================
const transferInput = z.object({
  fromDepotId: z.string().uuid(),
  toDepotId: z.string().uuid(),
  note: z.string().trim().max(2000).nullish(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullish(),
        quantity: qty,
      }),
    )
    .min(1)
    .max(200),
});

router.post(
  "/transfers",
  ...adminWrite,
  validateBody(transferInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof transferInput>;
    if (b.fromDepotId === b.toDepotId)
      throw HttpError.badRequest(
        "SAME_DEPOT",
        "Les dépôts source et destination doivent différer.",
      );

    const created = await withTransaction(async (client) => {
      const depots = await client.query(
        "SELECT id FROM depots WHERE tenant_id=$1 AND id IN ($2, $3) AND is_active",
        [u.tenantId, b.fromDepotId, b.toDepotId],
      );
      if (depots.rows.length !== 2)
        throw HttpError.badRequest(
          "DEPOT_UNKNOWN",
          "Dépôts introuvables ou inactifs.",
        );
      // Gel inventaire (E5) : sortie du dépôt source.
      await assertDepotNotFrozen(client, u.tenantId, b.fromDepotId);
      const tr = await client.query<{ id: string }>(
        `INSERT INTO stock_transfers (tenant_id, from_depot, to_depot, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [u.tenantId, b.fromDepotId, b.toDepotId, b.note ?? null, u.id],
      );
      const transferId = tr.rows[0]!.id;
      for (const item of b.items) {
        const scope = {
          tenantId: u.tenantId,
          depotId: b.fromDepotId,
          productId: item.productId,
          variantId: item.variantId ?? null,
        };
        // Allocation FEFO au départ : les lots partent réellement avec le
        // transfert (le stock au dépôt source et les lots restent cohérents).
        const avg = await currentAvgCost(client, u.tenantId, item.productId);
        const deductions = await fefoConsume(client, scope, item.quantity);
        const lvl = await decreaseLevel(client, scope, item.quantity);
        const ti = await client.query<{ id: string }>(
          "INSERT INTO stock_transfer_items (transfer_id, product_id, variant_id, quantity) VALUES ($1,$2,$3,$4) RETURNING id",
          [transferId, item.productId, item.variantId ?? null, item.quantity],
        );
        const transferItemId = ti.rows[0]!.id;
        for (const d of deductions) {
          await client.query(
            `INSERT INTO stock_transfer_item_batches (transfer_item_id, batch_id, batch_number, expiry_date, unit_cost, quantity)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              transferItemId,
              d.batchId,
              d.batchNumber,
              d.expiryDate,
              d.unitCost > 0 ? d.unitCost : avg,
              d.deducted,
            ],
          );
        }
        await recordMovement(client, {
          ...scope,
          userId: u.id,
          type: "TRANSFER",
          quantity: item.quantity,
          previousStock: lvl.previous,
          newStock: lvl.next,
          reason: "Transfert sortant",
          referenceId: transferId,
          unitCost: avg,
        });
      }
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "TRANSFER",
          entity: "transfer",
          entityId: transferId,
          newState: {
            from: b.fromDepotId,
            to: b.toDepotId,
            lines: b.items.length,
          },
        },
        client,
      );
      return { transferId, lines: b.items.length, status: "PENDING" };
    });
    res.status(201).json(created);
  }),
);

router.get(
  "/transfers",
  requireRole("ADMIN"),
  validateQuery(
    pageQuerySchema.extend({
      status: z.enum(["PENDING", "RECEIVED", "CANCELLED"]).optional(),
    }),
  ),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const q = req.query as unknown as {
      page: number;
      size: number;
      status?: string;
    };
    const { limit, offset } = pageParams(q);
    const params: unknown[] = [t];
    const conds = ["tr.tenant_id = $1"];
    if (q.status) conds.push(`tr.status = $${params.push(q.status)}`);
    const where = `WHERE ${conds.join(" AND ")}`;
    const count = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM stock_transfers tr ${where}`,
      params,
    );
    const rows = await query(
      `SELECT tr.*, df.name AS from_depot_name, dt.name AS to_depot_name, usr.name AS created_by_name
         FROM stock_transfers tr
         JOIN depots df ON df.id=tr.from_depot JOIN depots dt ON dt.id=tr.to_depot
         LEFT JOIN users usr ON usr.id=tr.created_by
        ${where} ORDER BY tr.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json(paged(rows.rows, count.rows[0]!.n, q));
  }),
);

/**
 * Réception d'un transfert (E8 v2) : PARTIELLE par ligne, avec écart
 * valorisé. Body {items?: [{transferItemId, receivedQty, lostQty?,
 * discrepancyReason?}]} — absent = réception intégrale du reliquat
 * (comportement historique préservé). Les lots alloués (FEFO à l'émission)
 * sont rejoués dans l'ordre pour la part reçue ; la part PERDUE (DAMAGE
 * casse / LOSS perte — motif obligatoire) est valorisée au coût des lots et
 * tracée (audit + ligne). Statut : PARTIALLY_RECEIVED tant qu'un reliquat
 * subsiste, RECEIVED quand tout est résolu.
 */
const transferReceiveInput = z.object({
  items: z
    .array(
      z.object({
        transferItemId: z.string().uuid(),
        receivedQty: z.coerce.number().min(0).finite().default(0),
        lostQty: z.coerce.number().min(0).finite().default(0),
        discrepancyReason: z.enum(["DAMAGE", "LOSS"]).nullish(),
      }),
    )
    .min(1)
    .max(200)
    .optional(),
});

router.post(
  "/transfers/:id/receive",
  ...adminWrite,
  validateParams(uuidParam),
  validateBody(transferReceiveInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const body = req.body as z.infer<typeof transferReceiveInput>;
    const done = await withTransaction(async (client) => {
      const tr = await client.query(
        "SELECT * FROM stock_transfers WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
        [req.params.id!, u.tenantId],
      );
      const transfer = tr.rows[0];
      if (!transfer) throw HttpError.notFound("Transfert introuvable.");
      if (
        transfer.status !== "PENDING" &&
        transfer.status !== "PARTIALLY_RECEIVED"
      )
        throw HttpError.conflict(
          "TRANSFER_CLOSED",
          "Ce transfert est déjà clôturé.",
        );
      // Gel inventaire (E5) : entrée au dépôt destination.
      await assertDepotNotFrozen(client, u.tenantId, transfer.to_depot);
      const items = await client.query(
        `SELECT * FROM stock_transfer_items WHERE transfer_id=$1 ORDER BY id`,
        [transfer.id],
      );
      const byId = new Map(items.rows.map((i) => [i.id, i]));

      // Plan de réception : explicite (par ligne) ou reliquat intégral.
      const plan = new Map<
        string,
        {
          receivedQty: number;
          lostQty: number;
          reason: "DAMAGE" | "LOSS" | null;
        }
      >();
      if (body.items) {
        for (const it of body.items) {
          const item = byId.get(it.transferItemId);
          if (!item)
            throw HttpError.badRequest(
              "LINE_UNKNOWN",
              "Ligne de transfert introuvable.",
            );
          plan.set(it.transferItemId, {
            receivedQty: it.receivedQty,
            lostQty: it.lostQty,
            reason: it.discrepancyReason ?? null,
          });
        }
      } else {
        for (const item of items.rows) {
          const remaining = round2(
            parseFloat(item.quantity) -
              parseFloat(item.received_qty ?? "0") -
              parseFloat(item.lost_qty ?? "0"),
          );
          if (remaining > 0)
            plan.set(item.id, {
              receivedQty: remaining,
              lostQty: 0,
              reason: null,
            });
        }
      }
      if (plan.size === 0)
        throw HttpError.badRequest(
          "NOTHING_TO_RECEIVE",
          "Aucun reliquat à recevoir.",
        );

      let totalLossValue = 0;
      for (const item of items.rows) {
        const req0 = plan.get(item.id);
        if (!req0) continue;
        const prevReceived = parseFloat(item.received_qty ?? "0");
        const prevLost = parseFloat(item.lost_qty ?? "0");
        const remaining = round2(
          parseFloat(item.quantity) - prevReceived - prevLost,
        );
        const asked = round2(req0.receivedQty + req0.lostQty);
        if (asked > remaining + 1e-9)
          throw HttpError.conflict(
            "TRANSFER_OVER_RECEIPT",
            `Quantité supérieure au reliquat (${remaining}).`,
          );
        if (req0.lostQty > 1e-9 && !req0.reason)
          throw HttpError.badRequest(
            "DISCREPANCY_REASON_REQUIRED",
            "Un motif (DAMAGE casse / LOSS perte) est obligatoire pour un écart.",
          );

        const scope = {
          tenantId: u.tenantId,
          depotId: transfer.to_depot,
          productId: item.product_id,
          variantId: item.variant_id,
        };
        // Rejeu ordonné de l'allocation FEFO sur la part REÇUE (les lots
        // arrivent à l'identique) ; le coût des lots sert aussi à valoriser
        // la part perdue.
        const allocs = await client.query<{
          batch_number: string;
          expiry_date: string | null;
          unit_cost: number;
          quantity: number;
        }>(
          "SELECT batch_number, expiry_date, unit_cost::float, quantity::float FROM stock_transfer_item_batches WHERE transfer_item_id=$1 ORDER BY id",
          [item.id],
        );
        // Position de lecture dans les allocations (les parts déjà reçues
        // ont consommé les premières quantités).
        let seen = 0;
        let toReceive = req0.receivedQty;
        for (const alloc of allocs.rows) {
          const consumedHere = Math.min(
            Math.max(0, Math.min(prevReceived - seen, alloc.quantity)),
            alloc.quantity,
          );
          const free = round2(alloc.quantity - consumedHere);
          seen = round2(seen + alloc.quantity);
          if (free <= 1e-9 || toReceive <= 1e-9) continue;
          const take = Math.min(free, toReceive);
          const batchId = await creditBatchInDepot(
            client,
            transfer.to_depot,
            item.product_id,
            item.variant_id,
            { ...alloc, quantity: take },
          );
          const lvl = await increaseLevel(client, scope, take);
          await recordMovement(client, {
            ...scope,
            userId: u.id,
            type: "TRANSFER",
            quantity: take,
            previousStock: lvl.previous,
            newStock: lvl.next,
            reason: "Transfert reçu",
            referenceId: transfer.id,
            batchId,
            unitCost: alloc.unit_cost,
          });
          toReceive = round2(toReceive - take);
        }
        if (toReceive > 1e-9) {
          // Reliquat sans lot (ou ligne sans lots gérés)
          const lvl = await increaseLevel(client, scope, toReceive);
          await recordMovement(client, {
            ...scope,
            userId: u.id,
            type: "TRANSFER",
            quantity: toReceive,
            previousStock: lvl.previous,
            newStock: lvl.next,
            reason: "Transfert reçu",
            referenceId: transfer.id,
          });
        }
        // Valorisation de l'écart : coût moyen des allocations restantes
        // (sinon CUMP du produit, sinon prix catalogue d'achat).
        if (req0.lostQty > 1e-9) {
          let lostValue = 0;
          let allocSeen = 0;
          let lossToCover = req0.lostQty;
          const consumedTotal = prevReceived + req0.receivedQty;
          for (const alloc of allocs.rows) {
            const consumedHere = Math.min(
              Math.max(0, Math.min(consumedTotal - allocSeen, alloc.quantity)),
              alloc.quantity,
            );
            const free = round2(alloc.quantity - consumedHere);
            allocSeen = round2(allocSeen + alloc.quantity);
            if (free <= 1e-9 || lossToCover <= 1e-9) continue;
            const take = Math.min(free, lossToCover);
            lostValue = round2(lostValue + take * alloc.unit_cost);
            lossToCover = round2(lossToCover - take);
          }
          if (lossToCover > 1e-9) {
            const c = await client.query<{ c: number; p: number }>(
              "SELECT avg_cost::float AS c, purchase_price::float AS p FROM products WHERE id=$1",
              [item.product_id],
            );
            const unit = c.rows[0]?.c || c.rows[0]?.p || 0;
            lostValue = round2(lostValue + lossToCover * unit);
          }
          totalLossValue = round2(totalLossValue + lostValue);
          await client.query(
            `INSERT INTO stock_movements (tenant_id, depot_id, product_id, variant_id, user_id, type, quantity,
                                          previous_stock, new_stock, reason, reason_code, reference_id, unit_cost)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12)`,
            [
              u.tenantId,
              transfer.to_depot,
              item.product_id,
              item.variant_id,
              u.id,
              req0.reason === "DAMAGE" ? "DAMAGE" : "OUT",
              req0.lostQty,
              null,
              `${req0.reason === "DAMAGE" ? "Casse" : "Perte"} en transit (transfert ${transfer.id.slice(0, 8)})`,
              `TRANSIT_${req0.reason}`,
              transfer.id,
              round2(lostValue / req0.lostQty),
            ],
          );
        }
        await client.query(
          `UPDATE stock_transfer_items
              SET received_qty = received_qty + $2, lost_qty = lost_qty + $3,
                  discrepancy_reason = COALESCE($4, discrepancy_reason)
            WHERE id=$1`,
          [item.id, req0.receivedQty, req0.lostQty, req0.reason],
        );
      }

      // Statut global : tout résolu → RECEIVED (et clôture), sinon reliquat.
      const after = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM stock_transfer_items
          WHERE transfer_id=$1 AND (received_qty + lost_qty + 0.0000001) < quantity`,
        [transfer.id],
      );
      const fullyDone = after.rows[0]!.n === 0;
      const status = fullyDone ? "RECEIVED" : "PARTIALLY_RECEIVED";
      await client.query(
        `UPDATE stock_transfers SET status=$2,
                received_by = CASE WHEN $2='RECEIVED' THEN $3 ELSE received_by END,
                received_at = CASE WHEN $2='RECEIVED' THEN now() ELSE received_at END
          WHERE id=$1`,
        [transfer.id, status, u.id],
      );
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "TRANSFER",
          entity: "transfer",
          entityId: transfer.id,
          previousState: { status: transfer.status },
          newState: { status, lossValue: totalLossValue || undefined },
        },
        client,
      );
      return { status, lossValue: totalLossValue };
    });
    res.json(done);
  }),
);

/** Stock en transit (E8) : reliquats des transferts non clôturés, valorisés
 *  au coût des lots alloués — la marchandise ne « disparaît » plus entre
 *  départ et arrivée. */
router.get(
  "/transit",
  requireRole("ADMIN"),
  validateQuery(z.object({ depotId: z.string().uuid().optional() })),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const depotId = (req.query as { depotId?: string }).depotId;
    const rows = await query<{
      item_id: string;
      transfer_id: string;
      created_at: string;
      note: string | null;
      status: string;
      from_depot: string;
      to_depot: string;
      product_id: string;
      product: string;
      variant_name: string | null;
      shipped: number;
      received: number;
      lost: number;
      reason: string | null;
      avg_cost: number | null;
      purchase_price: number | null;
    }>(
      `SELECT ti.id AS item_id, tr.id AS transfer_id, tr.created_at, tr.note, tr.status,
              df.name AS from_depot, dt.name AS to_depot,
              ti.product_id, p.name AS product, pv.name AS variant_name,
              ti.quantity::float AS shipped,
              ti.received_qty::float AS received, ti.lost_qty::float AS lost,
              ti.discrepancy_reason AS reason,
              p.avg_cost::float AS avg_cost, p.purchase_price::float AS purchase_price
         FROM stock_transfer_items ti
         JOIN stock_transfers tr ON tr.id = ti.transfer_id
         JOIN depots df ON df.id = tr.from_depot
         JOIN depots dt ON dt.id = tr.to_depot
         JOIN products p ON p.id = ti.product_id
         LEFT JOIN product_variants pv ON pv.id = ti.variant_id
        WHERE tr.tenant_id=$1 AND tr.status IN ('PENDING','PARTIALLY_RECEIVED')
          ${depotId ? "AND (tr.from_depot=$2 OR tr.to_depot=$2)" : ""}
        ORDER BY tr.created_at DESC, ti.id`,
      depotId ? [u.tenantId, depotId] : [u.tenantId],
    );
    // Coût moyen des lots alloués par ligne (agrégat séparé — pas de
    // sous-requête corrélée, parité pg-mem).
    const itemIds = rows.rows.map((r) => r.item_id);
    const costByItem = new Map<string, number>();
    if (itemIds.length > 0) {
      const ph = itemIds.map((_, i) => `$${i + 1}`).join(",");
      const costs = await query<{ item_id: string; c: number; q: number }>(
        `SELECT tib.transfer_item_id AS item_id,
                COALESCE(SUM(tib.unit_cost * tib.quantity),0)::float AS c,
                COALESCE(SUM(tib.quantity),0)::float AS q
           FROM stock_transfer_item_batches tib
          WHERE tib.transfer_item_id IN (${ph})
          GROUP BY tib.transfer_item_id`,
        itemIds,
      );
      for (const c of costs.rows) {
        if (c.q > 1e-9) costByItem.set(c.item_id, c.c / c.q);
      }
    }
    const data = rows.rows
      .map((r) => {
        const inTransit = round2(r.shipped - r.received - r.lost);
        return {
          itemId: r.item_id,
          transferId: r.transfer_id,
          createdAt: r.created_at,
          status: r.status,
          note: r.note,
          fromDepot: r.from_depot,
          toDepot: r.to_depot,
          productId: r.product_id,
          product: r.product,
          variantName: r.variant_name,
          shipped: round2(r.shipped),
          received: round2(r.received),
          lost: round2(r.lost),
          discrepancyReason: r.reason,
          inTransit,
          // Coût des lots alloués en priorité ; stock SANS lots gérés → CUMP,
          // coût catalogue en dernier recours (jamais de transit à valeur 0).
          value:
            Math.round(
              inTransit *
                (costByItem.get(r.item_id) ??
                  r.avg_cost ??
                  r.purchase_price ??
                  0) *
                100,
            ) / 100,
        };
      })
      .filter((r) => r.inTransit > 1e-9 || r.lost > 1e-9);
    res.json({
      data,
      total: data.length,
      totalValue: Math.round(data.reduce((a, r) => a + r.value, 0) * 100) / 100,
    });
  }),
);

router.post(
  "/transfers/:id/cancel",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const done = await withTransaction(async (client) => {
      const tr = await client.query(
        "SELECT * FROM stock_transfers WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
        [req.params.id!, u.tenantId],
      );
      const transfer = tr.rows[0];
      if (!transfer) throw HttpError.notFound("Transfert introuvable.");
      if (
        transfer.status !== "PENDING" &&
        transfer.status !== "PARTIALLY_RECEIVED"
      )
        throw HttpError.conflict(
          "TRANSFER_CLOSED",
          "Ce transfert est déjà clôturé.",
        );
      // Gel inventaire (E5) : l'annulation recrédite le dépôt source.
      await assertDepotNotFrozen(client, u.tenantId, transfer.from_depot);
      const items = await client.query(
        "SELECT * FROM stock_transfer_items WHERE transfer_id=$1 ORDER BY id",
        [transfer.id],
      );
      for (const item of items.rows) {
        const scope = {
          tenantId: u.tenantId,
          depotId: transfer.from_depot,
          productId: item.product_id,
          variantId: item.variant_id,
        };
        // Annulation (E8 v2) : seul le RELIQUAT non résolu (ni reçu, ni perdu)
        // est recrédité à la source — la part déjà reçue reste à destination,
        // la part perdue reste valorisée comme écart.
        const consumed = round2(
          parseFloat(item.received_qty ?? "0") +
            parseFloat(item.lost_qty ?? "0"),
        );
        const remainder = round2(parseFloat(item.quantity) - consumed);
        if (remainder <= 1e-9) continue;
        const allocs = await client.query<{
          batch_id: string | null;
          batch_number: string;
          expiry_date: string | null;
          unit_cost: number;
          quantity: number;
        }>(
          "SELECT batch_id, batch_number, expiry_date, unit_cost::float, quantity::float FROM stock_transfer_item_batches WHERE transfer_item_id=$1 ORDER BY id",
          [item.id],
        );
        let seen = 0;
        let toCancel = remainder;
        for (const alloc of allocs.rows) {
          const consumedHere = Math.min(
            Math.max(0, Math.min(consumed - seen, alloc.quantity)),
            alloc.quantity,
          );
          const free = round2(alloc.quantity - consumedHere);
          seen = round2(seen + alloc.quantity);
          if (free <= 1e-9 || toCancel <= 1e-9) continue;
          const take = Math.min(free, toCancel);
          if (alloc.batch_id) {
            await client.query(
              "UPDATE stock_batches SET quantity = quantity + $2 WHERE id=$1",
              [alloc.batch_id, take],
            );
            const lvl = await increaseLevel(client, scope, take);
            await recordMovement(client, {
              ...scope,
              userId: u.id,
              type: "TRANSFER",
              quantity: take,
              previousStock: lvl.previous,
              newStock: lvl.next,
              reason: "Annulation de transfert",
              referenceId: transfer.id,
              batchId: alloc.batch_id,
              unitCost: alloc.unit_cost,
            });
          }
          toCancel = round2(toCancel - take);
        }
        if (toCancel > 1e-9) {
          const lvl = await increaseLevel(client, scope, toCancel);
          await recordMovement(client, {
            ...scope,
            userId: u.id,
            type: "TRANSFER",
            quantity: toCancel,
            previousStock: lvl.previous,
            newStock: lvl.next,
            reason: "Annulation de transfert (reliquat)",
            referenceId: transfer.id,
          });
        }
      }
      await client.query(
        "UPDATE stock_transfers SET status='CANCELLED' WHERE id=$1",
        [transfer.id],
      );
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "TRANSFER",
          entity: "transfer",
          entityId: transfer.id,
          previousState: { status: transfer.status },
          newState: { status: "CANCELLED" },
        },
        client,
      );
      return { status: "CANCELLED" };
    });
    res.json(done);
  }),
);

// ============================ AJUSTEMENTS / INVENTAIRE ======================
const adjustInput = z
  .object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullish(),
    depotId: z.string().uuid().optional(),
    type: z.enum(["ADJUSTMENT", "DAMAGE", "EXPIRED"]).default("ADJUSTMENT"),
    newQuantity: money.optional(),
    delta: z.number().finite().optional(),
    // Motif codifié d'analyse (E5) — le texte libre reste exigé pour la
    // traçabilité humaine ; le code alimente les statistiques d'écarts.
    reasonCode: z.enum(ADJUST_REASON_CODES).optional(),
    reason: z
      .string()
      .trim()
      .min(3, "Un motif détaillé est obligatoire")
      .max(2000),
  })
  .refine((v) => (v.newQuantity !== undefined) !== (v.delta !== undefined), {
    message: "Fournir soit newQuantity soit delta (pas les deux).",
  });

router.post(
  "/adjust",
  ...adminWrite,
  validateBody(adjustInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof adjustInput>;
    const depotId = resolveDepot(u, b.depotId);

    const result = await withTransaction(async (client) => {
      const scope = {
        tenantId: u.tenantId,
        depotId,
        productId: b.productId,
        variantId: b.variantId ?? null,
      };
      // Gel inventaire (E5) : aucun ajustement pendant un comptage « gelé ».
      await assertDepotNotFrozen(client, u.tenantId, depotId);
      const previous = await lockLevel(client, scope);
      const next =
        b.newQuantity !== undefined
          ? b.newQuantity
          : round2(previous + (b.delta ?? 0));
      if (next < 0)
        throw HttpError.badRequest(
          "STOCK_NEGATIVE",
          "Le stock ne peut pas devenir négatif.",
        );
      await setLevel(client, scope, next);

      // TYPE EXPIRED : réduit aussi les lots expirés correspondants
      if (b.type === "EXPIRED" && next < previous) {
        let toClear = previous - next;
        const batches = await client.query<{ id: string; quantity: string }>(
          `SELECT id, quantity FROM stock_batches
            WHERE product_id=$1 AND depot_id=$2 AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE AND quantity > 0
            ORDER BY expiry_date FOR UPDATE`,
          [b.productId, depotId],
        );
        for (const batch of batches.rows) {
          if (toClear <= 0) break;
          const take = Math.min(parseFloat(batch.quantity), toClear);
          await client.query(
            "UPDATE stock_batches SET quantity=quantity-$2 WHERE id=$1",
            [batch.id, take],
          );
          toClear -= take;
        }
      }

      // Valorisation du flux d'ajustement au CUMP courant (les sorties
      // n'altèrent pas le CUMP ; une entrée par ajustement est convention-
      // nellement valorisée au coût moyen — cf. docs/06_PLAN_EXPERT.md).
      const avg = await currentAvgCost(client, u.tenantId, b.productId);
      await recordMovement(client, {
        ...scope,
        userId: u.id,
        type: b.type,
        quantity: Math.abs(round2(next - previous)),
        previousStock: previous,
        newStock: next,
        reason: b.reasonCode ? `[${b.reasonCode}] ${b.reason}` : b.reason,
        reasonCode: b.reasonCode ?? null,
        unitCost: avg,
      });
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "ADJUST",
          entity: "stock",
          entityId: b.productId,
          depotId,
          previousState: { quantity: previous },
          newState: { quantity: next, type: b.type },
          details: b.reason,
        },
        client,
      );
      return { previous, next, delta: round2(next - previous) };
    });
    res.json(result);
  }),
);

// ============================ JOURNAL DES MOUVEMENTS (cursor) ===============
const movementQuery = z.object({
  productId: z.string().uuid().optional(),
  depotId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  type: z
    .enum([
      "IN",
      "OUT",
      "TRANSFER",
      "ADJUSTMENT",
      "SALE",
      "RETURN",
      "DAMAGE",
      "EXPIRED",
      "VOID",
      "SUPPLIER_RETURN",
    ])
    .optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  cursor: z.string().optional(),
  size: z.coerce.number().int().min(1).max(100).default(50),
});

router.get(
  "/movements",
  validateQuery(movementQuery),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const q = req.query as unknown as z.infer<typeof movementQuery>;
    const c = decodeCursor(q.cursor);
    // Bornes de dates calculées en JS (UTC) — aucune conversion date↔timestamptz en SQL.
    const fromTs = q.from ? new Date(`${q.from}T00:00:00.000Z`) : null;
    const toTs = q.to
      ? new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + 86_400_000)
      : null;

    const params: unknown[] = [t];
    const conds = ["sm.tenant_id = $1"];
    if (q.productId) conds.push(`sm.product_id = $${params.push(q.productId)}`);
    if (q.depotId) conds.push(`sm.depot_id = $${params.push(q.depotId)}`);
    if (q.userId) conds.push(`sm.user_id = $${params.push(q.userId)}`);
    if (q.type) conds.push(`sm.type = $${params.push(q.type)}`);
    if (fromTs) conds.push(`sm.created_at >= $${params.push(fromTs)}`);
    if (toTs) conds.push(`sm.created_at < $${params.push(toTs)}`);
    if (c) {
      // Curseur (created_at, id) décomposé : comparaisons simples, portable partout
      conds.push(
        `(sm.created_at < $${params.push(c.createdAt)} OR (sm.created_at = $${params.length} AND sm.id < $${params.push(c.id)}))`,
      );
    }
    const limitIdx = `$${params.push(q.size + 1)}`;

    const r = await query(
      `SELECT sm.*, p.name AS product_name, v.name AS variant_name, d.name AS depot_name, usr.name AS user_name
         FROM stock_movements sm
         JOIN products p ON p.id=sm.product_id
         LEFT JOIN product_variants v ON v.id=sm.variant_id
         JOIN depots d ON d.id=sm.depot_id
         LEFT JOIN users usr ON usr.id=sm.user_id
        WHERE ${conds.join(" AND ")}
        ORDER BY sm.created_at DESC, sm.id DESC
        LIMIT ${limitIdx}`,
      params,
    );
    const hasMore = r.rows.length > q.size;
    const rows = hasMore ? r.rows.slice(0, q.size) : r.rows;
    const last = rows[rows.length - 1];
    res.json({
      data: rows,
      nextCursor:
        hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    });
  }),
);

export default router;
