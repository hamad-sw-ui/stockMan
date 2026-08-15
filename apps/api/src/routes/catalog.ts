import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db";
import { h } from "../lib/asyncHandler";
import { HttpError } from "../lib/errors";
import { writeAudit } from "../lib/audit";
import { parseCsv, normHeader, buildCsv } from "../lib/csv";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import { requireActiveLicense } from "../middleware/license";
import {
  validateBody,
  validateParams,
  uuidParam,
} from "../middleware/validate";

/**
 * Référentiels simples : catégories, unités, dépôts, fournisseurs.
 * Règle RBAC : VENDEUR = lecture seule (corrige SEC-05).
 */
const router = Router();
router.use(authenticate);

const adminWrite = [requireRole("ADMIN"), requireActiveLicense()];

// ============================ CATÉGORIES ====================================
router.get(
  "/categories",
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const r = await query(
      `SELECT c.*, COALESCE(pc.c, 0)::int AS product_count
         FROM categories c
         LEFT JOIN (SELECT category_id, COUNT(*)::int AS c FROM products WHERE archived_at IS NULL GROUP BY category_id) pc
           ON pc.category_id = c.id
        WHERE c.tenant_id=$1 ORDER BY c.sort_order, c.name`,
      [t],
    );
    res.json(r.rows);
  }),
);

const categorySchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2000).nullish(),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

router.post(
  "/categories",
  ...adminWrite,
  validateBody(categorySchema),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const r = await query(
      "INSERT INTO categories (tenant_id, name, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *",
      [
        u.tenantId,
        req.body.name,
        req.body.description ?? null,
        req.body.sortOrder,
      ],
    );
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "CREATE",
      entity: "category",
      entityId: r.rows[0]?.id ?? null,
      newState: r.rows[0],
    });
    res.status(201).json(r.rows[0]);
  }),
);

router.patch(
  "/categories/:id",
  ...adminWrite,
  validateParams(uuidParam),
  validateBody(categorySchema.partial()),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const prev = await query(
      "SELECT * FROM categories WHERE id=$1 AND tenant_id=$2",
      [req.params.id!, u.tenantId],
    );
    if (!prev.rows[0]) throw HttpError.notFound("Catégorie introuvable.");
    const r = await query(
      "UPDATE categories SET name=COALESCE($3,name), description=COALESCE($4,description), sort_order=COALESCE($5,sort_order) WHERE id=$1 AND tenant_id=$2 RETURNING *",
      [
        req.params.id!,
        u.tenantId,
        req.body.name ?? null,
        req.body.description ?? null,
        req.body.sortOrder ?? null,
      ],
    );
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "UPDATE",
      entity: "category",
      entityId: req.params.id!,
      previousState: prev.rows[0],
      newState: r.rows[0],
    });
    res.json(r.rows[0]);
  }),
);

router.delete(
  "/categories/:id",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const used = await query(
      "SELECT 1 FROM products WHERE category_id=$1 LIMIT 1",
      [req.params.id],
    );
    if (used.rows[0])
      throw HttpError.conflict(
        "CATEGORY_IN_USE",
        "Catégorie utilisée par des produits : suppression impossible.",
      );
    const r = await query(
      "DELETE FROM categories WHERE id=$1 AND tenant_id=$2 RETURNING id, name",
      [req.params.id!, u.tenantId],
    );
    if (!r.rows[0]) throw HttpError.notFound("Catégorie introuvable.");
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "DELETE",
      entity: "category",
      entityId: req.params.id!,
      previousState: r.rows[0],
    });
    res.json({ message: "Catégorie supprimée." });
  }),
);

// ============================ UNITÉS ========================================
router.get(
  "/units",
  h(async (req, res) => {
    const r = await query(
      "SELECT * FROM units WHERE tenant_id=$1 ORDER BY is_base DESC, name",
      [(req as AuthRequest).user.tenantId],
    );
    res.json(r.rows);
  }),
);

const unitSchema = z.object({
  name: z.string().trim().min(1).max(100),
  symbol: z.string().trim().min(1).max(20),
  baseValue: z.coerce
    .number()
    .positive("Facteur de conversion invalide")
    .max(1_000_000),
  isBase: z.boolean().default(false),
});

router.post(
  "/units",
  ...adminWrite,
  validateBody(unitSchema),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const r = await query(
      "INSERT INTO units (tenant_id, name, symbol, base_value, is_base) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [
        u.tenantId,
        req.body.name,
        req.body.symbol,
        req.body.baseValue,
        req.body.isBase,
      ],
    );
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "CREATE",
      entity: "unit",
      entityId: r.rows[0]?.id ?? null,
      newState: r.rows[0],
    });
    res.status(201).json(r.rows[0]);
  }),
);

router.patch(
  "/units/:id",
  ...adminWrite,
  validateParams(uuidParam),
  validateBody(unitSchema.partial()),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const found = await query(
      "SELECT * FROM units WHERE id=$1 AND tenant_id=$2",
      [req.params.id!, u.tenantId],
    );
    if (!found.rows[0]) throw HttpError.notFound("Unité introuvable.");
    if (req.body.baseValue !== undefined) {
      const used = await query(
        "SELECT 1 FROM sale_items WHERE unit_id=$1 LIMIT 1",
        [req.params.id],
      );
      if (used.rows[0])
        throw HttpError.conflict(
          "UNIT_FROZEN",
          "Cette unité a servi des ventes : son facteur de conversion ne peut plus changer.",
        );
    }
    const r = await query(
      "UPDATE units SET name=COALESCE($3,name), symbol=COALESCE($4,symbol), base_value=COALESCE($5,base_value), is_base=COALESCE($6,is_base) WHERE id=$1 AND tenant_id=$2 RETURNING *",
      [
        req.params.id!,
        u.tenantId,
        req.body.name ?? null,
        req.body.symbol ?? null,
        req.body.baseValue ?? null,
        req.body.isBase ?? null,
      ],
    );
    res.json(r.rows[0]);
  }),
);

router.delete(
  "/units/:id",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const used = await query(
      "SELECT 1 FROM products WHERE unit_id=$1 LIMIT 1",
      [req.params.id],
    );
    if (used.rows[0])
      throw HttpError.conflict(
        "UNIT_IN_USE",
        "Unité utilisée par des produits : suppression impossible.",
      );
    const r = await query(
      "DELETE FROM units WHERE id=$1 AND tenant_id=$2 RETURNING id",
      [req.params.id!, u.tenantId],
    );
    if (!r.rows[0]) throw HttpError.notFound("Unité introuvable.");
    res.json({ message: "Unité supprimée." });
  }),
);

// ============================ DÉPÔTS ========================================
router.get(
  "/depots",
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const r = await query(
      `SELECT d.*, w.name AS owner_name, COALESCE(uc.c, 0)::int AS user_count
         FROM depots d
         LEFT JOIN users w ON w.id = d.owner_id
         LEFT JOIN (SELECT depot_id, COUNT(*)::int AS c FROM users WHERE is_active GROUP BY depot_id) uc
           ON uc.depot_id = d.id
        WHERE d.tenant_id=$1 ORDER BY d.is_active DESC, d.name`,
      [u.tenantId],
    );
    res.json(r.rows);
  }),
);

const depotSchema = z.object({
  name: z.string().trim().min(2).max(255),
  address: z.string().trim().max(2000).nullish(),
  phone: z.string().trim().max(50).nullish(),
  ownerId: z.string().uuid().nullish(),
});

async function countActiveDepots(tenantId: string): Promise<number> {
  const r = await query(
    "SELECT COUNT(*)::int AS n FROM depots WHERE tenant_id=$1 AND is_active",
    [tenantId],
  );
  return r.rows[0]!.n;
}

router.post(
  "/depots",
  ...adminWrite,
  validateBody(depotSchema),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const max = req.license?.maxDepots ?? 1;
    if ((await countActiveDepots(u.tenantId)) >= max) {
      throw new HttpError(
        402,
        "LICENSE_LIMIT_DEPOTS",
        `Votre licence autorise ${max} dépôt(s) actif(s) maximum.`,
      );
    }
    const r = await query(
      "INSERT INTO depots (tenant_id, name, address, phone, owner_id) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [
        u.tenantId,
        req.body.name,
        req.body.address ?? null,
        req.body.phone ?? null,
        req.body.ownerId ?? null,
      ],
    );
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "CREATE",
      entity: "depot",
      entityId: r.rows[0]?.id ?? null,
      newState: r.rows[0],
    });
    res.status(201).json(r.rows[0]);
  }),
);

router.patch(
  "/depots/:id",
  ...adminWrite,
  validateParams(uuidParam),
  validateBody(
    depotSchema.partial().extend({ isActive: z.boolean().optional() }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const prev = await query(
      "SELECT * FROM depots WHERE id=$1 AND tenant_id=$2",
      [req.params.id!, u.tenantId],
    );
    if (!prev.rows[0]) throw HttpError.notFound("Dépôt introuvable.");
    if (req.body.isActive === true && !prev.rows[0].is_active) {
      const max = req.license?.maxDepots ?? 1;
      if ((await countActiveDepots(u.tenantId)) >= max) {
        throw new HttpError(
          402,
          "LICENSE_LIMIT_DEPOTS",
          `Votre licence autorise ${max} dépôt(s) actif(s) maximum.`,
        );
      }
    }
    const b = req.body;
    const r = await query(
      `UPDATE depots SET name=COALESCE($3,name), address=COALESCE($4,address), phone=COALESCE($5,phone),
              owner_id=COALESCE($6,owner_id), is_active=COALESCE($7,is_active), updated_at=now()
        WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [
        req.params.id!,
        u.tenantId,
        b.name ?? null,
        b.address ?? null,
        b.phone ?? null,
        b.ownerId ?? null,
        b.isActive ?? null,
      ],
    );
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "UPDATE",
      entity: "depot",
      entityId: req.params.id!,
      previousState: prev.rows[0],
      newState: r.rows[0],
    });
    res.json(r.rows[0]);
  }),
);

/** Stock du dépôt (consultation ADMIN/VENDEUR). */
router.get(
  "/depots/:id/stock",
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const r = await query(
      `SELECT p.id, p.name, p.barcode, p.selling_price,
              COALESCE(pds.min_stock_level, p.min_stock_level)::float AS min_stock_level,
              pds.bin_location,
              un.symbol AS unit_symbol,
              COALESCE(SUM(sl.quantity),0)::float AS quantity,
              COALESCE(SUM(sl.reserved_qty),0)::float AS reserved_qty
         FROM products p
         LEFT JOIN stock_levels sl ON sl.product_id=p.id AND sl.depot_id=$2
         LEFT JOIN product_depot_settings pds ON pds.product_id=p.id AND pds.depot_id=$2
         LEFT JOIN units un ON un.id=p.unit_id
        WHERE p.tenant_id=$1 AND p.archived_at IS NULL
          AND ($3 = '' OR p.name ILIKE '%'||$3||'%' OR p.barcode = $3)
        GROUP BY p.id, p.name, p.barcode, p.selling_price, p.min_stock_level, pds.min_stock_level, pds.bin_location, un.symbol
        ORDER BY p.name LIMIT 200`,
      [u.tenantId, req.params.id!, search],
    );
    res.json(r.rows);
  }),
);

// ============================ FOURNISSEURS ==================================
const supplierSchema = z.object({
  name: z.string().trim().min(2).max(255),
  email: z.string().trim().email().nullish(),
  phone: z.string().trim().max(50).nullish(),
  address: z.string().trim().max(2000).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  // Délai d'approvisionnement habituel (jours) — alimente prédictif & OTIF (E4)
  defaultLeadTimeDays: z.coerce.number().int().min(0).max(365).optional(),
});

router.get(
  "/suppliers",
  h(async (req, res) => {
    const r = await query(
      `SELECT s.*, COALESCE(rc.c, 0)::int AS receipt_count
         FROM suppliers s
         LEFT JOIN (SELECT supplier_id, COUNT(*)::int AS c FROM stock_receipts GROUP BY supplier_id) rc
           ON rc.supplier_id = s.id
        WHERE s.tenant_id=$1 ORDER BY s.name`,
      [(req as AuthRequest).user.tenantId],
    );
    res.json(r.rows);
  }),
);

router.get(
  "/suppliers/:id",
  validateParams(uuidParam),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const s = await query(
      "SELECT * FROM suppliers WHERE id=$1 AND tenant_id=$2",
      [req.params.id!, t],
    );
    if (!s.rows[0]) throw HttpError.notFound("Fournisseur introuvable.");
    const receipts = await query(
      `SELECT sr.id, sr.reference, sr.created_at, d.name AS depot_name,
              COALESCE(SUM(sri.base_qty * sri.unit_cost),0)::float AS total_cost,
              COUNT(sri.id)::int AS line_count
         FROM stock_receipts sr
         LEFT JOIN stock_receipt_items sri ON sri.receipt_id = sr.id
         JOIN depots d ON d.id = sr.depot_id
        WHERE sr.supplier_id=$1 AND sr.tenant_id=$2
        GROUP BY sr.id, d.name ORDER BY sr.created_at DESC LIMIT 25`,
      [req.params.id!, t],
    );
    res.json({ ...s.rows[0], receipts: receipts.rows });
  }),
);

router.post(
  "/suppliers",
  ...adminWrite,
  validateBody(supplierSchema),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body;
    const r = await query(
      "INSERT INTO suppliers (tenant_id, name, email, phone, address, notes, default_lead_time_days) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [
        u.tenantId,
        b.name,
        b.email ?? null,
        b.phone ?? null,
        b.address ?? null,
        b.notes ?? null,
        b.defaultLeadTimeDays ?? 3,
      ],
    );
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "CREATE",
      entity: "supplier",
      entityId: r.rows[0]?.id ?? null,
      newState: r.rows[0],
    });
    res.status(201).json(r.rows[0]);
  }),
);

router.patch(
  "/suppliers/:id",
  ...adminWrite,
  validateParams(uuidParam),
  validateBody(supplierSchema.partial()),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const prev = await query(
      "SELECT * FROM suppliers WHERE id=$1 AND tenant_id=$2",
      [req.params.id!, u.tenantId],
    );
    if (!prev.rows[0]) throw HttpError.notFound("Fournisseur introuvable.");
    const b = req.body;
    const r = await query(
      `UPDATE suppliers SET name=COALESCE($3,name), email=COALESCE($4,email), phone=COALESCE($5,phone),
              address=COALESCE($6,address), notes=COALESCE($7,notes),
              default_lead_time_days=COALESCE($8,default_lead_time_days), updated_at=now()
        WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [
        req.params.id!,
        u.tenantId,
        b.name ?? null,
        b.email ?? null,
        b.phone ?? null,
        b.address ?? null,
        b.notes ?? null,
        b.defaultLeadTimeDays ?? null,
      ],
    );
    res.json(r.rows[0]);
  }),
);

router.delete(
  "/suppliers/:id",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const used = await query(
      "SELECT 1 FROM stock_receipts WHERE supplier_id=$1 LIMIT 1",
      [req.params.id],
    );
    if (used.rows[0])
      throw HttpError.conflict(
        "SUPPLIER_IN_USE",
        "Fournisseur lié à des réceptions : suppression impossible.",
      );
    const r = await query(
      "DELETE FROM suppliers WHERE id=$1 AND tenant_id=$2 RETURNING id",
      [req.params.id!, u.tenantId],
    );
    if (!r.rows[0]) throw HttpError.notFound("Fournisseur introuvable.");
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "DELETE",
      entity: "supplier",
      entityId: req.params.id!,
      previousState: r.rows[0],
    });
    res.json({ message: "Fournisseur supprimé." });
  }),
);

/* ====================== FOURNISSEURS — CSV (D3) ========================== */
const SUPPLIER_IMPORT_MAX_ROWS = 1000;

router.get(
  "/suppliers/export/csv",
  requireRole("ADMIN"),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const r = await query(
      `SELECT name, email, phone, address, default_lead_time_days, notes
         FROM suppliers WHERE tenant_id=$1 ORDER BY name`,
      [t],
    );
    const csv = buildCsv(
      [
        "Nom",
        "Email",
        "Téléphone",
        "Adresse",
        "Délai livraison (jours)",
        "Notes",
      ],
      r.rows.map((s) => [
        s.name,
        s.email ?? "",
        s.phone ?? "",
        s.address ?? "",
        s.default_lead_time_days ?? "",
        s.notes ?? "",
      ]),
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="fournisseurs-stockman.csv"',
    );
    res.send(csv);
  }),
);

router.post(
  "/suppliers/import",
  ...adminWrite,
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const text = typeof req.body === "string" ? req.body : "";
    if (!text.trim())
      throw HttpError.badRequest(
        "CSV_EMPTY",
        "Corps text/csv attendu : envoyez le fichier en brut (Content-Type: text/csv).",
      );
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
      name: findCol(["nom", "fournisseur", "supplier", "name"]),
      email: findCol(["email", "e mail", "courriel"]),
      phone: findCol(["telephone", "tel", "phone", "numero"]),
      address: findCol(["adresse", "address"]),
      lead: findCol(["delai", "livraison", "lead"], true),
      notes: findCol(["notes", "note", "observation"], true),
    };
    if (cols.name < 0)
      throw HttpError.badRequest(
        "CSV_HEADER",
        "Colonnes reconnues : Nom;Email;Téléphone;Adresse;Délai livraison (jours);Notes.",
      );
    const dataRows = rows.slice(1);
    if (dataRows.length > SUPPLIER_IMPORT_MAX_ROWS)
      throw HttpError.badRequest(
        "CSV_TOO_MANY",
        `Maximum ${SUPPLIER_IMPORT_MAX_ROWS} lignes par import (${dataRows.length} reçues) : découpez le fichier.`,
      );

    let created = 0,
      updated = 0;
    const errors: Array<{ ligne: number; message: string }> = [];
    const cell = (row: string[], idx: number) =>
      idx >= 0 ? (row[idx] ?? "").trim() : "";

    for (let i = 0; i < dataRows.length; i += 1) {
      const ligne = i + 2;
      const row = dataRows[i]!;
      try {
        const name = cell(row, cols.name);
        if (name.length < 2)
          throw new Error("Nom manquant (2 caractères min).");
        if (name.length > 255) throw new Error("Nom trop long (255 max).");
        const emailRaw = cell(row, cols.email) || null;
        if (emailRaw && !/^\S+@\S+\.\S+$/.test(emailRaw))
          throw new Error(`Email illisible : « ${emailRaw} ».`);
        const phone = cell(row, cols.phone) || null;
        const address = cell(row, cols.address) || null;
        const notes = cell(row, cols.notes) || null;
        const leadRaw = cell(row, cols.lead);
        let lead: number | null = null;
        if (leadRaw !== "") {
          const n = Number(leadRaw.replace(",", "."));
          if (!Number.isFinite(n) || n < 0 || n > 365 || !Number.isInteger(n))
            throw new Error(`Délai illisible : « ${leadRaw} » (entier 0–365).`);
          lead = n;
        }
        const existing = await query<{ id: string }>(
          "SELECT id FROM suppliers WHERE tenant_id=$1 AND lower(name)=lower($2) LIMIT 1",
          [u.tenantId, name],
        );
        if (existing.rows[0]) {
          await query(
            `UPDATE suppliers SET email=COALESCE($3,email), phone=COALESCE($4,phone),
               address=COALESCE($5,address), default_lead_time_days=COALESCE($6,default_lead_time_days),
               notes=COALESCE($7,notes), updated_at=now()
             WHERE id=$1 AND tenant_id=$2`,
            [
              existing.rows[0].id,
              u.tenantId,
              emailRaw,
              phone,
              address,
              lead,
              notes,
            ],
          );
          updated += 1;
        } else {
          await query(
            `INSERT INTO suppliers (tenant_id, name, email, phone, address, notes, default_lead_time_days)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [u.tenantId, name, emailRaw, phone, address, notes, lead],
          );
          created += 1;
        }
      } catch (err) {
        if (errors.length < 100)
          errors.push({
            ligne,
            message: err instanceof Error ? err.message : "Erreur inconnue",
          });
      }
    }
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "IMPORT",
      entity: "supplier",
      details: `Import CSV fournisseurs : ${created} créés, ${updated} mis à jour, ${errors.length} erreur(s).`,
    });
    res.json({ created, updated, errors, total: dataRows.length });
  }),
);

export default router;
