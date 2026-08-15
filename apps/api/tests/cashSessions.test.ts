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
 * E6 — Sessions de caisse : fond d'ouverture, ventes et encaissements
 * rattachés à la session ouverte, attendu par méthode, compté physique et
 * écart à la clôture, Z figé immuable, journée métier verrouillée après
 * clôture, vente interdite hors session lorsque le tenant l'exige (config).
 */
describe("E6 — Sessions de caisse", () => {
  let ctx: TestContext;
  let ids: SeedIds;
  const auth = (t?: string) => ({
    Authorization: `Bearer ${t ?? ids.adminToken}`,
  });

  let sessionId: string;
  let saleId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    ids = await seedTenant(ctx);
    await receiveStock(ctx, ids, 100);
  });
  afterAll(() => destroyTestContext(ctx));

  /* ------------------------- Ouverture & garde-fous ---------------------- */
  it("ouverture : fond de caisse, unicité par dépôt, dépôt exigé pour un admin", async () => {
    // Un ADMIN sans dépôt doit préciser depotId
    const noDepot = await ctx.agent
      .post("/api/cash-sessions")
      .set(auth())
      .send({ openingFloat: 5000 });
    expect(noDepot.status).toBe(400);
    expect(noDepot.body.error.code).toBe("DEPOT_REQUIRED");

    // Le vendeur ouvre sur SON dépôt (résolu automatiquement)
    const open = await ctx.agent
      .post("/api/cash-sessions")
      .set(auth(ids.vendorToken))
      .send({ openingFloat: 5000, note: "Ouverture matin" });
    expect(open.status).toBe(201);
    expect(open.body.status).toBe("OPEN");
    expect(open.body.openingFloat).toBe(5000);
    expect(open.body.openedBy).toBe(ids.vendorId);
    const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
    expect(open.body.businessDate).toBe(today);
    sessionId = open.body.id;

    // Deuxième ouverture sur le même dépôt → 409 explicite
    const dup = await ctx.agent
      .post("/api/cash-sessions")
      .set(auth(ids.vendorToken))
      .send({ openingFloat: 1000 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("SESSION_ALREADY_OPEN");

    // L'admin aussi bute sur la même session ouverte (même dépôt)
    const dupAdmin = await ctx.agent
      .post("/api/cash-sessions")
      .set(auth())
      .send({ depotId: ids.depotId, openingFloat: 1000 });
    expect(dupAdmin.status).toBe(409);
  });

  it("vente et versement rattachés automatiquement à la session ouverte", async () => {
    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 2 }],
        paymentMethod: "CASH",
      });
    expect(sale.status).toBe(201);
    saleId = sale.body.sale.id;
    expect(Number(sale.body.sale.total_amount)).toBe(800);

    // Rattachement tracé en base (vente + versement initial)
    const dbSale = await ctx.pool.query<{ s: string | null }>(
      "SELECT cash_session_id AS s FROM sales WHERE id=$1",
      [saleId],
    );
    const dbPay = await ctx.pool.query<{ s: string | null }>(
      "SELECT cash_session_id AS s FROM sale_payments WHERE sale_id=$1 LIMIT 1",
      [saleId],
    );
    expect(dbSale.rows[0]!.s).toBe(sessionId);
    expect(dbPay.rows[0]!.s).toBe(sessionId);

    // Attendus en direct : fond 5000 + 800 espèces
    const cur = await ctx.agent
      .get("/api/cash-sessions/current")
      .set(auth(ids.vendorToken));
    expect(cur.status).toBe(200);
    expect(cur.body.required).toBe(false);
    expect(cur.body.session.id).toBe(sessionId);
    expect(cur.body.session.expected.CASH).toBe(5800);
    expect(cur.body.session.expected.MTN_MOMO).toBe(0);
  });

  it("clôture : attendus/comptés/écarts figés dans un Z immuable, re-clôture refusée", async () => {
    const close = await ctx.agent
      .post(`/api/cash-sessions/${sessionId}/close`)
      .set(auth(ids.vendorToken))
      .send({ countedCash: 5750, countedMtn: 0, note: "Fermeture soir" });
    expect(close.status).toBe(200);
    expect(close.body.status).toBe("CLOSED");
    expect(close.body.closedBy).toBe(ids.vendorId);
    expect(close.body.countedCash).toBe(5750);

    const z = close.body.zReport;
    expect(z.businessDate).toBeTruthy();
    expect(z.openingFloat).toBe(5000);
    expect(z.sales.count).toBe(1);
    expect(z.sales.totalSold).toBe(800);
    expect(z.sales.totalPaid).toBe(800);
    expect(z.sales.creditOutstanding).toBe(0);
    // CASH : attendu = fond + encaissements ; écart = compté − attendu
    expect(z.methods.CASH.payments).toBe(800);
    expect(z.methods.CASH.expected).toBe(5800);
    expect(z.methods.CASH.counted).toBe(5750);
    expect(z.methods.CASH.variance).toBe(-50);
    expect(z.methods.MTN_MOMO.variance).toBe(0);
    expect(z.methods.ORANGE_MONEY.variance).toBeNull(); // non compté
    expect(z.varianceTotal).toBe(-50);

    // Le Z est FIGÉ : une seconde clôture est refusée (pas d'écrasement)
    const again = await ctx.agent
      .post(`/api/cash-sessions/${sessionId}/close`)
      .set(auth(ids.vendorToken))
      .send({ countedCash: 999999 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("SESSION_ALREADY_CLOSED");

    // Le Z relu est identique (immuable en base)
    const reread = await ctx.agent
      .get(`/api/cash-sessions/${sessionId}`)
      .set(auth());
    expect(reread.body.zReport.methods.CASH.variance).toBe(-50);
  });

  it("journée verrouillée : réouverture refusée et annulation d'une vente du jour bloquée", async () => {
    // Impossible de rouvrir une caisse sur la journée clôturée
    const reopen = await ctx.agent
      .post("/api/cash-sessions")
      .set(auth(ids.vendorToken))
      .send({ openingFloat: 0 });
    expect(reopen.status).toBe(409);
    expect(reopen.body.error.code).toBe("DAY_LOCKED");

    // L'annulation (même jour) d'une vente rattachée à la session clôturée
    // est verrouillée : le Z est définitif.
    const voidRes = await ctx.agent
      .post(`/api/sales/${saleId}/void`)
      .set(auth())
      .send({ reason: "test" });
    expect(voidRes.status).toBe(409);
    expect(voidRes.body.error.code).toBe("SESSION_DAY_LOCKED");
  });

  it("session obligatoire (config) : vente et encaissement refusés hors caisse", async () => {
    const setConf = (value: string) =>
      ctx.agent
        .put("/api/configs/tenant")
        .set(auth())
        .send({ key: "cash_session_required", value });

    // Activation de l'exigence
    expect((await setConf("true")).status).toBe(200);
    // Valeur invalide rejetée
    const bad = await ctx.agent
      .put("/api/configs/tenant")
      .set(auth())
      .send({ key: "cash_session_required", value: "oui" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("CONFIG_VALUE_INVALID");

    // Préférence visible EN CLAIR (non masquée) dans la config tenant
    const confList = await ctx.agent.get("/api/configs/tenant").set(auth());
    const pref = confList.body.find(
      (c: { key: string }) => c.key === "cash_session_required",
    );
    expect(pref.value).toBe("true");
    expect(pref.masked).toBe(false);

    // Vente refusée : pas de session ouverte
    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 1 }],
        paymentMethod: "CASH",
      });
    expect(sale.status).toBe(409);
    expect(sale.body.error.code).toBe("NO_CASH_SESSION");

    // Vente à crédit (hors session, config désactivée) puis encaissement
    // refusé quand l'exigence est réactivée sans caisse ouverte.
    expect((await setConf("false")).status).toBe(200);
    const cust = await ctx.agent
      .post("/api/customers")
      .set(auth())
      .send({ name: "Client Session", phone: "690000011" });
    expect(cust.status).toBe(201);
    const credit = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({
        items: [{ productId: ids.productId, quantity: 1 }],
        paymentMethod: "CASH",
        customerId: cust.body.id,
        payments: [], // vente 100 % crédit : aucun versement initial
      });
    expect(credit.status).toBe(201);

    expect((await setConf("true")).status).toBe(200);
    const pay = await ctx.agent
      .post(`/api/sales/${credit.body.sale.id}/payments`)
      .set(auth(ids.vendorToken))
      .send({ method: "CASH", amount: 100 });
    expect(pay.status).toBe(409);
    expect(pay.body.error.code).toBe("NO_CASH_SESSION");
    expect((await setConf("false")).status).toBe(200);
  });

  it("nouvelle journée : ouverture possible après minuit, écarts visibles du gérant", async () => {
    // Simule « demain » : la journée clôturée est d'hier en base
    // (calcul JS — pas d'arithmétique d'intervalle SQL pour la parité pg-mem)
    const yesterday = new Date(Date.now() - 86400000)
      .toISOString()
      .slice(0, 10);
    await ctx.pool.query(
      "UPDATE cash_sessions SET business_date=$2 WHERE id=$1",
      [sessionId, yesterday],
    );

    const open = await ctx.agent
      .post("/api/cash-sessions")
      .set(auth(ids.vendorToken))
      .send({ openingFloat: 2000 });
    expect(open.status).toBe(201);

    // Le gérant voit les deux sessions, dont l'écart de −50 de la clôture
    const list = await ctx.agent.get("/api/cash-sessions").set(auth());
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    const closed = list.body.data.find(
      (s: { status: string }) => s.status === "CLOSED",
    );
    expect(closed.zReport.varianceTotal).toBe(-50);

    // Liste réservée au gérant
    const deny = await ctx.agent
      .get("/api/cash-sessions")
      .set(auth(ids.vendorToken));
    expect(deny.status).toBe(403);

    // Filtre statut
    const openList = await ctx.agent
      .get("/api/cash-sessions?status=OPEN")
      .set(auth());
    expect(openList.body.total).toBe(1);
    expect(openList.body.data[0].openingFloat).toBe(2000);

    // Encaissement différé (vente crédit du test précédent) rattaché à la
    // NOUVELLE session du jour (mouvement de caisse du jour).
    const creditSale = await ctx.pool.query<{ id: string }>(
      `SELECT id FROM sales WHERE payment_status IN ('CREDIT','PARTIAL')
        AND tenant_id=$1 LIMIT 1`,
      [ids.tenantId],
    );
    const pay = await ctx.agent
      .post(`/api/sales/${creditSale.rows[0]!.id}/payments`)
      .set(auth(ids.vendorToken))
      .send({ method: "CASH", amount: 100 });
    expect(pay.status).toBe(201);
    const attached = await ctx.pool.query<{ s: string | null }>(
      `SELECT cash_session_id AS s FROM sale_payments
        WHERE sale_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [creditSale.rows[0]!.id],
    );
    expect(attached.rows[0]!.s).toBe(open.body.id);

    // Nettoyage : clôture de la session du jour pour laisser la base saine
    const close = await ctx.agent
      .post(`/api/cash-sessions/${open.body.id}/close`)
      .set(auth(ids.vendorToken))
      .send({ countedCash: 2100 });
    expect(close.status).toBe(200);
    expect(close.body.zReport.methods.CASH.expected).toBe(2100);
    expect(close.body.zReport.methods.CASH.variance).toBe(0);
  });
});
