import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db";
import { h } from "../lib/asyncHandler";
import { HttpError } from "../lib/errors";
import { pageParams, paged, pageQuerySchema } from "../lib/pagination";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import {
  validateParams,
  validateQuery,
  uuidParam,
} from "../middleware/validate";
import {
  invoiceById,
  invoicesForSale,
  listInvoices,
  tenantLegal,
} from "../services/invoiceService";

const router = Router();
router.use(authenticate);

// ============================ LISTE (gérant) ================================
router.get(
  "/",
  requireRole("ADMIN"),
  validateQuery(
    pageQuerySchema.extend({
      depotId: z.string().uuid().optional(),
      kind: z.enum(["INVOICE", "CREDIT_NOTE"]).optional(),
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
      kind?: "INVOICE" | "CREDIT_NOTE";
      from?: string;
      to?: string;
    };
    const { limit, offset } = pageParams(q);
    const { rows, total } = await listInvoices(u.tenantId, {
      depotId: q.depotId,
      kind: q.kind,
      from: q.from,
      to: q.to,
      limit,
      offset,
    });
    res.json(paged(rows, total, q));
  }),
);

// ============================ PAR VENTE (reçu fiscal) =======================
// AVANT /:id — vendeur : vente de son dépôt uniquement (contrôle interne).
router.get(
  "/by-sale/:saleId",
  validateParams(z.object({ saleId: z.string().uuid() })),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const sale = await query<{ depot_id: string }>(
      "SELECT depot_id FROM sales WHERE id=$1 AND tenant_id=$2",
      [req.params.saleId!, u.tenantId],
    );
    if (!sale.rows[0]) throw HttpError.notFound("Vente introuvable.");
    if (u.role === "VENDEUR" && sale.rows[0].depot_id !== u.depotId) {
      throw HttpError.forbidden(
        "Un vendeur ne voit que les factures de son dépôt.",
        "DEPOT_FORBIDDEN",
      );
    }
    res.json(await invoicesForSale(u.tenantId, req.params.saleId!));
  }),
);

// ============================ DÉTAIL (imprimable) ===========================
router.get(
  "/:id",
  validateParams(uuidParam),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const inv = await invoiceById(u.tenantId, req.params.id!);
    if (u.role === "VENDEUR" && inv.depotId !== u.depotId) {
      throw HttpError.forbidden(
        "Un vendeur ne voit que les factures de son dépôt.",
        "DEPOT_FORBIDDEN",
      );
    }
    const legal = await tenantLegal(u.tenantId);
    res.json({ ...inv, tenant: legal });
  }),
);

export default router;
