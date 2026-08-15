import { Router } from "express";
import { h } from "../lib/asyncHandler";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import { requireActiveLicense } from "../middleware/license";
import { writeAudit } from "../lib/audit";
import { HttpError } from "../lib/errors";
import {
  applyTenantImport,
  exportTenantSnapshot,
  ImportValidationError,
  previewTenantImport,
} from "../services/tenantData";

const router = Router();
router.use(authenticate);
const adminWrite = [requireRole("ADMIN"), requireActiveLicense()];

/**
 * D1/D2 — Export & restauration des données du tenant (docs/07).
 * GET  /api/tenant/export  → fichier JSON complet (téléchargement).
 * POST /api/tenant/import?mode=preview|replace → rapport / restauration.
 * Réservé ADMIN, journalisé dans audit_logs (EXPORT / IMPORT).
 */

router.get(
  "/export",
  ...adminWrite,
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const snap = await exportTenantSnapshot(u.tenantId);
    await writeAudit({
      tenantId: u.tenantId,
      userId: u.id,
      userName: u.name,
      action: "EXPORT",
      entity: "tenant_data",
      details: `Export intégral des données : ${Object.values(snap.counts).reduce((a, n) => a + n, 0)} lignes.`,
    });
    const stamp = snap.exportedAt.slice(0, 16).replace(/[-:T]/g, "");
    const shop = (snap.tenant.name ?? "boutique")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="stockman-export-${shop || "boutique"}-${stamp}.json"`,
    );
    res.send(JSON.stringify(snap, null, 2));
  }),
);

router.post(
  "/import",
  ...adminWrite,
  h(async (req, res) => {
    const u = (req as AuthRequest).user;
    const mode = req.query.mode === "replace" ? "replace" : "preview";
    try {
      if (mode === "preview") {
        res.json({
          mode,
          report: await previewTenantImport(u.tenantId, req.body),
        });
        return;
      }
      const report = await applyTenantImport(
        u.tenantId,
        { id: u.id, name: u.name },
        req.body,
      );
      res.json({ mode, report });
    } catch (e) {
      if (e instanceof ImportValidationError)
        throw HttpError.badRequest(e.code, e.message, e.details);
      throw e;
    }
  }),
);

export default router;
