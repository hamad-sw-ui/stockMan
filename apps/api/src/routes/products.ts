import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../config/db";
import { h } from "../lib/asyncHandler";
import { HttpError } from "../lib/errors";
import { normHeader, parseCsv, parseMoney } from "../lib/csv";
import { writeAudit } from "../lib/audit";
import { pageParams, paged, pageQuerySchema } from "../lib/pagination";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import { requireActiveLicense } from "../middleware/license";
import {
  validateBody,
  validateParams,
  validateQuery,
  uuidParam,
  money,
} from "../middleware/validate";
import { increaseLevel, recordMovement } from "../services/stockService";
import { recordPriceChange } from "../services/pricingService";
import {
  drawInternalBarcode,
  dropPrimaryBarcode,
  findBarcodeHolder,
  poolWriter,
  resolveBarcode,
  syncPrimaryBarcode,
  tenantBarcodePrefix,
  throwBarcodeTaken,
} from "../services/barcodeService";
import { detectAndValidateBarcode } from "../lib/barcode";

const router = Router();
router.use(authenticate);
const adminWrite = [requireRole("ADMIN"), requireActiveLicense()];

/** C1/C2 — valide + normalise un code-barres saisi (GS1 ; null si absent). */
function normalizeBarcodeInput(raw: string | null | undefined) {
  if (!raw?.trim()) return null;
  const v = detectAndValidateBarcode(raw);
  if (!v.ok) throw HttpError.badRequest("BARCODE_INVALID", v.message);
  return v;
}

// ============================ LISTE (paginée, recherche réelle) =============
const listQuery = pageQuerySchema.extend({
  search: z.string().trim().max(200).default(""),
  categoryId: z.string().uuid().optional(),
  depotId: z.string().uuid().optional(),
  status: z.enum(["active", "low", "out", "archived"]).optional(),
});

router.get(
  "/",
  validateQuery(listQuery),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const { limit, offset } = pageParams(q);

    // Filtres optionnels composés en JS (sargable + pas de « $n IS NULL OR »
    // sur tables jointes). Totaux via sous-requêtes agrégées NON corrélées
    // (jointures 1:1) : sans effet de fanout variants × niveaux.
    const params: unknown[] = [t];
    const add = (v: unknown) => `$${params.push(v)}`;
    const conds = ["p.tenant_id = $1"];
    if (q.search) {
      const p = add(q.search);
      conds.push(
        `(p.name ILIKE '%'||${p}||'%' OR p.barcode = ${p} OR c.name ILIKE '%'||${p}||'%')`,
      );
    }
    if (q.categoryId) conds.push(`p.category_id = ${add(q.categoryId)}`);
    conds.push(
      q.status === "archived"
        ? "p.archived_at IS NOT NULL"
        : "p.archived_at IS NULL",
    );

    const depotJoin = q.depotId
      ? `LEFT JOIN (SELECT product_id, depot_id, SUM(quantity)::float AS depot_qty FROM stock_levels GROUP BY product_id, depot_id) ld
           ON ld.product_id = p.id AND ld.depot_id = ${add(q.depotId)}`
      : "";
    const where = `WHERE ${conds.join(" AND ")}`;
    const base = `
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN units un ON un.id = p.unit_id
      LEFT JOIN (SELECT product_id, SUM(quantity)::float AS total_qty FROM stock_levels GROUP BY product_id) lt
        ON lt.product_id = p.id
      ${depotJoin}
      LEFT JOIN (SELECT product_id, COUNT(*)::int AS variant_count FROM product_variants GROUP BY product_id) vc
        ON vc.product_id = p.id
      ${where}`;
    const statusFilter =
      q.status === "low"
        ? "AND COALESCE(lt.total_qty,0) <= p.min_stock_level AND COALESCE(lt.total_qty,0) > 0"
        : q.status === "out"
          ? "AND COALESCE(lt.total_qty,0) <= 0"
          : "";

    const countRes = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n ${base} ${statusFilter}`,
      params,
    );
    const depotQtySelect = q.depotId
      ? "COALESCE(ld.depot_qty, 0)::float"
      : "0::float";
    const rows = await query(
      `SELECT p.*, c.name AS category_name, un.symbol AS unit_symbol, un.base_value AS unit_base_value,
              un.is_base AS unit_is_base,
              ${depotQtySelect} AS depot_qty, COALESCE(lt.total_qty, 0)::float AS total_qty,
              COALESCE(vc.variant_count, 0)::int AS variant_count,
              CASE WHEN COALESCE(lt.total_qty,0) <= 0 THEN 'out'
                   WHEN COALESCE(lt.total_qty,0) <= p.min_stock_level THEN 'low' ELSE 'ok' END AS stock_status
       ${base} ${statusFilter}
       ORDER BY p.name LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json(paged(rows.rows, countRes.rows[0]!.n, q));
  }),
);

// ============================ RECHERCHE CODE-BARRES =========================
// C1 — résolveur unique (produit > variante > alias/conditionnement).
router.get(
  "/lookup/:code",
  validateParams(z.object({ code: z.string().trim().min(1).max(100) })),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    res.json(await resolveBarcode(t, String(req.params.code)));
  }),
);

// LEGACY (conservé à l'identique pour la compat: même forme de réponse) —
// délègue au résolveur C1, donc les alias fonctionnent AUSSI ici.
router.get(
  "/barcode/:code",
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const r = await resolveBarcode(t, String(req.params.code));
    // Forme historique : colonnes produit aplanies + variant_* le cas échéant.
    res.json({
      id: r.productId,
      name: r.productName,
      barcode: r.productBarcode,
      selling_price: r.sellingPrice,
      purchase_price: r.purchasePrice,
      tax_rate: r.taxRate,
      wholesale_price: r.wholesalePrice,
      wholesale_min_qty: r.wholesaleMinQty,
      has_variants: r.hasVariants,
      track_batch: r.trackBatch,
      requires_serial: r.requiresSerial,
      variant_id: r.variantId,
      variant_name: r.variantName,
      additional_price: r.additionalPrice,
      matched: r.variantId ? "variant" : "product",
      // Extensions (additives) : conditionnement résolu via alias.
      unit_id: r.unitId,
      unit_symbol: r.unitSymbol,
      unit_factor: r.unitFactor,
      alias: r.matched === "alias",
    });
  }),
);

// ---- C2 — génération interne EAN-13 (plage magasin 20–29) ---------------
// Articles sans code fabricant : tirage séquencé par tenant (jamais deux
// fois le même code, même en parallèle), re-tirage sur collision, source
// GENERATED. Cible SANS code → le code généré devient le principal
// (write-through colonne legacy) ; sinon simple alias.
const generateInput = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullish(),
  /** Présent → alias de conditionnement (jamais principal). */
  unitId: z.string().uuid().nullish(),
});

router.post(
  "/barcodes/generate",
  ...adminWrite,
  validateBody(generateInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof generateInput>;
    const prefix = await tenantBarcodePrefix(u.tenantId);
    const created = await withTransaction(async (client) => {
      const prod = await client.query(
        "SELECT id, name, barcode FROM products WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL",
        [b.productId, u.tenantId],
      );
      if (!prod.rows[0]) throw HttpError.notFound("Produit introuvable.");
      let legacyCode: string | null = prod.rows[0].barcode;
      let variantName: string | null = null;
      if (b.variantId) {
        const v = await client.query(
          "SELECT id, name, barcode FROM product_variants WHERE id=$1 AND product_id=$2",
          [b.variantId, b.productId],
        );
        if (!v.rows[0])
          throw HttpError.badRequest(
            "VARIANT_UNKNOWN",
            "Cette variante n'appartient pas au produit.",
          );
        legacyCode = v.rows[0].barcode;
        variantName = v.rows[0].name;
      }
      if (b.unitId) {
        const un = await client.query(
          "SELECT 1 FROM units WHERE id=$1 AND tenant_id=$2",
          [b.unitId, u.tenantId],
        );
        if (!un.rows[0])
          throw HttpError.badRequest("UNIT_UNKNOWN", "Unité inconnue.");
      }
      const asPrimary = !legacyCode && !b.unitId;
      const code = await drawInternalBarcode(client, u.tenantId, prefix);
      if (asPrimary) {
        if (b.variantId)
          await client.query(
            "UPDATE product_variants SET barcode=$2, updated_at=now() WHERE id=$1",
            [b.variantId, code],
          );
        else
          await client.query(
            "UPDATE products SET barcode=$2, updated_at=now() WHERE id=$1",
            [b.productId, code],
          );
      }
      const ins = await client.query(
        `INSERT INTO product_barcodes (tenant_id, product_id, variant_id, unit_id, code, symbology, source, is_primary, created_by)
         VALUES ($1,$2,$3,$4,$5,'EAN13','GENERATED',$6,$7) RETURNING *`,
        [
          u.tenantId,
          b.productId,
          b.variantId ?? null,
          b.unitId ?? null,
          code,
          asPrimary,
          u.id,
        ],
      );
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "CREATE",
          entity: "product_barcode",
          entityId: ins.rows[0].id,
          newState: {
            code,
            productId: b.productId,
            variantName,
            unitId: b.unitId ?? null,
            source: "GENERATED",
            isPrimary: asPrimary,
          },
          details: `Code-barres interne généré (préfixe magasin ${prefix}).`,
        },
        client,
      );
      return ins.rows[0];
    });
    res.status(201).json(created);
  }),
);

// ---- Alias / multi-codes (registre product_barcodes) --------------------

/** Liste les codes (principaux + alias) d'un produit, toutes cibles. */
router.get(
  "/:id/barcodes",
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const r = await query(
      `SELECT pb.id, pb.code, pb.symbology, pb.source, pb.is_primary,
              pb.variant_id, v.name AS variant_name,
              pb.unit_id, un.symbol AS unit_symbol, un.base_value::float AS unit_base_value,
              pb.created_at
         FROM product_barcodes pb
         JOIN products p ON p.id = pb.product_id
         LEFT JOIN product_variants v ON v.id = pb.variant_id
         LEFT JOIN units un ON un.id = pb.unit_id
        WHERE pb.tenant_id=$1 AND pb.product_id=$2
        ORDER BY pb.is_primary DESC, pb.created_at`,
      [u.tenantId, req.params.id!],
    );
    res.json({ rows: r.rows });
  }),
);

const aliasInput = z.object({
  code: z.string().trim().min(1).max(100),
  variantId: z.string().uuid().nullish(),
  /** Conditionnement codifié (ex. EAN du carton). */
  unitId: z.string().uuid().nullish(),
  source: z.enum(["REGISTERED", "SUPPLIER"]).default("REGISTERED"),
});

router.post(
  "/:id/barcodes",
  ...adminWrite,
  validateParams(uuidParam),
  validateBody(aliasInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof aliasInput>;
    const productId = req.params.id!;

    const verdict = detectAndValidateBarcode(b.code);
    if (!verdict.ok)
      throw HttpError.badRequest("BARCODE_INVALID", verdict.message);

    const created = await withTransaction(async (client) => {
      const owner = await client.query(
        "SELECT id FROM products WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL",
        [productId, u.tenantId],
      );
      if (!owner.rows[0]) throw HttpError.notFound("Produit introuvable.");
      if (b.variantId) {
        const v = await client.query(
          "SELECT 1 FROM product_variants WHERE id=$1 AND product_id=$2",
          [b.variantId, productId],
        );
        if (!v.rows[0])
          throw HttpError.badRequest(
            "VARIANT_UNKNOWN",
            "Cette variante n'appartient pas au produit.",
          );
      }
      if (b.unitId) {
        const un = await client.query(
          "SELECT 1 FROM units WHERE id=$1 AND tenant_id=$2",
          [b.unitId, u.tenantId],
        );
        if (!un.rows[0])
          throw HttpError.badRequest("UNIT_UNKNOWN", "Unité inconnue.");
      }
      // Idempotent (rejouer la même demande répond 200 avec l'existant) ;
      // conflit avec une AUTRE cible → 409 nommant le détenteur.
      const existing = await client.query(
        `SELECT pb.*, p.name AS product_name, v.name AS variant_name
           FROM product_barcodes pb
           JOIN products p ON p.id = pb.product_id
           LEFT JOIN product_variants v ON v.id = pb.variant_id
          WHERE pb.tenant_id=$1 AND pb.code=$2`,
        [u.tenantId, verdict.code],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        const sameTarget =
          row.product_id === productId &&
          (row.variant_id ?? null) === (b.variantId ?? null) &&
          (row.unit_id ?? null) === (b.unitId ?? null);
        if (sameTarget) return { row, already: true };
        const holder = await findBarcodeHolder(u.tenantId, verdict.code);
        if (holder) throwBarcodeTaken(holder, verdict.code);
      }
      // Code déjà porté par une colonne legacy (produit ou variante) ?
      const holder = await findBarcodeHolder(u.tenantId, verdict.code);
      if (holder) throwBarcodeTaken(holder, verdict.code);
      const ins = await client.query(
        `INSERT INTO product_barcodes (tenant_id, product_id, variant_id, unit_id, code, symbology, source, is_primary, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8) RETURNING *`,
        [
          u.tenantId,
          productId,
          b.variantId ?? null,
          b.unitId ?? null,
          verdict.code,
          verdict.symbology,
          b.source,
          u.id,
        ],
      );
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "CREATE",
          entity: "product_barcode",
          entityId: ins.rows[0].id,
          newState: {
            code: verdict.code,
            productId,
            variantId: b.variantId ?? null,
            unitId: b.unitId ?? null,
            symbology: verdict.symbology,
            source: b.source,
          },
        },
        client,
      );
      return { row: ins.rows[0], already: false };
    });
    res.status(created.already ? 200 : 201).json(created.row);
  }),
);

router.delete(
  "/barcodes/:id",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const removed = await withTransaction(async (client) => {
      const r = await client.query(
        `SELECT pb.*, p.name AS product_name FROM product_barcodes pb
           JOIN products p ON p.id = pb.product_id
          WHERE pb.id=$1 AND pb.tenant_id=$2`,
        [req.params.id!, u.tenantId],
      );
      if (!r.rows[0]) throw HttpError.notFound("Code-barres introuvable.");
      if (r.rows[0].is_primary)
        throw HttpError.badRequest(
          "BARCODE_PRIMARY",
          "Le code principal se retire depuis la fiche produit (champ code-barres).",
        );
      await client.query(
        "DELETE FROM product_barcodes WHERE id=$1 AND tenant_id=$2",
        [req.params.id!, u.tenantId],
      );
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "DELETE",
          entity: "product_barcode",
          entityId: req.params.id!,
          previousState: {
            code: r.rows[0].code,
            productId: r.rows[0].product_id,
            productName: r.rows[0].product_name,
          },
        },
        client,
      );
      return r.rows[0];
    });
    res.json({ deleted: true, code: removed.code });
  }),
);

// ============================ EXPORT CSV ====================================
router.get(
  "/export/csv",
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const r = await query(
      `SELECT p.name, c.name AS category, p.barcode, p.purchase_price, p.selling_price,
              COALESCE(lt.q,0)::float AS quantity, un.symbol AS unit, p.min_stock_level
         FROM products p
         LEFT JOIN categories c ON c.id=p.category_id
         LEFT JOIN units un ON un.id=p.unit_id
         LEFT JOIN (SELECT product_id, SUM(quantity)::float AS q FROM stock_levels GROUP BY product_id) lt
           ON lt.product_id=p.id
        WHERE p.tenant_id=$1 AND p.archived_at IS NULL
        ORDER BY p.name`,
      [t],
    );
    const header = [
      "Nom",
      "Catégorie",
      "Code-barres",
      "Prix achat",
      "Prix vente",
      "Quantité totale",
      "Unité",
      "Seuil alerte",
    ];
    const csv = [
      header,
      ...r.rows.map((row) => [
        row.name,
        row.category ?? "",
        row.barcode ?? "",
        row.purchase_price,
        row.selling_price,
        row.quantity,
        row.unit ?? "",
        row.min_stock_level,
      ]),
    ]
      .map((line) =>
        line
          .map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`)
          .join(";"),
      )
      .join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="catalogue-stockman.csv"',
    );
    res.send("﻿" + csv);
  }),
);

// ============================ IMPORT CSV ====================================
// Format : 1re ligne d'en-tête, séparateur « ; ». Colonnes reconnues (accents
// indifférents) : Nom (obligatoire) ; Catégorie ; Code-barres ; Prix achat ;
// Prix vente ; Unité (symbole ou nom) ; Seuil alerte. Les quantités ne sont
// PAS importées : le stock entre par les réceptions (traçabilité).
// Mise à jour si le code-barres (sinon le nom, casse indifférente) existe déjà.
const IMPORT_MAX_ROWS = 500;

router.post(
  "/import",
  ...adminWrite,
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const text = typeof req.body === "string" ? req.body : "";
    if (text.trim() === "") {
      throw HttpError.badRequest(
        "CSV_EMPTY",
        "Corps text/csv attendu : envoyez le fichier en brut (Content-Type: text/csv).",
      );
    }
    const rows = parseCsv(text);
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
      name: findCol(["nom", "produit", "designation", "name"]),
      category: findCol(["categorie", "categories", "category"]),
      barcode: findCol([
        "code barres",
        "code barre",
        "codebarres",
        "barcode",
        "ean",
      ]),
      purchase: findCol(["prix achat", "cout achat", "pa"], true),
      selling: findCol(["prix vente", "pv"], true),
      unit: findCol(["unite", "unites", "symbole", "unit"]),
      minStock: findCol(["seuil"], true),
    };
    if (cols.name < 0) {
      throw HttpError.badRequest(
        "CSV_HEADER",
        "Première ligne d’en-tête introuvable. Colonnes reconnues : Nom;Catégorie;Code-barres;Prix achat;Prix vente;Unité;Seuil alerte.",
      );
    }
    const dataRows = rows.slice(1);
    if (dataRows.length > IMPORT_MAX_ROWS) {
      throw HttpError.badRequest(
        "CSV_TOO_MANY",
        `Maximum ${IMPORT_MAX_ROWS} lignes par import (${dataRows.length} reçues) : découpez le fichier.`,
      );
    }

    const units = (
      await query<{
        id: string;
        name: string;
        symbol: string;
        is_base: boolean;
      }>("SELECT id, name, symbol, is_base FROM units WHERE tenant_id=$1", [
        u.tenantId,
      ])
    ).rows;
    const baseUnit = units.find((x) => x.is_base) ?? units[0] ?? null;

    let created = 0;
    let updated = 0;
    const errors: Array<{ ligne: number; message: string }> = [];
    const cell = (row: string[], idx: number) =>
      idx >= 0 ? (row[idx] ?? "").trim() : "";

    for (let i = 0; i < dataRows.length; i += 1) {
      const ligne = i + 2; // ligne 1 = en-tête
      const row = dataRows[i]!;
      try {
        const name = cell(row, cols.name);
        if (!name) throw new Error("Nom manquant.");
        if (name.length > 255)
          throw new Error("Nom trop long (255 caractères max).");

        const price = (idx: number, label: string) => {
          const raw = cell(row, idx);
          if (raw === "") return null;
          const m = parseMoney(raw);
          if (m === null || m < 0)
            throw new Error(`${label} illisible : « ${raw} ».`);
          return m;
        };
        const purchasePrice = price(cols.purchase, "Prix achat");
        const sellingPrice = price(cols.selling, "Prix vente");
        const minStock = price(cols.minStock, "Seuil alerte");
        // C1/C2 — code-barres validé + normalisé (GS1) ; une ligne invalide
        // est rejetée AVEC son motif, sans bloquer le reste du fichier.
        const barcodeRaw = cell(row, cols.barcode) || null;
        let barcode: string | null = null;
        let barcodeSymbology = "CODE39";
        if (barcodeRaw) {
          const v = detectAndValidateBarcode(barcodeRaw);
          if (!v.ok) throw new Error(v.message);
          barcode = v.code;
          barcodeSymbology = v.symbology;
        }

        // Unité : symbole ou nom connu ; cellule vide → unité de base du tenant.
        let unitId: string | null = null;
        const unitRaw = cell(row, cols.unit).toLowerCase();
        if (unitRaw) {
          const found = units.find(
            (un) =>
              un.symbol.toLowerCase() === unitRaw ||
              un.name.toLowerCase() === unitRaw,
          );
          if (!found) {
            throw new Error(
              `Unité inconnue « ${cell(row, cols.unit)} ». Connues : ${units.map((un) => un.symbol).join(", ")}.`,
            );
          }
          unitId = found.id;
        } else if (baseUnit) unitId = baseUnit.id;

        // Catégorie : retrouvée (casse indifférente) ou créée.
        let categoryId: string | null = null;
        const catRaw = cell(row, cols.category);
        if (catRaw) {
          const existing = await query<{ id: string }>(
            "SELECT id FROM categories WHERE tenant_id=$1 AND lower(name)=lower($2)",
            [u.tenantId, catRaw],
          );
          if (existing.rows[0]) categoryId = existing.rows[0].id;
          else {
            const ins = await query<{ id: string }>(
              "INSERT INTO categories (tenant_id, name) VALUES ($1,$2) RETURNING id",
              [u.tenantId, catRaw],
            );
            categoryId = ins.rows[0]!.id;
          }
        }

        // Produit existant : code-barres prioritaire, sinon nom (casse indifférente, non archivé).
        let product = null as null | {
          id: string;
          name: string;
          barcode: string | null;
        };
        if (barcode) {
          const r = await query<{
            id: string;
            name: string;
            barcode: string | null;
          }>(
            "SELECT id, name, barcode FROM products WHERE tenant_id=$1 AND barcode=$2 AND archived_at IS NULL",
            [u.tenantId, barcode],
          );
          product = r.rows[0] ?? null;
        }
        if (!product) {
          const r = await query<{
            id: string;
            name: string;
            barcode: string | null;
          }>(
            "SELECT id, name, barcode FROM products WHERE tenant_id=$1 AND lower(name)=lower($2) AND archived_at IS NULL LIMIT 1",
            [u.tenantId, name],
          );
          product = r.rows[0] ?? null;
        }

        if (product) {
          // Le code-barres du CSV ne doit pas entrer en conflit avec un AUTRE
          // détenteur (produit, variante OU alias du registre).
          if (barcode && product.barcode !== barcode) {
            const holder = await findBarcodeHolder(u.tenantId, barcode, {
              productId: product.id,
            });
            if (holder)
              throw new Error(
                `Code-barres ${barcode} déjà utilisé par « ${holder.productName} »${holder.variantName ? ` (variante « ${holder.variantName} »)` : ""}.`,
              );
          }
          await query(
            `UPDATE products SET
               purchase_price = COALESCE($3, purchase_price),
               selling_price  = COALESCE($4, selling_price),
               min_stock_level= COALESCE($5, min_stock_level),
               category_id    = COALESCE($6, category_id),
               unit_id        = COALESCE($7, unit_id),
               barcode        = COALESCE($8, barcode),
               updated_at     = now()
             WHERE id=$1 AND tenant_id=$2`,
            [
              product.id,
              u.tenantId,
              purchasePrice,
              sellingPrice,
              minStock,
              categoryId,
              unitId,
              barcode,
            ],
          );
          if (barcode)
            await syncPrimaryBarcode(poolWriter, {
              tenantId: u.tenantId,
              productId: product.id,
              code: barcode,
              symbology: barcodeSymbology,
              source: "IMPORTED",
              userId: u.id,
            });
          updated += 1;
        } else {
          // Garde globale : le code ne doit être détenu par PERSONNE
          // (l'index unique ne couvrait que la colonne produit).
          if (barcode) {
            const holder = await findBarcodeHolder(u.tenantId, barcode);
            if (holder)
              throw new Error(
                `Code-barres ${barcode} déjà utilisé par « ${holder.productName} »${holder.variantName ? ` (variante « ${holder.variantName} »)` : ""}.`,
              );
          }
          const ins = await query<{ id: string }>(
            `INSERT INTO products (tenant_id, name, barcode, purchase_price, selling_price, min_stock_level, category_id, unit_id)
             VALUES ($1,$2,$3,COALESCE($4,0),COALESCE($5,0),COALESCE($6,0),$7,$8) RETURNING id`,
            [
              u.tenantId,
              name,
              barcode,
              purchasePrice,
              sellingPrice,
              minStock,
              categoryId,
              unitId,
            ],
          );
          if (barcode)
            await syncPrimaryBarcode(poolWriter, {
              tenantId: u.tenantId,
              productId: ins.rows[0]!.id,
              code: barcode,
              symbology: barcodeSymbology,
              source: "IMPORTED",
              userId: u.id,
            });
          created += 1;
        }
      } catch (err) {
        if (errors.length < 100) {
          errors.push({
            ligne,
            message: err instanceof Error ? err.message : "Erreur inconnue",
          });
        }
      }
    }

    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "IMPORT",
      entity: "product",
      details: `Import CSV : ${created} créés, ${updated} mis à jour, ${errors.length} erreur(s) sur ${dataRows.length} ligne(s).`,
    });
    res.json({ created, updated, errors, total: dataRows.length });
  }),
);

// ============================ DÉTAIL (variantes, lots, niveaux) =============
router.get(
  "/:id",
  validateParams(uuidParam),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const p = await query(
      `SELECT p.*, c.name AS category_name, un.symbol AS unit_symbol, un.base_value AS unit_base_value
         FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN units un ON un.id=p.unit_id
        WHERE p.id=$1 AND p.tenant_id=$2`,
      [req.params.id!, t],
    );
    if (!p.rows[0]) throw HttpError.notFound("Produit introuvable.");
    const [variants, batches, levels, movements] = await Promise.all([
      query(
        "SELECT * FROM product_variants WHERE product_id=$1 ORDER BY name",
        [req.params.id],
      ),
      query(
        `SELECT b.*, s.name AS supplier_name, d.name AS depot_name FROM stock_batches b
           LEFT JOIN suppliers s ON s.id=b.supplier_id LEFT JOIN depots d ON d.id=b.depot_id
          WHERE b.product_id=$1 ORDER BY b.expiry_date ASC NULLS LAST, b.received_date ASC LIMIT 200`,
        [req.params.id],
      ),
      query(
        `SELECT sl.*, d.name AS depot_name, v.name AS variant_name FROM stock_levels sl
           JOIN depots d ON d.id=sl.depot_id LEFT JOIN product_variants v ON v.id=sl.variant_id
          WHERE sl.product_id=$1 ORDER BY d.name`,
        [req.params.id],
      ),
      query(
        `SELECT sm.type, sm.quantity, sm.previous_stock, sm.new_stock, sm.reason, sm.created_at,
                d.name AS depot_name, usr.name AS user_name
           FROM stock_movements sm
           JOIN depots d ON d.id=sm.depot_id LEFT JOIN users usr ON usr.id=sm.user_id
          WHERE sm.tenant_id=$1 AND sm.product_id=$2 ORDER BY sm.created_at DESC LIMIT 20`,
        [t, req.params.id],
      ),
    ]);
    res.json({
      ...p.rows[0],
      variants: variants.rows,
      batches: batches.rows,
      levels: levels.rows,
      recentMovements: movements.rows,
    });
  }),
);

// ============================ CRÉATION ======================================
const variantInput = z.object({
  name: z.string().trim().min(1).max(255),
  sku: z.string().trim().max(100).nullish(),
  barcode: z.string().trim().max(100).nullish(),
  additionalPrice: money.default(0),
  attributes: z.record(z.string()).default({}),
});

const productInput = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(4000).nullish(),
  categoryId: z.string().uuid().nullish(),
  barcode: z.string().trim().max(100).nullish(),
  purchasePrice: money.default(0),
  sellingPrice: money.default(0),
  minStockLevel: money.default(0),
  unitId: z.string().uuid().nullish(),
  hasVariants: z.boolean().default(false),
  /** E7 — taux de TVA en % (prix catalogue = TTC ; 19,25 normal, 0 exonéré). */
  taxRate: z.coerce.number().min(0).max(100).default(19.25),
  /** Gestion par lot obligatoire (E2) : numéro de lot exigé à chaque entrée,
   *  prélevement FEFO tracé et rapport de rappel disponible. */
  trackBatch: z.boolean().default(false),
  /** E8 — prix de GROS TTC (unité de base) + seuil d'application ; NULL =
   *  pas de grille de gros pour ce produit. */
  wholesalePrice: money.nullish(),
  wholesaleMinQty: money.default(0),
  /** E8 — sérialisation (IMEI / n° de série) : vente/entrée à l'unité de
   *  base identifiée par un numéro unique. */
  requiresSerial: z.boolean().default(false),
  /** C5 — article à pesée : `barcode` porte alors le code article balance
   *  « PPAAAAA » (7 chiffres, préfixe magasin 20–29) ; l'étiquette EAN-13
   *  émise embarque prix (PRICE) ou poids (WEIGHT), décodés à la caisse. */
  isWeighed: z.boolean().default(false),
  /** E8 — motif du changement de prix (PATCH), versé à l'historique. */
  priceChangeReason: z.string().trim().max(500).nullish(),
  variants: z.array(variantInput).max(200).default([]),
  initialStock: z
    .object({
      depotId: z.string().uuid(),
      quantity: money.default(0),
      batchNumber: z.string().trim().max(100).optional(),
      expiryDate: z.string().date().nullish(),
    })
    .nullish(),
});

router.post(
  "/",
  ...adminWrite,
  validateBody(productInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof productInput>;
    if (b.hasVariants && b.variants.length === 0) {
      throw HttpError.badRequest(
        "VARIANTS_REQUIRED",
        "Déclarez au moins une variante ou désactivez hasVariants.",
      );
    }
    // C1/C2 — codes-barres : validation GS1 (checksums, normalisation) +
    // garde d'unicité globale (produit / variantes / alias) nommant le
    // détenteur, AVANT toute écriture.
    const pCode = normalizeBarcodeInput(b.barcode);
    const vCodes = b.variants.map((v) => normalizeBarcodeInput(v.barcode));
    const allCodes = [pCode, ...vCodes].filter(
      (c): c is NonNullable<typeof c> => c !== null,
    );
    const seen = new Set<string>();
    for (const c of allCodes) {
      if (seen.has(c.code))
        throw HttpError.badRequest(
          "BARCODE_DUP_IN_FORM",
          `Le code-barres ${c.code} apparaît deux fois dans le formulaire.`,
        );
      seen.add(c.code);
      const holder = await findBarcodeHolder(u.tenantId, c.code);
      if (holder) throwBarcodeTaken(holder, c.code);
    }
    const created = await withTransaction(async (client) => {
      const r = await client.query(
        `INSERT INTO products (tenant_id, name, description, category_id, barcode, purchase_price, selling_price, min_stock_level, unit_id, has_variants, track_batch, avg_cost, tax_rate, wholesale_price, wholesale_min_qty, requires_serial, is_weighed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [
          u.tenantId,
          b.name,
          b.description ?? null,
          b.categoryId ?? null,
          pCode?.code ?? null,
          b.purchasePrice,
          b.sellingPrice,
          b.minStockLevel,
          b.unitId ?? null,
          b.hasVariants,
          b.trackBatch,
          b.purchasePrice, // CUMP initial = coût catalogue déclaré
          b.taxRate,
          b.wholesalePrice ?? null,
          b.wholesaleMinQty,
          b.requiresSerial,
          b.isWeighed,
        ],
      );
      const product = r.rows[0];
      // Write-through : le code principal alimente le registre d'alias.
      if (pCode)
        await syncPrimaryBarcode(client, {
          tenantId: u.tenantId,
          productId: product.id,
          code: pCode.code,
          symbology: pCode.symbology,
          userId: u.id,
        });
      for (let i = 0; i < b.variants.length; i += 1) {
        const v = b.variants[i]!;
        const vc = vCodes[i] ?? null;
        const vr = await client.query(
          `INSERT INTO product_variants (product_id, name, sku, barcode, additional_price, attributes)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [
            product.id,
            v.name,
            v.sku ?? null,
            vc?.code ?? null,
            v.additionalPrice,
            JSON.stringify(v.attributes),
          ],
        );
        if (vc)
          await syncPrimaryBarcode(client, {
            tenantId: u.tenantId,
            productId: product.id,
            variantId: vr.rows[0].id,
            code: vc.code,
            symbology: vc.symbology,
            userId: u.id,
          });
      }
      if (b.initialStock && b.initialStock.quantity > 0) {
        const depotOk = await client.query(
          "SELECT 1 FROM depots WHERE id=$1 AND tenant_id=$2",
          [b.initialStock.depotId, u.tenantId],
        );
        if (!depotOk.rows[0])
          throw HttpError.badRequest(
            "DEPOT_UNKNOWN",
            "Dépôt du stock initial introuvable.",
          );
        const scope = {
          tenantId: u.tenantId,
          depotId: b.initialStock.depotId,
          productId: product.id,
          variantId: null,
        };
        const lvl = await increaseLevel(client, scope, b.initialStock.quantity);
        if (b.initialStock.batchNumber || b.initialStock.expiryDate) {
          await client.query(
            `INSERT INTO stock_batches (product_id, depot_id, batch_number, quantity, expiry_date)
             VALUES ($1,$2,$3,$4,$5)`,
            [
              product.id,
              b.initialStock.depotId,
              b.initialStock.batchNumber ?? "INITIAL",
              b.initialStock.quantity,
              b.initialStock.expiryDate ?? null,
            ],
          );
        }
        await recordMovement(client, {
          ...scope,
          userId: u.id,
          type: "IN",
          quantity: b.initialStock.quantity,
          previousStock: lvl.previous,
          newStock: lvl.next,
          reason: "Stock initial",
        });
      }
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "CREATE",
          entity: "product",
          entityId: product.id,
          newState: product,
        },
        client,
      );
      return product;
    });
    res.status(201).json(created);
  }),
);

// ============================ MISE À JOUR COMPLÈTE ==========================
router.patch(
  "/:id",
  ...adminWrite,
  validateParams(uuidParam),
  validateBody(
    productInput.omit({ initialStock: true, variants: true }).partial(),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const prev = await query(
      "SELECT * FROM products WHERE id=$1 AND tenant_id=$2",
      [req.params.id!, u.tenantId],
    );
    if (!prev.rows[0]) throw HttpError.notFound("Produit introuvable.");
    const prevRow = prev.rows[0] as {
      selling_price: string;
      wholesale_price: string | null;
    };
    const b = req.body;
    // C1/C2 — code-barres : validation GS1 + unicité hors soi-même. La clé
    // « barcode » PRÉSENTE (même à null) pilote le champ (CASE WHEN) : un
    // null explicite retire le code (et son miroir dans le registre).
    const barcodeDefined = b.barcode !== undefined;
    const pCode = normalizeBarcodeInput(b.barcode);
    if (pCode) {
      const holder = await findBarcodeHolder(u.tenantId, pCode.code, {
        productId: req.params.id!,
      });
      if (holder) throwBarcodeTaken(holder, pCode.code);
    }
    const r = await withTransaction(async (client) => {
      // E8 — historique horodaté des changements de prix AVANT l'update
      // (détail & gros, avec motif déclaré le cas échéant).
      if (b.sellingPrice !== undefined)
        await recordPriceChange(client, {
          tenantId: u.tenantId,
          productId: req.params.id!,
          field: "DETAIL",
          oldPrice: parseFloat(prevRow.selling_price),
          newPrice: b.sellingPrice,
          changedBy: u.id,
          reason: b.priceChangeReason ?? null,
        });
      if (b.wholesalePrice !== undefined)
        await recordPriceChange(client, {
          tenantId: u.tenantId,
          productId: req.params.id!,
          field: "WHOLESALE",
          oldPrice:
            prevRow.wholesale_price == null
              ? null
              : parseFloat(prevRow.wholesale_price),
          newPrice: b.wholesalePrice ?? null,
          changedBy: u.id,
          reason: b.priceChangeReason ?? null,
        });
      const upd = await client.query(
        `UPDATE products SET name=COALESCE($3,name), description=COALESCE($4,description),
                category_id=COALESCE($5,category_id),
                barcode=CASE WHEN $6::boolean THEN $7 ELSE barcode END,
                purchase_price=COALESCE($8,purchase_price), selling_price=COALESCE($9,selling_price),
                min_stock_level=COALESCE($10,min_stock_level), unit_id=COALESCE($11,unit_id),
                has_variants=COALESCE($12,has_variants), track_batch=COALESCE($13,track_batch),
                tax_rate=COALESCE($14,tax_rate),
                wholesale_min_qty=COALESCE($15,wholesale_min_qty),
                requires_serial=COALESCE($16,requires_serial),
                wholesale_price=CASE WHEN $17::boolean THEN $18 ELSE wholesale_price END,
                is_weighed=COALESCE($19,is_weighed),
                updated_at=now()
          WHERE id=$1 AND tenant_id=$2 RETURNING *`,
        [
          req.params.id!,
          u.tenantId,
          b.name ?? null,
          b.description ?? null,
          b.categoryId ?? null,
          barcodeDefined, // présence de la clé (null explicite = retrait)
          pCode?.code ?? null,
          b.purchasePrice ?? null,
          b.sellingPrice ?? null,
          b.minStockLevel ?? null,
          b.unitId ?? null,
          b.hasVariants ?? null,
          b.trackBatch ?? null,
          b.taxRate ?? null,
          b.wholesaleMinQty ?? null,
          b.requiresSerial ?? null,
          b.wholesalePrice !== undefined, // NULL explicite = grille de gros retirée
          b.wholesalePrice ?? null,
          b.isWeighed ?? null,
        ],
      );
      // Write-through registre : miroir du code principal (pose ou retrait).
      if (barcodeDefined) {
        if (pCode)
          await syncPrimaryBarcode(client, {
            tenantId: u.tenantId,
            productId: req.params.id!,
            code: pCode.code,
            symbology: pCode.symbology,
            userId: u.id,
          });
        else
          await dropPrimaryBarcode(client, {
            tenantId: u.tenantId,
            productId: req.params.id!,
          });
      }
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "UPDATE",
          entity: "product",
          entityId: req.params.id!,
          previousState: prev.rows[0],
          newState: upd.rows[0],
        },
        client,
      );
      return upd;
    });
    res.json(r.rows[0]);
  }),
);

// ============================ PARAMÈTRES PAR DÉPÔT (E8) =====================
// Seuil d'alerte surchargeable par dépôt + rayonnage (bin location) —
// l'organisation physique diffère d'un dépôt à l'autre.
router.get(
  "/:id/depot-settings",
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const r = await query(
      `SELECT d.id AS depot_id, d.name AS depot_name,
              pds.min_stock_level::float, pds.bin_location, pds.updated_at
         FROM depots d
         LEFT JOIN product_depot_settings pds
           ON pds.depot_id = d.id AND pds.product_id = $1
        WHERE d.tenant_id = $2 AND d.is_active
        ORDER BY d.name`,
      [req.params.id!, u.tenantId],
    );
    res.json(r.rows);
  }),
);

const depotSettingsInput = z.object({
  depotId: z.string().uuid(),
  /** NULL = hériter du seuil catalogue. */
  minStockLevel: money.nullish(),
  binLocation: z.string().trim().max(60).nullish(),
});

router.put(
  "/:id/depot-settings",
  ...adminWrite,
  validateParams(uuidParam),
  validateBody(depotSettingsInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof depotSettingsInput>;
    const saved = await withTransaction(async (client) => {
      const prod = await client.query<{ id: string }>(
        "SELECT id FROM products WHERE id=$1 AND tenant_id=$2",
        [req.params.id!, u.tenantId],
      );
      if (!prod.rows[0]) throw HttpError.notFound("Produit introuvable.");
      const dep = await client.query<{ id: string }>(
        "SELECT id FROM depots WHERE id=$1 AND tenant_id=$2",
        [b.depotId, u.tenantId],
      );
      if (!dep.rows[0])
        throw HttpError.badRequest("DEPOT_UNKNOWN", "Dépôt introuvable.");
      const r = await client.query(
        `INSERT INTO product_depot_settings (tenant_id, product_id, depot_id, min_stock_level, bin_location, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,now())
         ON CONFLICT (product_id, depot_id)
         DO UPDATE SET min_stock_level=$4, bin_location=$5, updated_by=$6, updated_at=now()
         RETURNING min_stock_level::float, bin_location, updated_at`,
        [
          u.tenantId,
          req.params.id!,
          b.depotId,
          b.minStockLevel ?? null,
          b.binLocation ?? null,
          u.id,
        ],
      );
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "UPDATE",
          entity: "product_depot_settings",
          entityId: req.params.id!,
          depotId: b.depotId,
          newState: {
            minStockLevel: b.minStockLevel ?? null,
            binLocation: b.binLocation ?? null,
          },
        },
        client,
      );
      return r.rows[0];
    });
    res.json(saved);
  }),
);

// ============================ ARCHIVAGE (soft-delete, DAT-05) ===============
router.post(
  "/:id/archive",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const r = await query(
      "UPDATE products SET archived_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL RETURNING id, name",
      [req.params.id!, u.tenantId],
    );
    if (!r.rows[0])
      throw HttpError.notFound("Produit introuvable ou déjà archivé.");
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "ARCHIVE",
      entity: "product",
      entityId: req.params.id!,
      newState: r.rows[0],
    });
    res.json({
      message: `« ${r.rows[0].name} » archivé. L'historique des ventes est conservé.`,
    });
  }),
);

// ============================ ARCHIVAGE EN LOT (actions groupées) ==========
// Soft-delete transactionnel de plusieurs produits du tenant (sélection
// multiple de la liste catalogue), journalisé. N'archive que les produits
// actifs ; renvoie le nombre réellement archivé (idempotent).
router.post(
  "/bulk-archive",
  ...adminWrite,
  validateBody(
    z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const { ids } = req.body as { ids: string[] };
    const unique = [...new Set(ids)];
    const ph = unique.map((_, i) => `$${i + 2}`).join(",");
    const r = await withTransaction(async (client) => {
      const upd = await client.query(
        `UPDATE products SET archived_at=now(), updated_at=now()
          WHERE tenant_id=$1 AND id IN (${ph}) AND archived_at IS NULL
          RETURNING id, name`,
        [u.tenantId, ...unique],
      );
      for (const row of upd.rows) {
        await writeAudit(
          {
            tenantId: u.tenantId,
            userId: u.id,
            userName: u.name,
            action: "ARCHIVE",
            entity: "product",
            entityId: row.id,
            newState: row,
          },
          client,
        );
      }
      return upd.rowCount ?? 0;
    });
    res.json({ archived: r });
  }),
);

router.post(
  "/:id/restore",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const r = await query(
      "UPDATE products SET archived_at=NULL, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND archived_at IS NOT NULL RETURNING id, name",
      [req.params.id!, u.tenantId],
    );
    if (!r.rows[0]) throw HttpError.notFound("Produit archivé introuvable.");
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "RESTORE",
      entity: "product",
      entityId: req.params.id!,
      newState: r.rows[0],
    });
    res.json({ message: `« ${r.rows[0].name} » restauré.` });
  }),
);

// ============================ VARIANTES =====================================
router.post(
  "/:id/variants",
  ...adminWrite,
  validateParams(uuidParam),
  validateBody(variantInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const owner = await query(
      "SELECT id FROM products WHERE id=$1 AND tenant_id=$2",
      [req.params.id!, u.tenantId],
    );
    if (!owner.rows[0]) throw HttpError.notFound("Produit introuvable.");
    const b = req.body;
    // C1/C2 — validation GS1 + unicité globale avant insertion (correctif
    // majeur : product_variants.barcode n'avait AUCUNE contrainte d'unicité).
    const vCode = normalizeBarcodeInput(b.barcode);
    if (vCode) {
      const holder = await findBarcodeHolder(u.tenantId, vCode.code);
      if (holder) throwBarcodeTaken(holder, vCode.code);
    }
    const createdVariant = await withTransaction(async (client) => {
      const r = await client.query(
        `INSERT INTO product_variants (product_id, name, sku, barcode, additional_price, attributes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          req.params.id!,
          b.name,
          b.sku ?? null,
          vCode?.code ?? null,
          b.additionalPrice,
          JSON.stringify(b.attributes),
        ],
      );
      if (vCode)
        await syncPrimaryBarcode(client, {
          tenantId: u.tenantId,
          productId: req.params.id!,
          variantId: r.rows[0].id,
          code: vCode.code,
          symbology: vCode.symbology,
          userId: u.id,
        });
      await client.query("UPDATE products SET has_variants=true WHERE id=$1", [
        req.params.id,
      ]);
      return r.rows[0];
    });
    res.status(201).json(createdVariant);
  }),
);

router.patch(
  "/variants/:id",
  ...adminWrite,
  validateParams(uuidParam),
  validateBody(variantInput.partial()),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body;
    // C1/C2 — validation GS1 + unicité hors cette variante (null explicite
    // = retrait du code, miroir dans le registre).
    const barcodeDefined = b.barcode !== undefined;
    const vCode = normalizeBarcodeInput(b.barcode);
    if (vCode) {
      const holder = await findBarcodeHolder(u.tenantId, vCode.code, {
        variantId: req.params.id!,
      });
      if (holder) throwBarcodeTaken(holder, vCode.code);
    }
    const updatedVariant = await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE product_variants v SET name=COALESCE($2,name), sku=COALESCE($3,sku),
                barcode=CASE WHEN $4::boolean THEN $5 ELSE barcode END,
                additional_price=COALESCE($6,additional_price), attributes=COALESCE($7,attributes), updated_at=now()
           FROM products p
          WHERE v.id=$1 AND v.product_id=p.id AND p.tenant_id=$8
          RETURNING v.*`,
        [
          req.params.id!,
          b.name ?? null,
          b.sku ?? null,
          barcodeDefined,
          vCode?.code ?? null,
          b.additionalPrice ?? null,
          b.attributes ? JSON.stringify(b.attributes) : null,
          u.tenantId,
        ],
      );
      if (!r.rows[0]) throw HttpError.notFound("Variante introuvable.");
      if (barcodeDefined) {
        if (vCode)
          await syncPrimaryBarcode(client, {
            tenantId: u.tenantId,
            productId: r.rows[0].product_id,
            variantId: req.params.id!,
            code: vCode.code,
            symbology: vCode.symbology,
            userId: u.id,
          });
        else
          await dropPrimaryBarcode(client, {
            tenantId: u.tenantId,
            productId: r.rows[0].product_id,
            variantId: req.params.id!,
          });
      }
      return r.rows[0];
    });
    res.json(updatedVariant);
  }),
);

router.delete(
  "/variants/:id",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const v = await query(
      `SELECT v.id, v.product_id FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.id=$1 AND p.tenant_id=$2`,
      [req.params.id!, u.tenantId],
    );
    if (!v.rows[0]) throw HttpError.notFound("Variante introuvable.");
    const used = await query(
      `SELECT
         (SELECT COUNT(*) FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.variant_id=$1 AND s.tenant_id=$2)::int AS sales,
         (SELECT COALESCE(SUM(quantity),0) FROM stock_levels WHERE variant_id=$1)::float AS stock`,
      [req.params.id!, u.tenantId],
    );
    if ((used.rows[0]!.sales ?? 0) > 0 || (used.rows[0]!.stock ?? 0) > 0) {
      throw HttpError.conflict(
        "VARIANT_IN_USE",
        "Variante liée à des ventes ou du stock : suppression impossible.",
      );
    }
    await query("DELETE FROM product_variants WHERE id=$1", [req.params.id!]);
    const remaining = await query(
      "SELECT COUNT(*)::int AS n FROM product_variants WHERE product_id=$1",
      [v.rows[0].product_id],
    );
    if (remaining.rows[0]!.n === 0)
      await query("UPDATE products SET has_variants=false WHERE id=$1", [
        v.rows[0].product_id,
      ]);
    res.json({ message: "Variante supprimée." });
  }),
);

// ============================ LOTS ==========================================
const batchInput = z.object({
  depotId: z.string().uuid(),
  batchNumber: z.string().trim().min(1).max(100),
  quantity: money.min(0).default(0),
  expiryDate: z.string().date().nullish(),
  receivedDate: z.string().date().nullish(),
  supplierId: z.string().uuid().nullish(),
});

router.post(
  "/:id/batches",
  ...adminWrite,
  validateParams(uuidParam),
  validateBody(batchInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof batchInput>;
    const owner = await query(
      "SELECT id FROM products WHERE id=$1 AND tenant_id=$2",
      [req.params.id!, u.tenantId],
    );
    if (!owner.rows[0]) throw HttpError.notFound("Produit introuvable.");
    const r = await query(
      `INSERT INTO stock_batches (product_id, depot_id, batch_number, quantity, expiry_date, received_date, supplier_id)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, CURRENT_DATE),$7) RETURNING *`,
      [
        req.params.id!,
        b.depotId,
        b.batchNumber,
        b.quantity,
        b.expiryDate ?? null,
        b.receivedDate ?? null,
        b.supplierId ?? null,
      ],
    );
    res.status(201).json(r.rows[0]);
  }),
);

router.patch(
  "/batches/:id",
  ...adminWrite,
  validateParams(uuidParam),
  validateBody(batchInput.partial().omit({ depotId: true })),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body;
    const r = await query(
      `UPDATE stock_batches sb SET batch_number=COALESCE($2,batch_number), quantity=COALESCE($3,quantity),
              expiry_date=COALESCE($4,expiry_date), supplier_id=COALESCE($5,supplier_id)
         FROM products p
        WHERE sb.id=$1 AND sb.product_id=p.id AND p.tenant_id=$6 RETURNING sb.*`,
      [
        req.params.id!,
        b.batchNumber ?? null,
        b.quantity ?? null,
        b.expiryDate ?? null,
        b.supplierId ?? null,
        u.tenantId,
      ],
    );
    if (!r.rows[0]) throw HttpError.notFound("Lot introuvable.");
    res.json(r.rows[0]);
  }),
);

router.delete(
  "/batches/:id",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = await query(
      `SELECT sb.id, sb.quantity FROM stock_batches sb JOIN products p ON p.id = sb.product_id
        WHERE sb.id=$1 AND p.tenant_id=$2`,
      [req.params.id!, u.tenantId],
    );
    if (!b.rows[0]) throw HttpError.notFound("Lot introuvable.");
    if (Number(b.rows[0].quantity) !== 0) {
      throw HttpError.conflict(
        "BATCH_NOT_EMPTY",
        "Seul un lot épuisé (quantité 0) peut être supprimé.",
      );
    }
    await query("DELETE FROM stock_batches WHERE id=$1", [req.params.id!]);
    res.json({ message: "Lot supprimé." });
  }),
);

export default router;
