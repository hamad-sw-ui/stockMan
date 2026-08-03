import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../config/db";
import { h } from "../lib/asyncHandler";
import { HttpError } from "../lib/errors";
import { writeAudit } from "../lib/audit";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import { requireActiveLicense } from "../middleware/license";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validate";
import { pageParams, paged, pageQuerySchema } from "../lib/pagination";

/**
 * E8 — Politique de prix : promotions datées (produit ou globales, activable)
 * et historique horodaté des changements de prix (détail & gros) — traçabilité
 * « qui a changé quoi, quand, pourquoi » et audit des marges.
 */

const router = Router();
router.use(authenticate);
const adminWrite = [requireRole("ADMIN"), requireActiveLicense()];

// ============================ PROMOTIONS ====================================
const promotionInput = z.object({
  name: z.string().trim().min(2).max(150),
  productId: z.string().uuid().nullish(),
  discountPct: z.coerce.number().gt(0).max(100),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  isActive: z.boolean().default(true),
});

function validateWindow(b: { startsAt: string; endsAt: string }) {
  if (new Date(b.endsAt) <= new Date(b.startsAt))
    throw HttpError.badRequest(
      "PROMO_WINDOW_INVALID",
      "La fin de la promotion doit être postérieure au début.",
    );
}

router.get(
  "/promotions",
  requireRole("ADMIN"),
  validateQuery(
    pageQuerySchema.extend({
      active: z.enum(["true", "false"]).optional(),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as {
      page: number;
      size: number;
      active?: "true" | "false";
    };
    const { limit, offset } = pageParams(q);
    const onlyActive = q.active === "true";
    const total = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM promotions
        WHERE tenant_id=$1 ${onlyActive ? "AND is_active AND starts_at <= now() AND ends_at >= now()" : ""}`,
      [u.tenantId],
    );
    const rows = await query<{
      id: string;
      name: string;
      product_id: string | null;
      product_name: string | null;
      discount_pct: number;
      starts_at: string;
      ends_at: string;
      is_active: boolean;
      created_at: string;
    }>(
      `SELECT pr.id, pr.name, pr.product_id, p.name AS product_name,
              pr.discount_pct::float, pr.starts_at, pr.ends_at, pr.is_active, pr.created_at
         FROM promotions pr LEFT JOIN products p ON p.id = pr.product_id
        WHERE pr.tenant_id=$1
          ${onlyActive ? "AND pr.is_active AND pr.starts_at <= now() AND pr.ends_at >= now()" : ""}
        ORDER BY pr.starts_at DESC, pr.id
        LIMIT $2 OFFSET $3`,
      [u.tenantId, limit, offset],
    );
    res.json(paged(rows.rows, total.rows[0]?.n ?? 0, q));
  }),
);

router.post(
  "/promotions",
  ...adminWrite,
  validateBody(promotionInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof promotionInput>;
    validateWindow(b);
    const created = await withTransaction(async (client) => {
      if (b.productId) {
        const prod = await client.query<{ id: string }>(
          "SELECT id FROM products WHERE id=$1 AND tenant_id=$2",
          [b.productId, u.tenantId],
        );
        if (!prod.rows[0])
          throw HttpError.badRequest("PRODUCT_UNKNOWN", "Produit introuvable.");
      }
      const r = await client.query<{ id: string }>(
        `INSERT INTO promotions (tenant_id, product_id, name, discount_pct, starts_at, ends_at, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          u.tenantId,
          b.productId ?? null,
          b.name,
          b.discountPct,
          b.startsAt,
          b.endsAt,
          b.isActive,
        ],
      );
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "PRICE",
          entity: "promotion",
          entityId: r.rows[0]!.id,
          newState: {
            name: b.name,
            discountPct: b.discountPct,
            productId: b.productId ?? null,
            window: [b.startsAt, b.endsAt],
          },
        },
        client,
      );
      return r.rows[0]!;
    });
    res.status(201).json({ id: created.id });
  }),
);

const promotionPatch = promotionInput.partial();

router.patch(
  "/promotions/:id",
  ...adminWrite,
  validateParams(z.object({ id: z.string().uuid() })),
  validateBody(promotionPatch),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof promotionPatch>;
    await withTransaction(async (client) => {
      const cur = await client.query<{
        id: string;
        starts_at: string;
        ends_at: string;
      }>(
        "SELECT id, starts_at, ends_at FROM promotions WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
        [req.params.id, u.tenantId],
      );
      if (!cur.rows[0]) throw HttpError.notFound("Promotion introuvable.");
      if (b.productId) {
        const prod = await client.query<{ id: string }>(
          "SELECT id FROM products WHERE id=$1 AND tenant_id=$2",
          [b.productId, u.tenantId],
        );
        if (!prod.rows[0])
          throw HttpError.badRequest("PRODUCT_UNKNOWN", "Produit introuvable.");
      }
      const startsAt = b.startsAt ?? cur.rows[0].starts_at;
      const endsAt = b.endsAt ?? cur.rows[0].ends_at;
      if (new Date(endsAt) <= new Date(startsAt))
        throw HttpError.badRequest(
          "PROMO_WINDOW_INVALID",
          "La fin de la promotion doit être postérieure au début.",
        );
      await client.query(
        `UPDATE promotions SET
            name=COALESCE($2, name),
            product_id=CASE WHEN $3::boolean THEN $4 ELSE product_id END,
            discount_pct=COALESCE($5, discount_pct),
            starts_at=$6, ends_at=$7,
            is_active=COALESCE($8, is_active)
          WHERE id=$1`,
        [
          req.params.id,
          b.name ?? null,
          b.productId !== undefined,
          b.productId ?? null,
          b.discountPct ?? null,
          startsAt,
          endsAt,
          b.isActive ?? null,
        ],
      );
      await writeAudit(
        {
          tenantId: u.tenantId,
          userId: u.id,
          userName: u.name,
          action: "PRICE",
          entity: "promotion",
          entityId: req.params.id!,
          newState: b as unknown as Record<string, unknown>,
        },
        client,
      );
    });
    res.json({ ok: true });
  }),
);

router.delete(
  "/promotions/:id",
  ...adminWrite,
  validateParams(z.object({ id: z.string().uuid() })),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const r = await query(
      "DELETE FROM promotions WHERE id=$1 AND tenant_id=$2 RETURNING id",
      [req.params.id, u.tenantId],
    );
    if (r.rows.length === 0) throw HttpError.notFound("Promotion introuvable.");
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "PRICE",
      entity: "promotion",
      entityId: req.params.id!,
      newState: { deleted: true },
    });
    res.json({ ok: true });
  }),
);

// ============================ HISTORIQUE DES PRIX ===========================
router.get(
  "/price-history/:productId",
  requireRole("ADMIN"),
  validateParams(z.object({ productId: z.string().uuid() })),
  validateQuery(pageQuerySchema),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as { page: number; size: number };
    const { limit, offset } = pageParams(q);
    const total = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM price_history ph
         JOIN products p ON p.id = ph.product_id
        WHERE ph.product_id=$1 AND p.tenant_id=$2`,
      [req.params.productId, u.tenantId],
    );
    const rows = await query<{
      id: string;
      field: "DETAIL" | "WHOLESALE";
      old_price: number | null;
      new_price: number;
      reason: string | null;
      changed_by_name: string | null;
      created_at: string;
    }>(
      `SELECT ph.id, ph.field, ph.old_price::float, ph.new_price::float,
              ph.reason, usr.name AS changed_by_name, ph.created_at
         FROM price_history ph
         LEFT JOIN users usr ON usr.id = ph.changed_by
        WHERE ph.product_id=$1 AND ph.tenant_id=$2
        ORDER BY ph.created_at DESC, ph.id
        LIMIT $3 OFFSET $4`,
      [req.params.productId, u.tenantId, limit, offset],
    );
    res.json(paged(rows.rows, total.rows[0]?.n ?? 0, q));
  }),
);

export default router;
