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
 * E7 — Fiscalité Cameroun : TVA par produit avec ventilation HT/TVA figée
 * (prix TTC), factures à numérotation légale continue par dépôt/série/année
 * (séquence verrouillée), facture immuable, avoir émis à l'annulation et au
 * retour, mentions légales, journal de TVA et exports SYSCOHADA.
 */
describe("E7 — Fiscalité & facturation", () => {
  let ctx: TestContext;
  let ids: SeedIds;
  const auth = (t?: string) => ({
    Authorization: `Bearer ${t ?? ids.adminToken}`,
  });

  let exemptProductId: string;
  const year = new Date().getUTCFullYear();

  beforeAll(async () => {
    ctx = await createTestContext();
    ids = await seedTenant(ctx);
    await receiveStock(ctx, ids, 100);
    // Produit exonéré de TVA (taux 0 %)
    const p = await ctx.agent.post("/api/products").set(auth()).send({
      name: "Riz Sac 5kg (exonéré)",
      purchasePrice: 3000,
      sellingPrice: 5000,
      unitId: ids.unitId,
      taxRate: 0,
    });
    expect(p.status).toBe(201);
    exemptProductId = p.body.id;
    await ctx.agent
      .post("/api/stock/receipts")
      .set(auth())
      .send({
        depotId: ids.depotId,
        items: [{ productId: exemptProductId, quantity: 50, unitCost: 3000 }],
      });
  });
  afterAll(() => destroyTestContext(ctx));

  it("TVA par produit : taux figé sur la ligne, ventilation HT/TVA exacte (prix TTC)", async () => {
    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [
          { productId: ids.productId, quantity: 2 }, // 2 × 400 TTC à 19,25 %
          { productId: exemptProductId, quantity: 1 }, // 5000 TTC à 0 %
        ],
        paymentMethod: "CASH",
      });
    expect(sale.status).toBe(201);
    const s = sale.body.sale;
    expect(Number(s.total_amount)).toBe(5800);
    // Ligne 1 : HT = 800/1,1925 → 670,86 ; TVA = 129,14
    // Ligne 2 (exonérée) : HT = TTC = 5000 ; TVA = 0
    expect(s.total_ht).toBeCloseTo(670.86 + 5000, 2);
    expect(s.total_vat).toBeCloseTo(129.14, 2);
    const line1 = s.items.find(
      (i: { product_id: string }) => i.product_id === ids.productId,
    );
    expect(Number(line1.tax_rate)).toBe(19.25);
    expect(line1.total_ht).toBeCloseTo(670.86, 2);
    expect(line1.total_vat).toBeCloseTo(129.14, 2);
    const line2 = s.items.find(
      (i: { product_id: string }) => i.product_id === exemptProductId,
    );
    expect(Number(line2.tax_rate)).toBe(0);
    expect(line2.total_ht).toBeCloseTo(5000, 2);
    expect(line2.total_vat).toBeCloseTo(0, 2);
    // HT + TVA = TTC, au centime
    expect(s.total_ht + s.total_vat).toBeCloseTo(5800, 2);
  });

  it("facture émise automatiquement : numéro légal, montants, instantanés", async () => {
    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 3 }],
        paymentMethod: "MTN_MOMO",
      });
    expect(sale.status).toBe(201);

    const bySale = await ctx.agent
      .get(`/api/invoices/by-sale/${sale.body.sale.id}`)
      .set(auth(ids.vendorToken));
    expect(bySale.status).toBe(200);
    expect(bySale.body.length).toBe(1);
    const inv = bySale.body[0];
    expect(inv.kind).toBe("INVOICE");
    expect(inv.number).toMatch(
      new RegExp(`^FAC-[A-Z0-9]{1,4}-${year}-\\d{6}$`),
    );
    expect(inv.seq).toBeGreaterThan(0);
    expect(inv.totalTtc).toBeCloseTo(1200, 2);
    expect(inv.totalHt + inv.totalVat).toBeCloseTo(1200, 2);

    // Détail : lignes ventilées + mentions légales du tenant
    const detail = await ctx.agent.get(`/api/invoices/${inv.id}`).set(auth());
    expect(detail.status).toBe(200);
    expect(detail.body.items.length).toBe(1);
    expect(detail.body.items[0].product_name).toBe("Eau Test 1.5L");
    expect(detail.body.items[0].total_ttc).toBeCloseTo(1200, 2);
    expect(detail.body.tenant).toBeTruthy();
    expect(detail.body.tenant.name).toBe("SARL Test");
  });

  it("numérotation continue par dépôt, sans trou ni collision", async () => {
    // Deux ventes successives → séquence consécutive (peu importe le départ,
    // les tests précédents ont déjà facturé : on vérifie la continuité)
    const s1 = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 1 }],
        paymentMethod: "CASH",
      });
    const s2 = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 1 }],
        paymentMethod: "CASH",
      });
    const i1 = (
      await ctx.agent
        .get(`/api/invoices/by-sale/${s1.body.sale.id}`)
        .set(auth())
    ).body[0];
    const i2 = (
      await ctx.agent
        .get(`/api/invoices/by-sale/${s2.body.sale.id}`)
        .set(auth())
    ).body[0];
    expect(i2.seq).toBe(i1.seq + 1);
    expect(i1.year).toBe(year);

    // Un second dépôt possède sa propre série (démarre à 1)
    const d2 = await ctx.agent
      .post("/api/depots")
      .set(auth())
      .send({ name: "Depot Sud" });
    expect(d2.status).toBe(201);
    await ctx.agent
      .post("/api/stock/receipts")
      .set(auth())
      .send({
        depotId: d2.body.id,
        items: [{ productId: ids.productId, quantity: 10, unitCost: 200 }],
      });
    const s3 = await ctx.agent
      .post("/api/sales")
      .set(auth())
      .send({
        depotId: d2.body.id,
        items: [{ productId: ids.productId, quantity: 1 }],
        paymentMethod: "CASH",
      });
    expect(s3.status).toBe(201);
    const i3 = (
      await ctx.agent
        .get(`/api/invoices/by-sale/${s3.body.sale.id}`)
        .set(auth())
    ).body[0];
    expect(i3.seq).toBe(1);
    expect(i3.number).toBe(`FAC-DEPO-${year}-000001`);
  });

  it("annulation : la facture est intacte, un AVOIR lié est émis (montants miroir)", async () => {
    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 4 }],
        paymentMethod: "CASH",
      });
    const [fac] = (
      await ctx.agent
        .get(`/api/invoices/by-sale/${sale.body.sale.id}`)
        .set(auth())
    ).body;

    const voidRes = await ctx.agent
      .post(`/api/sales/${sale.body.sale.id}/void`)
      .set(auth())
      .send({ reason: "Erreur caissière" });
    expect(voidRes.status).toBe(200);

    const docs = (
      await ctx.agent
        .get(`/api/invoices/by-sale/${sale.body.sale.id}`)
        .set(auth())
    ).body;
    expect(docs.length).toBe(2);
    const avoir = docs.find((d: { kind: string }) => d.kind === "CREDIT_NOTE");
    expect(avoir.number).toMatch(
      new RegExp(`^AV-[A-Z0-9]{1,4}-${year}-\\d{6}$`),
    );
    expect(avoir.parentInvoiceId).toBe(fac.id);
    expect(avoir.parentNumber).toBe(fac.number);
    expect(avoir.totalTtc).toBeCloseTo(fac.totalTtc, 2);
    expect(avoir.totalHt).toBeCloseTo(fac.totalHt, 2);

    // L'originale est IMMUABLE (montants inchangés à la relecture)
    const reload = (await ctx.agent.get(`/api/invoices/${fac.id}`).set(auth()))
      .body;
    expect(reload.totalTtc).toBeCloseTo(fac.totalTtc, 2);
    expect(reload.kind).toBe("INVOICE");
  });

  it("retour partiel : avoir partiel au taux d'origine", async () => {
    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 3 }],
        paymentMethod: "CASH",
      });
    const saleRow = sale.body.sale;
    const line = saleRow.items[0];
    const ret = await ctx.agent
      .post(`/api/sales/${saleRow.id}/returns`)
      .set(auth())
      .send({ items: [{ saleItemId: line.id, baseQty: 1 }] });
    expect(ret.status).toBe(201);

    const docs = (
      await ctx.agent.get(`/api/invoices/by-sale/${saleRow.id}`).set(auth())
    ).body;
    const avoir = docs.find((d: { kind: string }) => d.kind === "CREDIT_NOTE");
    expect(avoir).toBeTruthy();
    expect(avoir.totalTtc).toBeCloseTo(400, 2); // 1 × 400 TTC
    expect(avoir.totalVat).toBeCloseTo(64.57, 2); // 400 − 400/1,1925
    const detail = (
      await ctx.agent.get(`/api/invoices/${avoir.id}`).set(auth())
    ).body;
    expect(detail.items[0].tax_rate).toBeCloseTo(19.25, 2);
  });

  it("journal de TVA : lignes signées (+ facture / − avoir), ventilation par taux, CSV", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const j = await ctx.agent
      .get(`/api/reports/vat-journal?from=${today}&to=${today}`)
      .set(auth());
    expect(j.status).toBe(200);
    expect(j.body.rows.length).toBeGreaterThan(0);
    const invRows = j.body.rows.filter(
      (r: { kind: string }) => r.kind === "INVOICE",
    );
    const avRows = j.body.rows.filter(
      (r: { kind: string }) => r.kind === "CREDIT_NOTE",
    );
    expect(invRows.length).toBeGreaterThan(0);
    expect(avRows.length).toBeGreaterThan(0);
    // Signes : factures à +, avoirs à −
    expect(invRows[0].ttc).toBeGreaterThan(0);
    expect(avRows[0].ttc).toBeLessThan(0);
    // Ventilation par taux présente (19,25 et 0)
    const rates = j.body.byRate.map((r: { rate: number }) => r.rate);
    expect(rates).toContain(19.25);
    expect(rates).toContain(0);
    // Totaux = Σ des lignes
    const sumTtc = j.body.rows.reduce(
      (a: number, r: { ttc: number }) => a + r.ttc,
      0,
    );
    expect(j.body.totals.ttc).toBeCloseTo(sumTtc, 2);

    const csv = await ctx.agent
      .get(`/api/reports/vat-journal?from=${today}&to=${today}&format=csv`)
      .set(auth());
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("TVA 19.25 %");
    expect(csv.text).toContain("AVOIR");
  });

  it("export SYSCOHADA ventes : écritures équilibrées aux bons comptes", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const csv = await ctx.agent
      .get(`/api/reports/exports/syscohada-sales?from=${today}&to=${today}`)
      .set(auth());
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const text: string = csv.text;
    expect(text).toContain('"VT"');
    expect(text).toContain('"571000"'); // Caisse
    expect(text).toContain('"521100"'); // MTN MoMo
    expect(text).toContain('"701100"'); // Ventes HT
    expect(text).toContain('"443100"'); // TVA collectée
    expect(text).toContain('"411100"'); // Avoirs clients

    // Équilibre global du journal (Σ Débit = Σ Crédit)
    const lines = text.split("\r\n").filter((l) => l.startsWith('"VT"'));
    let debit = 0;
    let credit = 0;
    for (const l of lines) {
      const cells = l.split('";"').map((c) => c.replaceAll('"', ""));
      debit += parseFloat(cells[5] ?? "0") || 0;
      credit += parseFloat(cells[6] ?? "0") || 0;
    }
    expect(debit).toBeCloseTo(credit, 2);
  });

  it("exports SYSCOHADA créances (411100) et inventaire valorisé (311000)", async () => {
    // Vente à crédit pour alimenter les créances
    const cust = await ctx.agent
      .post("/api/customers")
      .set(auth())
      .send({ name: "Client Fiscal", phone: "690000022" });
    const credit = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 2 }],
        paymentMethod: "CASH",
        customerId: cust.body.id,
        payments: [],
      });
    expect(credit.status).toBe(201);

    const rec = await ctx.agent
      .get("/api/reports/exports/syscohada-receivables")
      .set(auth());
    expect(rec.status).toBe(200);
    expect(rec.text).toContain('"411100"');
    expect(rec.text).toContain("Client Fiscal");
    expect(rec.text).toContain('"800.00"'); // 2 × 400 impayés

    const invt = await ctx.agent
      .get("/api/reports/exports/syscohada-inventory")
      .set(auth());
    expect(invt.status).toBe(200);
    expect(invt.text).toContain('"311000"');
    expect(invt.text).toContain("Eau Test 1.5L");
    expect(invt.text).toContain("TOTAL");
    // Filtré par dépôt
    const invtDepot = await ctx.agent
      .get(`/api/reports/exports/syscohada-inventory?depotId=${ids.depotId}`)
      .set(auth());
    expect(invtDepot.text).toContain("Eau Test 1.5L");
  });

  it("mentions légales : NIU/RCCM du tenant sur facture et reçu", async () => {
    const patch = await ctx.agent
      .patch("/api/tenants/current")
      .set(auth())
      .send({
        niu: "M062400000001W",
        rccm: "RC/YAO/2024/B/1234",
        address: "Marché Central, Yaoundé",
        invoiceFooter:
          "TVA collectée à la caisse — marchandises ni reprises ni échangées.",
      });
    expect(patch.status).toBe(200);
    expect(patch.body.niu).toBe("M062400000001W");

    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 1 }],
        paymentMethod: "CASH",
      });
    const [fac] = (
      await ctx.agent
        .get(`/api/invoices/by-sale/${sale.body.sale.id}`)
        .set(auth())
    ).body;
    const detail = (await ctx.agent.get(`/api/invoices/${fac.id}`).set(auth()))
      .body;
    expect(detail.tenant.niu).toBe("M062400000001W");
    expect(detail.tenant.rccm).toBe("RC/YAO/2024/B/1234");
    expect(detail.tenant.invoice_footer).toContain("TVA collectée");

    // Le reçu (ticket) porte désormais n° facture + ventilation + mentions
    const receipt = await ctx.agent
      .get(`/api/sales/${sale.body.sale.id}/receipt`)
      .set(auth(ids.vendorToken));
    expect(receipt.status).toBe(200);
    expect(receipt.body.totals.ht).toBeCloseTo(335.43, 2);
    expect(receipt.body.totals.vat).toBeCloseTo(64.57, 2);
    expect(receipt.body.totals.ttc).toBeCloseTo(400, 2);
    expect(receipt.body.tenant.niu).toBe("M062400000001W");
    expect(receipt.body.invoice.number).toMatch(/^FAC-/);
  });

  it("factures : liste paginée filtrée, accès vendeur restreint", async () => {
    const list = await ctx.agent
      .get("/api/invoices?kind=CREDIT_NOTE")
      .set(auth());
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThan(0);
    expect(
      list.body.data.every((d: { kind: string }) => d.kind === "CREDIT_NOTE"),
    ).toBe(true);

    // Liste réservée au gérant
    const deny = await ctx.agent
      .get("/api/invoices")
      .set(auth(ids.vendorToken));
    expect(deny.status).toBe(403);

    // Le vendeur voit les factures de SON dépôt (les ventes seed y sont)
    const own = await ctx.agent
      .get(`/api/invoices/${list.body.data[0].id}`)
      .set(auth(ids.vendorToken));
    expect(own.status).toBe(200);
  });
});
