import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../config/db";
import { h } from "../lib/asyncHandler";
import { pageParams, paged, pageQuerySchema } from "../lib/pagination";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import { requireActiveLicense } from "../middleware/license";
import {
  validateBody,
  validateParams,
  validateQuery,
  uuidParam,
} from "../middleware/validate";
import {
  abcSchedule,
  cancelCampaign,
  COUNT_REASONS,
  campaignDetail,
  createCampaign,
  reviewCampaign,
  saveCounts,
  startCampaign,
  validateCampaign,
} from "../services/inventoryService";

const router = Router();
router.use(authenticate);
const adminWrite = [requireRole("ADMIN"), requireActiveLicense()];

// ============================ CRÉATION (BROUILLON) ==========================
router.post(
  "/",
  ...adminWrite,
  validateBody(
    z.object({
      depotId: z.string().uuid().optional(),
      scope: z
        .enum(["ALL", "SELECTION", "ABC_A", "ABC_B", "ABC_C"])
        .default("ALL"),
      productIds: z.array(z.string().uuid()).max(1000).optional(),
      blind: z.boolean().default(false),
      freezeStock: z.boolean().default(false),
      note: z.string().trim().max(2000).nullish(),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body;
    const created = await withTransaction((c) =>
      createCampaign(c, u, {
        depotId: b.depotId,
        scope: b.scope,
        productIds: b.productIds,
        blind: b.blind,
        freezeStock: b.freezeStock,
        note: b.note ?? null,
      }),
    );
    res.status(201).json(created);
  }),
);

// ============================ LISTE =========================================
router.get(
  "/",
  requireRole("ADMIN"),
  validateQuery(
    pageQuerySchema.extend({
      status: z
        .enum(["DRAFT", "COUNTING", "REVIEW", "CLOSED", "CANCELLED"])
        .optional(),
      depotId: z.string().uuid().optional(),
    }),
  ),
  h(async (req, res) => {
    const t = (req as AuthRequest).user.tenantId;
    const q = req.query as unknown as {
      page: number;
      size: number;
      status?: string;
      depotId?: string;
    };
    const { limit, offset } = pageParams(q);
    const params: unknown[] = [t];
    const conds = ["ic.tenant_id = $1"];
    if (q.status) conds.push(`ic.status = $${params.push(q.status)}`);
    if (q.depotId) conds.push(`ic.depot_id = $${params.push(q.depotId)}`);
    const where = `WHERE ${conds.join(" AND ")}`;
    const count = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM inventory_campaigns ic ${where}`,
      params,
    );
    const rows = await query(
      `SELECT ic.id, ic.status, ic.scope, ic.blind, ic.freeze_stock, ic.note,
              ic.depot_id, d.name AS depot_name, ic.started_at, ic.closed_at,
              ic.created_at, cu.name AS created_by_name, vu.name AS validated_by_name,
              agg.line_count, agg.counted
         FROM inventory_campaigns ic
         JOIN depots d ON d.id=ic.depot_id
         LEFT JOIN users cu ON cu.id=ic.created_by
         LEFT JOIN users vu ON vu.id=ic.validated_by
         LEFT JOIN (
           SELECT campaign_id, COUNT(*)::int AS line_count,
                  SUM(CASE WHEN counted_qty IS NULL THEN 0 ELSE 1 END)::int AS counted
             FROM inventory_count_items GROUP BY campaign_id
         ) agg ON agg.campaign_id = ic.id
        ${where}
        ORDER BY ic.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json(paged(rows.rows, count.rows[0]!.n, q));
  }),
);

// ============================ ÉCHÉANCIER ABC (tournant) =====================
// NB : déclaré AVANT /:id.
router.get(
  "/abc-schedule",
  requireRole("ADMIN"),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    res.json(await withTransaction((c) => abcSchedule(c, u.tenantId)));
  }),
);

// ============================ DÉTAIL + RAPPORT D'ÉCARTS =====================
router.get(
  "/:id",
  requireRole("ADMIN"),
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    res.json(
      await withTransaction((c) =>
        campaignDetail(c, u.tenantId, req.params.id!),
      ),
    );
  }),
);

// ============================ TRANSITIONS ===================================
router.post(
  "/:id/start",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    res.json(await withTransaction((c) => startCampaign(c, u, req.params.id!)));
  }),
);

router.put(
  "/:id/counts",
  ...adminWrite,
  validateParams(uuidParam),
  validateBody(
    z.object({
      lines: z
        .array(
          z.object({
            productId: z.string().uuid(),
            countedQty: z.coerce.number().min(0).finite(),
            reason: z.enum(COUNT_REASONS).nullish(),
          }),
        )
        .min(1)
        .max(1000),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    res.json(
      await withTransaction((c) =>
        saveCounts(c, u, req.params.id!, req.body.lines),
      ),
    );
  }),
);

router.post(
  "/:id/review",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    res.json(
      await withTransaction((c) => reviewCampaign(c, u, req.params.id!)),
    );
  }),
);

router.post(
  "/:id/validate",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    res.json(
      await withTransaction((c) => validateCampaign(c, u, req.params.id!)),
    );
  }),
);

router.post(
  "/:id/cancel",
  ...adminWrite,
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    res.json(
      await withTransaction((c) => cancelCampaign(c, u, req.params.id!)),
    );
  }),
);

export default router;
