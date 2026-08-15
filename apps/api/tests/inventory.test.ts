import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  seedTenant,
  receiveStock,
  TestContext,
  SeedIds,
} from "./helpers/app";

/**
 * E5 — Inventaire physique professionnel : campagnes à cycle complet
 * (brouillon → comptage → revue → clôture), théorique ET CUMP figés au
 * lancement, comptage aveugle, séparation compteur/validateur, motif codifié
 * obligatoire sur les écarts, gel des mouvements optionnel, inventaire
 * tournant ABC avec échéancier.
 */
describe("E5 — Inventaire physique professionnel", () => {
  let ctx: TestContext;
  let ids: SeedIds;
  const auth = (t?: string) => ({
    Authorization: `Bearer ${t ?? ids.adminToken}`,
  });

  beforeAll(async () => {
    ctx = await createTestContext();
    ids = await seedTenant(ctx);
  });
  afterAll(() => destroyTestContext(ctx));

  async function createCampaign(body: Record<string, unknown> = {}) {
    const r = await ctx.agent
      .post("/api/inventory-campaigns")
      .set(auth())
      .send({ depotId: ids.depotId, ...body });
    return r;
  }

  /* ------------------------- Cycle & garde-fous ------------------------- */
  it("création brouillon, une seule campagne active par dépôt, vendeur refusé", async () => {
    const r = await createCampaign({ note: "Inventaire test cycle" });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("DRAFT");
    // Deuxième campagne active sur le même dépôt → 409 explicite
    const dup = await createCampaign();
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("CAMPAIGN_ACTIVE");
    // Vendeur : aucun droit sur les campagnes
    const deny = await ctx.agent
      .get("/api/inventory-campaigns")
      .set(auth(ids.vendorToken));
    expect(deny.status).toBe(403);
    // Nettoyage pour la suite
    const cancel = await ctx.agent
      .post(`/api/inventory-campaigns/${r.body.id}/cancel`)
      .set(auth())
      .send({});
    expect(cancel.body.status).toBe("CANCELLED");
  });

  it("périmètre SELECTION exige des produits", async () => {
    const r = await createCampaign({ scope: "SELECTION" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("SCOPE_EMPTY");
  });

  it("cycle complet : théorique/CUMP figés, saisie, revue, validation par un NON-compteur, ajustements postés", async () => {
    // Ligne secondaire : la campagne ALL a AU MOINS 2 produits (le comptage
    // partiel est refusable à la revue).
    const second = await ctx.agent.post("/api/products").set(auth()).send({
      name: "Produit secondaire inv",
      purchasePrice: 50,
      sellingPrice: 90,
      unitId: ids.unitId,
    });
    expect(second.status).toBe(201);
    // Stock connu : 100 pièces à 200 F (CUMP 200)
    await receiveStock(ctx, ids, 100);

    const c = await createCampaign();
    const id = c.body.id;
    const start = await ctx.agent
      .post(`/api/inventory-campaigns/${id}/start`)
      .set(auth())
      .send({});
    expect(start.status).toBe(200);
    expect(start.body.status).toBe("COUNTING");

    const detail1 = (
      await ctx.agent.get(`/api/inventory-campaigns/${id}`).set(auth())
    ).body;
    const line = detail1.items.find(
      (i: { product_id: string }) => i.product_id === ids.productId,
    );
    expect(line.theoretical_qty).toBe(100);
    expect(line.theoretical_cost).toBe(200);

    // Une réception APRÈS le lancement change le stock physique mais PAS le
    // théorique ni le coût figés de la campagne.
    await receiveStock(ctx, ids, 10);
    const detail2 = (
      await ctx.agent.get(`/api/inventory-campaigns/${id}`).set(auth())
    ).body;
    const line2 = detail2.items.find(
      (i: { product_id: string }) => i.product_id === ids.productId,
    );
    expect(line2.theoretical_qty).toBe(100);
    expect(line2.theoretical_cost).toBe(200);

    // Produit hors périmètre → refus clair
    const outsider = await ctx.agent
      .put(`/api/inventory-campaigns/${id}/counts`)
      .set(auth())
      .send({
        lines: [
          {
            productId: "00000000-0000-4000-8000-000000000000",
            countedQty: 1,
          },
        ],
      });
    expect(outsider.status).toBe(400);
    expect(outsider.body.error.code).toBe("PRODUCT_NOT_IN_CAMPAIGN");

    // Saisie partielle → revue refusée (comptage incomplet)
    await ctx.agent
      .put(`/api/inventory-campaigns/${id}/counts`)
      .set(auth())
      .send({
        lines: [{ productId: ids.productId, countedQty: 92, reason: "THEFT" }],
      });
    const reviewEarly = await ctx.agent
      .post(`/api/inventory-campaigns/${id}/review`)
      .set(auth())
      .send({});
    expect(reviewEarly.status).toBe(409);
    expect(reviewEarly.body.error.code).toBe("COUNT_INCOMPLETE");

    // Compléter toutes les lignes SANS motif sur l'écart → motif exigé.
    // NB : on retire le motif pour vérifier le contrôle.
    const allLines = detail2.items.map(
      (i: { product_id: string; theoretical_qty: number }) => ({
        productId: i.product_id,
        countedQty: i.theoretical_qty,
      }),
    );
    for (const l of allLines) {
      if (l.productId === ids.productId) l.countedQty = 92; // écart sans motif
    }
    await ctx.agent
      .put(`/api/inventory-campaigns/${id}/counts`)
      .set(auth())
      .send({ lines: allLines });
    const reviewNoReason = await ctx.agent
      .post(`/api/inventory-campaigns/${id}/review`)
      .set(auth())
      .send({});
    expect(reviewNoReason.status).toBe(409);
    expect(reviewNoReason.body.error.code).toBe("COUNT_REASON_MISSING");

    // Avec le motif codifié → revue OK : écarts valorisés au CUMP figé (200).
    await ctx.agent
      .put(`/api/inventory-campaigns/${id}/counts`)
      .set(auth())
      .send({
        lines: [{ productId: ids.productId, countedQty: 92, reason: "THEFT" }],
      });
    const review = await ctx.agent
      .post(`/api/inventory-campaigns/${id}/review`)
      .set(auth())
      .send({});
    expect(review.status).toBe(200);
    expect(review.body.status).toBe("REVIEW");
    expect(review.body.discrepancies).toBe(1);
    expect(review.body.valueDown).toBeCloseTo(8 * 200, 2);

    // Le compteur ne peut pas valider sa propre saisie (séparation des tâches)
    const forbidden = await ctx.agent
      .post(`/api/inventory-campaigns/${id}/validate`)
      .set(auth())
      .send({});
    expect(forbidden.status).toBe(409);
    expect(forbidden.body.error.code).toBe("COUNT_VALIDATOR_SAME_AS_COUNTER");

    // Deuxième administrateur → validation autorisée
    const admin2 = await ctx.agent
      .post("/api/users")
      .set(auth())
      .send({
        name: "Contrôleur Gestion",
        email: `controleur-${crypto.randomUUID().slice(0, 8)}@test.cm`,
        role: "ADMIN",
        password: "Controle1!",
      });
    expect(admin2.status).toBe(201);
    const login2 = await ctx.agent
      .post("/api/auth/login")
      .send({ email: admin2.body.email, password: "Controle1!" });
    const admin2Token = login2.body.accessToken as string;

    const stockBefore = await ctx.pool.query<{ q: number }>(
      `SELECT COALESCE(SUM(quantity),0)::float AS q FROM stock_levels
        WHERE product_id=$1 AND depot_id=$2`,
      [ids.productId, ids.depotId],
    );
    const validate = await ctx.agent
      .post(`/api/inventory-campaigns/${id}/validate`)
      .set(auth(admin2Token))
      .send({});
    expect(validate.status).toBe(200);
    expect(validate.body.status).toBe("CLOSED");
    expect(validate.body.adjustments).toBe(1);

    // Niveau physique ramené au compté (110 - 8 = 102)
    const stockAfter = await ctx.pool.query<{ q: number }>(
      `SELECT COALESCE(SUM(quantity),0)::float AS q FROM stock_levels
        WHERE product_id=$1 AND depot_id=$2`,
      [ids.productId, ids.depotId],
    );
    expect(stockAfter.rows[0]!.q).toBeCloseTo(stockBefore.rows[0]!.q - 8, 6);

    // Mouvement tracé : type ADJUSTMENT, motif codifié, valorisé au CUMP figé
    const mv = await ctx.pool.query<{
      type: string;
      code: string | null;
      cost: number;
    }>(
      `SELECT type, reason_code AS code, unit_cost::float AS cost
         FROM stock_movements WHERE reference_id=$1`,
      [id],
    );
    expect(mv.rows).toHaveLength(1);
    expect(mv.rows[0]!.type).toBe("ADJUSTMENT");
    expect(mv.rows[0]!.code).toBe("THEFT");
    expect(mv.rows[0]!.cost).toBe(200);

    // Rapport final : écart -8 × 200 figé, ligne appliquée
    const final = (
      await ctx.agent.get(`/api/inventory-campaigns/${id}`).set(auth())
    ).body;
    const finLine = final.items.find(
      (i: { product_id: string }) => i.product_id === ids.productId,
    );
    expect(finLine.variance_qty).toBe(-8);
    expect(finLine.variance_value).toBe(-1600);
    expect(finLine.applied).toBe(true);
    expect(final.validated_by_name).toBe("Contrôleur Gestion");

    // Re-validation → idempotente (refusée proprement)
    const again = await ctx.agent
      .post(`/api/inventory-campaigns/${id}/validate`)
      .set(auth(admin2Token))
      .send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("CAMPAIGN_CLOSED");
  });

  it("comptage aveugle : théorique masqué pendant le comptage, visible ensuite", async () => {
    const c = await createCampaign({
      blind: true,
      scope: "SELECTION",
      productIds: [ids.productId],
    });
    const id = c.body.id;
    await ctx.agent
      .post(`/api/inventory-campaigns/${id}/start`)
      .set(auth())
      .send({});
    const masked = (
      await ctx.agent.get(`/api/inventory-campaigns/${id}`).set(auth())
    ).body;
    expect(masked.blind_masked).toBe(true);
    expect(masked.items[0].theoretical_qty).toBeNull();
    expect(masked.items[0].variance_qty).toBeNull();

    await ctx.agent
      .put(`/api/inventory-campaigns/${id}/counts`)
      .set(auth())
      .send({
        lines: [{ productId: ids.productId, countedQty: 102 }],
      });
    await ctx.agent
      .post(`/api/inventory-campaigns/${id}/review`)
      .set(auth())
      .send({});
    const revealed = (
      await ctx.agent.get(`/api/inventory-campaigns/${id}`).set(auth())
    ).body;
    expect(revealed.blind_masked).toBeFalsy();
    expect(revealed.items[0].theoretical_qty).toBe(102);
    expect(revealed.items[0].variance_qty).toBe(0);
    // Annulation propre pour laisser le dépôt libre
    await ctx.agent
      .post(`/api/inventory-campaigns/${id}/cancel`)
      .set(auth())
      .send({});
  });

  it("gel des mouvements : vente, réception, ajustement et transfert bloqués pendant le comptage", async () => {
    // Dépôt secondaire pour le test de transfert
    const depot2 = await ctx.agent
      .post("/api/depots")
      .set(auth())
      .send({ name: "Dépôt Gelé 2" });
    expect(depot2.status).toBe(201);

    const c = await createCampaign({ freezeStock: true });
    const id = c.body.id;
    await ctx.agent
      .post(`/api/inventory-campaigns/${id}/start`)
      .set(auth())
      .send({});

    // Vente (vendeur confiné à son dépôt = depotId seed)
    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 1 }],
        paymentMethod: "CASH",
      });
    expect(sale.status).toBe(409);
    expect(sale.body.error.code).toBe("STOCK_FROZEN");

    // Réception
    const rcv = await ctx.agent
      .post("/api/stock/receipts")
      .set(auth())
      .send({
        depotId: ids.depotId,
        items: [{ productId: ids.productId, quantity: 1, unitCost: 200 }],
      });
    expect(rcv.status).toBe(409);
    expect(rcv.body.error.code).toBe("STOCK_FROZEN");

    // Ajustement
    const adj = await ctx.agent.post("/api/stock/adjust").set(auth()).send({
      productId: ids.productId,
      depotId: ids.depotId,
      delta: 1,
      reason: "Test gel inventaire",
    });
    expect(adj.status).toBe(409);
    expect(adj.body.error.code).toBe("STOCK_FROZEN");

    // Transfert sortant du dépôt gelé
    const tr = await ctx.agent
      .post("/api/stock/transfers")
      .set(auth())
      .send({
        fromDepotId: ids.depotId,
        toDepotId: depot2.body.id,
        items: [{ productId: ids.productId, quantity: 1 }],
      });
    expect(tr.status).toBe(409);
    expect(tr.body.error.code).toBe("STOCK_FROZEN");

    // Annulation de la campagne → gel levé immédiatement
    await ctx.agent
      .post(`/api/inventory-campaigns/${id}/cancel`)
      .set(auth())
      .send({});
    const saleAfter = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 1 }],
        paymentMethod: "CASH",
      });
    expect(saleAfter.status).toBe(201);
  });

  it("motif codifié sur l'ajustement manuel (/api/stock/adjust)", async () => {
    const r = await ctx.agent.post("/api/stock/adjust").set(auth()).send({
      productId: ids.productId,
      depotId: ids.depotId,
      type: "DAMAGE",
      delta: -2,
      reasonCode: "BREAKAGE",
      reason: "Caisse tombée du rack",
    });
    expect(r.status).toBe(200);
    const mv = await ctx.pool.query<{ code: string | null; reason: string }>(
      `SELECT reason_code AS code, reason FROM stock_movements
        WHERE product_id=$1 AND type='DAMAGE' ORDER BY created_at DESC LIMIT 1`,
      [ids.productId],
    );
    expect(mv.rows[0]!.reason).toContain("[BREAKAGE]");
  });

  it("inventaire tournant ABC : classes sur les ventes, périmètre restreint et échéancier suivi", async () => {
    // Produit « star » (classe A) : gros volume vendu
    const star = await ctx.agent.post("/api/products").set(auth()).send({
      name: "Star ABC",
      purchasePrice: 100,
      sellingPrice: 200,
      unitId: ids.unitId,
    });
    expect(star.status).toBe(201);
    await ctx.agent
      .post("/api/stock/receipts")
      .set(auth())
      .send({
        depotId: ids.depotId,
        items: [{ productId: star.body.id, quantity: 1000, unitCost: 100 }],
      });
    const sell = await ctx.agent
      .post("/api/sales")
      .set(auth())
      .send({
        depotId: ids.depotId,
        items: [{ productId: star.body.id, quantity: 500 }],
        paymentMethod: "CASH",
      });
    expect(sell.status).toBe(201);

    // Échéancier : 3 classes, jamais comptées → à faire
    const sched = (
      await ctx.agent.get("/api/inventory-campaigns/abc-schedule").set(auth())
    ).body as Array<{
      scope: string;
      product_count: number;
      frequency_days: number;
      overdue: boolean;
      last_count_at: string | null;
    }>;
    expect(sched).toHaveLength(3);
    expect(sched.map((s) => s.scope)).toEqual(["ABC_A", "ABC_B", "ABC_C"]);
    expect(sched[0]!.frequency_days).toBe(30);
    expect(sched[1]!.frequency_days).toBe(90);
    expect(sched[2]!.frequency_days).toBe(365);
    expect(sched[0]!.product_count).toBeGreaterThanOrEqual(1);

    // Campagne classe A : ne contient QUE la star (seul produit vendu à 80 %)
    const c = await createCampaign({ scope: "ABC_A" });
    const id = c.body.id;
    await ctx.agent
      .post(`/api/inventory-campaigns/${id}/start`)
      .set(auth())
      .send({});
    const detail = (
      await ctx.agent.get(`/api/inventory-campaigns/${id}`).set(auth())
    ).body;
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].product_id).toBe(star.body.id);

    // Clôture complète (comptage conforme) par un autre admin
    await ctx.agent
      .put(`/api/inventory-campaigns/${id}/counts`)
      .set(auth())
      .send({
        lines: [
          {
            productId: star.body.id,
            countedQty: detail.items[0].theoretical_qty,
          },
        ],
      });
    await ctx.agent
      .post(`/api/inventory-campaigns/${id}/review`)
      .set(auth())
      .send({});
    const admin2login = await ctx.agent.post("/api/auth/login").send({
      email: `controleur-clone@test.cm`,
      password: "x",
    });
    expect(admin2login.status).toBe(401); // garde-fou : login inconnu refusé
    // Réutilisation du contrôleur créé plus haut
    const users = (
      await ctx.agent.get("/api/users?includeInactive=false").set(auth())
    ).body;
    const validator = (
      users as Array<{ name: string; email: string | null }>
    ).find((u) => u.name === "Contrôleur Gestion");
    expect(validator).toBeTruthy();
    const vLogin = await ctx.agent.post("/api/auth/login").send({
      email: validator!.email,
      password: "Controle1!",
    });
    await ctx.agent
      .post(`/api/inventory-campaigns/${id}/validate`)
      .set(auth(vLogin.body.accessToken))
      .send({});

    // L'échéancier ABC_A est désormais rincé (plus en retard)
    const sched2 = (
      await ctx.agent.get("/api/inventory-campaigns/abc-schedule").set(auth())
    ).body as Array<{
      scope: string;
      overdue: boolean;
      last_count_at: string | null;
    }>;
    const a = sched2.find((s) => s.scope === "ABC_A")!;
    expect(a.last_count_at).toBeTruthy();
    expect(a.overdue).toBe(false);
  });
});
