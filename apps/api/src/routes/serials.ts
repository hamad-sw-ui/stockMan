import { Router } from "express";
import { z } from "zod";
import { withTransaction } from "../config/db";
import { h } from "../lib/asyncHandler";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import { requireActiveLicense } from "../middleware/license";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validate";
import {
  auditSerials,
  lookupSerial,
  registerSerials,
  serialsInStock,
} from "../services/serialService";
import { resolveDepot } from "../services/saleService";

/**
 * E8 — Sérialisation (IMEI / n° de série) : électronique & téléphonie.
 *  - enregistrement de numéros EN STOCK (complément des réceptions, qui les
 *    exigent déjà pour les produits sérialisés) ;
 *  - liste des numéros en stock d'un produit (aide à la vente) ;
 *  - recherche garantie/SAV : statut, dépôt, vente et facture d'origine.
 */

const router = Router();
router.use(authenticate);

// ============================ RECHERCHE (garantie / SAV) ====================
// AVANT /product/:productId — paramètre requis `serial`.
router.get(
  "/lookup",
  validateQuery(z.object({ serial: z.string().trim().min(1).max(100) })),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const serial = (req.query as unknown as { serial: string }).serial;
    res.json(await lookupSerial(u.tenantId, serial));
  }),
);

// ============================ NUMÉROS EN STOCK D'UN PRODUIT =================
router.get(
  "/product/:productId",
  validateParams(z.object({ productId: z.string().uuid() })),
  validateQuery(z.object({ depotId: z.string().uuid().optional() })),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const depotId = (req.query as unknown as { depotId?: string }).depotId;
    const rows = await serialsInStock(
      u.tenantId,
      req.params.productId!,
      depotId,
    );
    res.json({ rows });
  }),
);

// ============================ ENREGISTREMENT MANUEL (gérant) ================
const registerInput = z.object({
  depotId: z.string().uuid().optional(),
  serials: z
    .array(z.string().trim().min(1).max(100))
    .min(1, "Au moins un numéro est requis")
    .max(500),
});

router.post(
  "/product/:productId",
  requireRole("ADMIN"),
  requireActiveLicense(),
  validateParams(z.object({ productId: z.string().uuid() })),
  validateBody(registerInput),
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const b = req.body as z.infer<typeof registerInput>;
    const depotId = resolveDepot(u, b.depotId);
    const registered = await withTransaction(async (client) => {
      const n = await registerSerials(client, {
        tenantId: u.tenantId,
        depotId,
        productId: req.params.productId!,
        serials: b.serials,
      });
      await auditSerials(client, u, req.params.productId!, n, depotId);
      return n;
    });
    res.status(201).json({ registered });
  }),
);

export default router;
