import { Router } from "express";
import { z } from "zod";
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
  closeSession,
  currentSession,
  listSessions,
  openSession,
  sessionById,
} from "../services/cashSessionService";

const router = Router();
router.use(authenticate);

// ============================ OUVERTURE DE CAISSE ===========================
router.post(
  "/",
  requireRole("ADMIN", "VENDEUR"),
  requireActiveLicense(),
  validateBody(
    z.object({
      depotId: z.string().uuid().optional(),
      openingFloat: z.coerce.number().min(0).finite().default(0),
      note: z.string().trim().max(1000).nullish(),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body;
    const session = await openSession(u, {
      depotId: b.depotId,
      openingFloat: b.openingFloat,
      note: b.note ?? null,
    });
    res.status(201).json(session);
  }),
);

// ============================ SESSION EN COURS (caisse) =====================
// AVANT /:id — vendeur : son dépôt ; admin : ?depotId=.
router.get(
  "/current",
  validateQuery(z.object({ depotId: z.string().uuid().optional() })),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    res.json(
      await currentSession(u, (req.query as { depotId?: string }).depotId),
    );
  }),
);

// ============================ LISTE (gérant — écarts) =======================
router.get(
  "/",
  requireRole("ADMIN"),
  validateQuery(
    pageQuerySchema.extend({
      depotId: z.string().uuid().optional(),
      status: z.enum(["OPEN", "CLOSED"]).optional(),
      from: z.string().date().optional(),
      to: z.string().date().optional(),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const q = req.query as unknown as {
      page: number;
      size: number;
      depotId?: string;
      status?: "OPEN" | "CLOSED";
      from?: string;
      to?: string;
    };
    const { limit, offset } = pageParams(q);
    const { rows, total } = await listSessions(u, {
      depotId: q.depotId,
      status: q.status,
      from: q.from,
      to: q.to,
      limit,
      offset,
    });
    res.json(paged(rows, total, q));
  }),
);

// ============================ DÉTAIL ========================================
router.get(
  "/:id",
  validateParams(uuidParam),
  h(async (req, res) => {
    res.json(await sessionById((req as AuthRequest).user, req.params.id!));
  }),
);

// ============================ CLÔTURE (Z ÉMIS) ==============================
router.post(
  "/:id/close",
  requireRole("ADMIN", "VENDEUR"),
  requireActiveLicense(),
  validateParams(uuidParam),
  validateBody(
    z.object({
      countedCash: z.coerce.number().min(0).finite(),
      countedMtn: z.coerce.number().min(0).finite().nullish(),
      countedOm: z.coerce.number().min(0).finite().nullish(),
      note: z.string().trim().max(1000).nullish(),
    }),
  ),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body;
    const session = await closeSession(u, req.params.id!, {
      countedCash: b.countedCash,
      countedMtn: b.countedMtn ?? null,
      countedOm: b.countedOm ?? null,
      note: b.note ?? null,
    });
    res.json(session);
  }),
);

export default router;
