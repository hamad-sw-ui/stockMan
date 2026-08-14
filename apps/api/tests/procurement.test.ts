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
 * E4 — Approvisionnement par commandes : cycle complet du bon de commande
 * (brouillon → envoyée → réceptions partielles avec reliquats et motifs
 * d'écart → clôture), mesure des délais fournisseurs (OTIF) et retours
 * fournisseur valorisés au coût réel du lot, suggestion de commande depuis
 * le rapport prédictif.
 */
describe("E4 — Approvisionnement", () => {
  let ctx: TestContext;
  let ids: SeedIds;
  const auth = () => ({ Authorization: `Bearer ${ids.adminToken}` });

  beforeAll(async () => {
    ctx = await createTestContext();
    ids = await seedTenant(ctx);
  });
  afterAll(() => destroyTestContext(ctx));

  async function makeSupplier(name: string, defaultLeadTimeDays = 5) {
    const r = await ctx.agent
      .post("/api/suppliers")
      .set(auth())
      .send({ name, defaultLeadTimeDays });
    expect(r.status).toBe(201);
    return r.body.id as string;
  }

  async function makePo(
    supplierId: string,
    items: Array<{ productId: string; quantity: number; unitCost: number }>,
    extra: Record<string, unknown> = {},
  ) {
    const r = await ctx.agent
      .post("/api/purchase-orders")
      .set(auth())
      .send({ supplierId, depotId: ids.depotId, items, ...extra });
    expect(r.status).toBe(201);
    return r.body;
  }

  /* ------------------------- 1. Création & cycle de vie ------------------- */
  it("création brouillon : livraison prévue = création + délai fournisseur", async () => {
    const sup = await makeSupplier("Établissements Nanga", 5);
    const po = await makePo(sup, [
      { productId: ids.productId, quantity: 10, unitCost: 300 },
    ]);
    expect(po.status).toBe("DRAFT");
    expect(po.items).toHaveLength(1);
    expect(po.items[0].quantity).toBe(10);
    expect(po.items[0].remaining_qty).toBe(10);
    const expected = new Date(Date.now() + 5 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(String(po.expected_at).slice(0, 10)).toBe(expected);
  });

  it("cycle : impossible de réceptionner un brouillon, d'envoyer deux fois, vendor refusé", async () => {
    const sup = await makeSupplier("Fournisseur Cycle");
    const po = await makePo(sup, [
      { productId: ids.productId, quantity: 10, unitCost: 300 },
    ]);
    // Réception sur brouillon → 409
    const rec = await ctx.agent
      .post(`/api/purchase-orders/${po.id}/receive`)
      .set(auth())
      .send({ items: [{ poItemId: po.items[0].id, quantity: 1 }] });
    expect(rec.status).toBe(409);
    expect(rec.body.error.code).toBe("PO_NOT_RECEIVABLE");

    const sent = await ctx.agent
      .post(`/api/purchase-orders/${po.id}/send`)
      .set(auth())
      .send({});
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("SENT");
    // Double envoi → 409
    const resend = await ctx.agent
      .post(`/api/purchase-orders/${po.id}/send`)
      .set(auth())
      .send({});
    expect(resend.status).toBe(409);
    expect(resend.body.error.code).toBe("PO_NOT_DRAFT");
    // Vendeur : aucun droit achats
    const deny = await ctx.agent
      .get("/api/purchase-orders")
      .set("Authorization", `Bearer ${ids.vendorToken}`);
    expect(deny.status).toBe(403);
    // Annulation après envoi → 409 (on clôture, on n'annule plus)
    const cancel = await ctx.agent
      .post(`/api/purchase-orders/${po.id}/cancel`)
      .set(auth())
      .send({});
    expect(cancel.status).toBe(409);
  });

  it("annulation d'un brouillon", async () => {
    const sup = await makeSupplier("Fournisseur Annulable");
    const po = await makePo(sup, [
      { productId: ids.productId, quantity: 2, unitCost: 250 },
    ]);
    const r = await ctx.agent
      .post(`/api/purchase-orders/${po.id}/cancel`)
      .set(auth())
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("CANCELLED");
  });

  /* -------------- 2. Réception partielle, reliquats, motifs d'écart ------- */
  it("réceptions partielles : reliquat exact, stock et CUMP réels, motif d'écart codifié", async () => {
    const sup = await makeSupplier("Fournisseur Reliquat");
    const po = await makePo(sup, [
      { productId: ids.productId, quantity: 10, unitCost: 300 },
    ]);
    await ctx.agent
      .post(`/api/purchase-orders/${po.id}/send`)
      .set(auth())
      .send({});

    const before = await ctx.pool.query<{ q: number }>(
      `SELECT COALESCE(SUM(quantity),0)::float AS q FROM stock_levels
        WHERE product_id=$1 AND depot_id=$2`,
      [ids.productId, ids.depotId],
    );
    const stockBefore = before.rows[0]!.q;

    // Première livraison : 4/10 (motif explicite DAMAGED sur l'écart)
    const r1 = await ctx.agent
      .post(`/api/purchase-orders/${po.id}/receive`)
      .set(auth())
      .send({
        items: [
          {
            poItemId: po.items[0].id,
            quantity: 4,
            discrepancyReason: "DAMAGED",
          },
        ],
      });
    expect(r1.status).toBe(201);
    expect(r1.body.status).toBe("PARTIALLY_RECEIVED");

    let detail = (
      await ctx.agent.get(`/api/purchase-orders/${po.id}`).set(auth())
    ).body;
    expect(detail.items[0].received_qty).toBe(4);
    expect(detail.items[0].remaining_qty).toBe(6);
    expect(detail.first_received_at).toBeTruthy();
    // Le motif est tracé sur la ligne de réception liée
    const rcItem = await ctx.pool.query<{ dr: string | null }>(
      `SELECT discrepancy_reason AS dr FROM stock_receipt_items
        WHERE po_item_id=$1`,
      [po.items[0].id],
    );
    expect(rcItem.rows[0]!.dr).toBe("DAMAGED");

    // Stock mouvementé de 4 au coût de la commande (300)
    const after = await ctx.pool.query<{ q: number }>(
      `SELECT COALESCE(SUM(quantity),0)::float AS q FROM stock_levels
        WHERE product_id=$1 AND depot_id=$2`,
      [ids.productId, ids.depotId],
    );
    expect(after.rows[0]!.q).toBeCloseTo(stockBefore + 4, 6);
    const mv = await ctx.pool.query<{ reference_id: string; cost: number }>(
      `SELECT reference_id, unit_cost::float AS cost FROM stock_movements
        WHERE type='IN' AND product_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [ids.productId],
    );
    expect(mv.rows[0]!.reference_id).toBe(r1.body.receiptId);
    expect(mv.rows[0]!.cost).toBe(300);

    // CUMP : repondéré avec l'entrée à 300 (pas le prix catalogue)
    const cump = await ctx.pool.query<{ c: number }>(
      "SELECT avg_cost::float AS c FROM products WHERE id=$1",
      [ids.productId],
    );
    expect(cump.rows[0]!.c).toBeGreaterThan(200);

    // Sur-réception refusée (reliquat 6, on tente 7)
    const over = await ctx.agent
      .post(`/api/purchase-orders/${po.id}/receive`)
      .set(auth())
      .send({ items: [{ poItemId: po.items[0].id, quantity: 7 }] });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("PO_OVER_RECEIPT");

    // Motif implicite : livraison courte sans motif → SHORT_DELIVERY
    const r2 = await ctx.agent
      .post(`/api/purchase-orders/${po.id}/receive`)
      .set(auth())
      .send({ items: [{ poItemId: po.items[0].id, quantity: 5 }] });
    expect(r2.status).toBe(201);
    // Filtre par réception exacte (id UUID non ordonnable)
    const rcItem2 = await ctx.pool.query<{ dr: string | null }>(
      `SELECT discrepancy_reason AS dr FROM stock_receipt_items
        WHERE po_item_id=$1 AND receipt_id=$2`,
      [po.items[0].id, r2.body.receiptId],
    );
    expect(rcItem2.rows[0]!.dr).toBe("SHORT_DELIVERY");

    // Reliquat 1 restant : clôture manuelle avec motif codifié
    const close = await ctx.agent
      .post(`/api/purchase-orders/${po.id}/close`)
      .set(auth())
      .send({ reason: "SUPPLIER_SHORTAGE" });
    expect(close.status).toBe(200);
    expect(close.body.status).toBe("CLOSED");
    expect(close.body.backorderQty).toBeCloseTo(1, 6);
    detail = (await ctx.agent.get(`/api/purchase-orders/${po.id}`).set(auth()))
      .body;
    expect(detail.status).toBe("CLOSED");
    expect(detail.close_reason).toBe("SUPPLIER_SHORTAGE");
  });

  it("clôture automatique quand toutes les lignes sont livrées", async () => {
    const sup = await makeSupplier("Fournisseur Complet");
    const po = await makePo(sup, [
      { productId: ids.productId, quantity: 6, unitCost: 280 },
    ]);
    await ctx.agent
      .post(`/api/purchase-orders/${po.id}/send`)
      .set(auth())
      .send({});
    const r = await ctx.agent
      .post(`/api/purchase-orders/${po.id}/receive`)
      .set(auth())
      .send({ items: [{ poItemId: po.items[0].id, quantity: 6 }] });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("CLOSED");
    const detail = (
      await ctx.agent.get(`/api/purchase-orders/${po.id}`).set(auth())
    ).body;
    expect(detail.close_reason).toBe("DELIVERED");
    expect(detail.closed_at).toBeTruthy();
    expect(detail.items[0].remaining_qty).toBe(0);
    // Une commande clôturée ne reçoit plus rien
    const late = await ctx.agent
      .post(`/api/purchase-orders/${po.id}/receive`)
      .set(auth())
      .send({ items: [{ poItemId: po.items[0].id, quantity: 1 }] });
    expect(late.status).toBe(409);
  });

  it("produit géré par lot : même exigence de numéro de lot sur réception commande", async () => {
    const tracked = await ctx.agent.post("/api/products").set(auth()).send({
      name: "Lait loté",
      purchasePrice: 500,
      sellingPrice: 800,
      unitId: ids.unitId,
      trackBatch: true,
    });
    expect(tracked.status).toBe(201);
    const sup = await makeSupplier("Laiterie Cameroun");
    const po = await makePo(sup, [
      { productId: tracked.body.id, quantity: 12, unitCost: 480 },
    ]);
    await ctx.agent
      .post(`/api/purchase-orders/${po.id}/send`)
      .set(auth())
      .send({});
    const noBatch = await ctx.agent
      .post(`/api/purchase-orders/${po.id}/receive`)
      .set(auth())
      .send({ items: [{ poItemId: po.items[0].id, quantity: 12 }] });
    expect(noBatch.status).toBe(400);
    expect(noBatch.body.error.code).toBe("BATCH_REQUIRED");
    const ok = await ctx.agent
      .post(`/api/purchase-orders/${po.id}/receive`)
      .set(auth())
      .send({
        items: [
          {
            poItemId: po.items[0].id,
            quantity: 12,
            batchNumber: "LAIT-01",
            expiryDate: "2027-06-01",
          },
        ],
      });
    expect(ok.status).toBe(201);
    const batch = await ctx.pool.query<{ cost: number; qty: number }>(
      `SELECT unit_cost::float AS cost, quantity::float AS qty FROM stock_batches
        WHERE product_id=$1 AND batch_number='LAIT-01'`,
      [tracked.body.id],
    );
    expect(batch.rows[0]!.cost).toBe(480);
    expect(batch.rows[0]!.qty).toBe(12);
  });

  /* ---------------------------- 3. OTIF ----------------------------------- */
  it("OTIF : on-time/in-full calculés par fournisseur, délai réel moyen", async () => {
    const sup = await makeSupplier("Fournisseur OTIF", 10);
    // Commande 1 : livrée complète et à temps (prévue dans 10 jours) → OTIF
    const po1 = await makePo(sup, [
      { productId: ids.productId, quantity: 3, unitCost: 210 },
    ]);
    await ctx.agent
      .post(`/api/purchase-orders/${po1.id}/send`)
      .set(auth())
      .send({});
    await ctx.agent
      .post(`/api/purchase-orders/${po1.id}/receive`)
      .set(auth())
      .send({ items: [{ poItemId: po1.items[0].id, quantity: 3 }] });
    // Commande 2 : clôturée avec reliquat → In-Full perdu
    const po2 = await makePo(sup, [
      { productId: ids.productId, quantity: 5, unitCost: 210 },
    ]);
    await ctx.agent
      .post(`/api/purchase-orders/${po2.id}/send`)
      .set(auth())
      .send({});
    await ctx.agent
      .post(`/api/purchase-orders/${po2.id}/receive`)
      .set(auth())
      .send({ items: [{ poItemId: po2.items[0].id, quantity: 2 }] });
    await ctx.agent
      .post(`/api/purchase-orders/${po2.id}/close`)
      .set(auth())
      .send({ reason: "SUPPLIER_SHORTAGE" });

    const otif = (
      await ctx.agent
        .get(`/api/purchase-orders/otif?supplierId=${sup}`)
        .set(auth())
    ).body;
    expect(otif).toHaveLength(1);
    const row = otif[0];
    expect(row.orders).toBe(2);
    expect(row.closed_orders).toBe(2);
    expect(row.on_time_rate).toBe(100); // les deux clôturées dans les délais
    expect(row.in_full_rate).toBe(50); // une complète, une courte
    expect(row.otif_rate).toBe(50);
    expect(row.avg_lead_time_days).toBe(0); // réception immédiate
  });

  /* ----------------------- 4. Retours fournisseur ------------------------- */
  it("retour fournisseur : valorisé au coût réel du lot, stock et lot décrémentés, mouvement dédié", async () => {
    const pid = "11111111-2222-4333-8444-555555555555"; // produit dédié, créé via API ci-dessous
    const prod = await ctx.agent.post("/api/products").set(auth()).send({
      name: "Savon retour",
      barcode: "6100000000995",
      purchasePrice: 150,
      sellingPrice: 300,
      unitId: ids.unitId,
    });
    expect(prod.status).toBe(201);
    const productId = prod.body.id;
    expect(productId).not.toBe(pid); // garde anti-collision (id généré)

    const sup = await makeSupplier("Fournisseur Retours", 3);
    // Entrée lotée à 175 F par l'API réception (coût réel distinct du catalogue)
    const rcv = await ctx.agent
      .post("/api/stock/receipts")
      .set(auth())
      .send({
        depotId: ids.depotId,
        supplierId: sup,
        items: [
          {
            productId,
            quantity: 20,
            unitCost: 175,
            batchNumber: "SAV-A",
            expiryDate: "2028-01-01",
          },
        ],
      });
    expect(rcv.status).toBe(201);
    const batch = await ctx.pool.query<{ id: string }>(
      "SELECT id FROM stock_batches WHERE product_id=$1 AND batch_number='SAV-A'",
      [productId],
    );
    const batchId = batch.rows[0]!.id;

    const ret = await ctx.agent
      .post("/api/purchase-orders/returns")
      .set(auth())
      .send({
        supplierId: sup,
        depotId: ids.depotId,
        reason: "QUALITY",
        items: [{ productId, quantity: 5, batchId }],
      });
    expect(ret.status).toBe(201);
    expect(ret.body.totalCost).toBe(5 * 175);

    const stock = await ctx.pool.query<{ q: number }>(
      "SELECT quantity::float AS q FROM stock_levels WHERE product_id=$1 AND depot_id=$2",
      [productId, ids.depotId],
    );
    expect(stock.rows[0]!.q).toBe(15);
    const lot = await ctx.pool.query<{ q: number }>(
      "SELECT quantity::float AS q FROM stock_batches WHERE id=$1",
      [batchId],
    );
    expect(lot.rows[0]!.q).toBe(15);
    const mv = await ctx.pool.query<{
      type: string;
      batch_id: string;
      cost: number;
      reason: string;
    }>(
      `SELECT type, batch_id, unit_cost::float AS cost, reason FROM stock_movements
        WHERE product_id=$1 AND type='SUPPLIER_RETURN'`,
      [productId],
    );
    expect(mv.rows).toHaveLength(1);
    expect(mv.rows[0]!.batch_id).toBe(batchId);
    expect(mv.rows[0]!.cost).toBe(175);
    expect(mv.rows[0]!.reason).toContain("Retour fournisseur");

    // Le CUMP n'est PAS repondéré par une sortie (il reste le coût d'entrée)
    const cump = await ctx.pool.query<{ c: number }>(
      "SELECT avg_cost::float AS c FROM products WHERE id=$1",
      [productId],
    );
    expect(cump.rows[0]!.c).toBe(175);

    // Le retour est listé + détaillé
    const list = (
      await ctx.agent
        .get(`/api/purchase-orders/returns?supplierId=${sup}`)
        .set(auth())
    ).body;
    expect(list.total).toBe(1);
    const det = (
      await ctx.agent
        .get(`/api/purchase-orders/returns/${ret.body.returnId}`)
        .set(auth())
    ).body;
    expect(det.items[0].batch_number).toBe("SAV-A");
    expect(det.items[0].quantity).toBe(5);
  });

  it("retour FEFO sans lot précisé : les lots périmés peuvent être renvoyés (contrairement à la vente)", async () => {
    const prod = await ctx.agent.post("/api/products").set(auth()).send({
      name: "Médicament retour",
      purchasePrice: 900,
      sellingPrice: 1500,
      unitId: ids.unitId,
    });
    expect(prod.status).toBe(201);
    const productId = prod.body.id;
    const sup = await makeSupplier("Grossiste Pharma");
    await ctx.agent
      .post("/api/stock/receipts")
      .set(auth())
      .send({
        depotId: ids.depotId,
        supplierId: sup,
        items: [
          {
            productId,
            quantity: 10,
            unitCost: 900,
            batchNumber: "MED-OLD",
            expiryDate: "2020-01-01", // déjà périmé
          },
        ],
      });
    // La vente est bloquée par le périmé, mais le retour fournisseur l'accepte
    const ret = await ctx.agent
      .post("/api/purchase-orders/returns")
      .set(auth())
      .send({
        supplierId: sup,
        depotId: ids.depotId,
        reason: "EXPIRED",
        items: [{ productId, quantity: 4 }], // FEFO large
      });
    expect(ret.status).toBe(201);
    expect(ret.body.totalCost).toBe(4 * 900);
    const lot = await ctx.pool.query<{ q: number }>(
      "SELECT quantity::float AS q FROM stock_batches WHERE product_id=$1 AND batch_number='MED-OLD'",
      [productId],
    );
    expect(lot.rows[0]!.q).toBe(6);
  });

  /* ---------------- 5. Suggestion depuis le rapport prédictif ------------- */
  it("prédictif : quantité suggérée et fournisseur habituel alimentent le bouton « commander »", async () => {
    const prod = await ctx.agent.post("/api/products").set(auth()).send({
      name: "Riz prédictif",
      purchasePrice: 400,
      sellingPrice: 600,
      minStockLevel: 10,
      unitId: ids.unitId,
    });
    expect(prod.status).toBe(201);
    const productId = prod.body.id;
    const sup = await makeSupplier("Céréalier Suggestion", 7);
    await ctx.agent
      .post("/api/stock/receipts")
      .set(auth())
      .send({
        depotId: ids.depotId,
        supplierId: sup,
        items: [{ productId, quantity: 5, unitCost: 400 }],
      });
    const rows = (await ctx.agent.get("/api/reports/predictive").set(auth()))
      .body as Array<{
      product_id: string;
      suggested_qty: number;
      supplier_id: string | null;
      supplier_name: string | null;
      lead_days: number | null;
      purchase_price: number;
    }>;
    const row = rows.find((r) => r.product_id === productId);
    expect(row).toBeTruthy();
    // Sans ventes : cible = 2× seuil = 20, stock 5 → suggestion 15
    expect(row!.suggested_qty).toBe(15);
    expect(row!.supplier_id).toBe(sup);
    expect(row!.supplier_name).toBe("Céréalier Suggestion");
    expect(row!.lead_days).toBe(7);
    expect(row!.purchase_price).toBe(400);
  });

  it("réception libre rattachée : les compteurs de la commande suivent", async () => {
    // Cas nominal vérifié plus haut ; ici : l'index purchase_order est renseigné
    const sup = await makeSupplier("Fournisseur Index");
    const po = await makePo(sup, [
      { productId: ids.productId, quantity: 2, unitCost: 200 },
    ]);
    await ctx.agent
      .post(`/api/purchase-orders/${po.id}/send`)
      .set(auth())
      .send({});
    const r = await ctx.agent
      .post(`/api/purchase-orders/${po.id}/receive`)
      .set(auth())
      .send({ items: [{ poItemId: po.items[0].id, quantity: 2 }] });
    const link = await ctx.pool.query<{ po: string }>(
      "SELECT purchase_order_id AS po FROM stock_receipts WHERE id=$1",
      [r.body.receiptId],
    );
    expect(link.rows[0]!.po).toBe(po.id);
  });
});
