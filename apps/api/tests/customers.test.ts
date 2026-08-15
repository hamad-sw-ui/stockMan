import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  SeedIds,
  seedTenant,
  TestContext,
  receiveStock,
} from "./helpers/app";

/**
 * E3 — Clients, crédit, versements, relances (docs/05_AUDIT_EXPERT_STOCK.md §B.3) :
 *  carnet de dettes, vente à crédit/partielle/mixte, plafond de crédit,
 *  versements idempotents hors-ligne, vieillissement des créances, relance SMS,
 *  libération du solde à l'annulation, isolation multi-tenant.
 */

let ctx: TestContext;
let ids: SeedIds;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ctx = await createTestContext();
  ids = await seedTenant(ctx);
  await receiveStock(ctx, ids, 100);
});
afterAll(async () => {
  await destroyTestContext(ctx);
});

async function makeCustomer(name: string, extra: Record<string, unknown> = {}) {
  const res = await ctx.agent
    .post("/api/customers")
    .set(auth(ids.adminToken))
    .send({ name, phone: "+237690000111", ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

async function sellWith(payload: Record<string, unknown>, token?: string) {
  return ctx.agent
    .post("/api/sales")
    .set(auth(token ?? ids.vendorToken))
    .send({
      items: [{ productId: ids.productId, quantity: 1 }],
      paymentMethod: "CASH",
      ...payload,
    });
}

describe("E3 · Fiches clients", () => {
  it("création / recherche / mise à jour (plafond de crédit)", async () => {
    await makeCustomer("Madame Lyonga");
    await makeCustomer("Chez Fotso & Fils", { creditLimit: 50000 });
    const list = await ctx.agent
      .get("/api/customers?q=fotso")
      .set(auth(ids.adminToken));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].credit_limit).toBe(50000);

    const patch = await ctx.agent
      .patch(`/api/customers/${list.body.data[0].id}`)
      .set(auth(ids.adminToken))
      .send({ creditLimit: 100000 });
    expect(patch.body.credit_limit).toBe(100000);
  });

  it("un vendeur peut créer le client à la caisse (réalité du terrain)", async () => {
    const res = await ctx.agent
      .post("/api/customers")
      .set(auth(ids.vendorToken))
      .send({ name: "Client Caisse", phone: "+237699000000" });
    expect(res.status).toBe(201);
  });
});

describe("E3 · Vente à crédit, partielle, mixte", () => {
  it("vente 100 % crédit : statut CREDIT, solde client chargé, reçu « Reste à payer »", async () => {
    const c = await makeCustomer("Crédit Total");
    const sale = await sellWith({ customerId: c.id, payments: [] });
    expect(sale.status).toBe(201);
    expect(sale.body.sale.payment_status).toBe("CREDIT");
    expect(Number(sale.body.sale.amount_paid)).toBe(0);
    const bal = await ctx.pool.query<{ balance: number }>(
      "SELECT balance::float FROM customers WHERE id=$1",
      [c.id],
    );
    expect(bal.rows[0]!.balance).toBe(400); // 1 × 400 FCFA

    const receipt = await ctx.agent
      .get(`/api/sales/${sale.body.sale.id}/receipt`)
      .set(auth(ids.vendorToken));
    expect(receipt.body.text).toContain("RESTE À PAYER : 400");
    expect(receipt.body.text).toContain("Client : Crédit Total");
  });

  it("crédit sans client refusé (CREDIT_REQUIRES_CUSTOMER)", async () => {
    const sale = await sellWith({ payments: [] });
    expect(sale.status).toBe(400);
    expect(sale.body.error.code).toBe("CREDIT_REQUIRES_CUSTOMER");
  });

  it("paiement partiel initial : PARTIAL + reliquat sur le solde", async () => {
    const c = await makeCustomer("Partiel Client");
    const sale = await sellWith({
      customerId: c.id,
      payments: [{ method: "CASH", amount: 150 }],
    });
    expect(sale.status).toBe(201);
    expect(sale.body.sale.payment_status).toBe("PARTIAL");
    expect(Number(sale.body.sale.amount_paid)).toBe(150);
    const bal = await ctx.pool.query<{ balance: number }>(
      "SELECT balance::float FROM customers WHERE id=$1",
      [c.id],
    );
    expect(bal.rows[0]!.balance).toBe(250);
  });

  it("paiement mixte espèces + MoMo : deux versements, Z réparti par méthode réelle", async () => {
    const c = await makeCustomer("Mixte Client");
    const sale = await sellWith({
      customerId: c.id,
      payments: [
        { method: "CASH", amount: 250 },
        { method: "MTN_MOMO", amount: 150, reference: "MOMO-MIX-1" },
      ],
    });
    expect(sale.status).toBe(201);
    expect(sale.body.sale.payment_status).toBe("PAID");
    expect(sale.body.sale.payments).toHaveLength(2);

    const z = await ctx.agent
      .get("/api/reports/z-report")
      .set(auth(ids.adminToken));
    const cash = z.body.byPayment.find(
      (p: { payment_method: string }) => p.payment_method === "CASH",
    );
    const momo = z.body.byPayment.find(
      (p: { payment_method: string }) => p.payment_method === "MTN_MOMO",
    );
    expect(Number(cash.amount)).toBeGreaterThanOrEqual(250);
    expect(Number(momo.amount)).toBeGreaterThanOrEqual(150);
  });

  it("plafond de crédit : dépassement refusé", async () => {
    const c = await makeCustomer("Plafond Strict", { creditLimit: 300 });
    const sale = await sellWith({ customerId: c.id, payments: [] });
    expect(sale.status).toBe(409);
    expect(sale.body.error.code).toBe("CREDIT_LIMIT_EXCEEDED");
  });
});

describe("E3 · Versements (règlements de crédit)", () => {
  it("versement successifs : PARTIAL → PAID, solde décrémenté, audit PAYMENT", async () => {
    const c = await makeCustomer("Versements Client");
    const sale = await sellWith({ customerId: c.id, payments: [] });
    const saleId = sale.body.sale.id;

    const p1 = await ctx.agent
      .post(`/api/sales/${saleId}/payments`)
      .set(auth(ids.vendorToken))
      .send({ method: "CASH", amount: 100 });
    expect(p1.status).toBe(201);
    expect(p1.body.sale.payment_status).toBe("PARTIAL");
    expect(Number(p1.body.sale.amount_paid)).toBe(100);

    const p2 = await ctx.agent
      .post(`/api/sales/${saleId}/payments`)
      .set(auth(ids.vendorToken))
      .send({ method: "ORANGE_MONEY", amount: 300, reference: "OM-777" });
    expect(p2.status).toBe(201);
    expect(p2.body.sale.payment_status).toBe("PAID");

    const bal = await ctx.pool.query<{ balance: number }>(
      "SELECT balance::float FROM customers WHERE id=$1",
      [c.id],
    );
    expect(bal.rows[0]!.balance).toBe(0);
    const audit = await ctx.pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id=$1 AND action='PAYMENT' AND entity_id=$2",
      [ids.tenantId, saleId],
    );
    expect(audit.rows[0]!.n).toBe(2);
  });

  it("idempotence : le même clientPaymentId ne compte jamais deux fois", async () => {
    const c = await makeCustomer("Idem Client");
    const sale = await sellWith({ customerId: c.id, payments: [] });
    const saleId = sale.body.sale.id;
    const cpId = crypto.randomUUID();
    const body = { method: "CASH", amount: 50, clientPaymentId: cpId };
    const first = await ctx.agent
      .post(`/api/sales/${saleId}/payments`)
      .set(auth(ids.vendorToken))
      .send(body);
    const retry = await ctx.agent
      .post(`/api/sales/${saleId}/payments`)
      .set(auth(ids.vendorToken))
      .send(body);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.deduplicated).toBe(true);
    expect(Number(retry.body.sale.amount_paid)).toBe(50);
    const bal = await ctx.pool.query<{ balance: number }>(
      "SELECT balance::float FROM customers WHERE id=$1",
      [c.id],
    );
    expect(bal.rows[0]!.balance).toBe(350);
  });

  it("garde-fous : overpay / vente annulée / montant nul", async () => {
    const c = await makeCustomer("Gardes Client");
    const sale = await sellWith({ customerId: c.id, payments: [] });
    const saleId = sale.body.sale.id;
    const over = await ctx.agent
      .post(`/api/sales/${saleId}/payments`)
      .set(auth(ids.vendorToken))
      .send({ method: "CASH", amount: 999 });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("OVERPAY_INVALID");
    const zero = await ctx.agent
      .post(`/api/sales/${saleId}/payments`)
      .set(auth(ids.vendorToken))
      .send({ method: "CASH", amount: 0 });
    expect(zero.status).toBe(400);

    const sale2 = await sellWith({ payments: [], customerId: c.id });
    // 2ᵉ crédit refusé ? non — solde 400, sans plafond → ok. Annulation puis encaissement refusé.
    const sid2 = sale2.body.sale.id;
    await ctx.agent
      .post(`/api/sales/${sid2}/void`)
      .set(auth(ids.adminToken))
      .send({});
    const voided = await ctx.agent
      .post(`/api/sales/${sid2}/payments`)
      .set(auth(ids.vendorToken))
      .send({ method: "CASH", amount: 10 });
    expect(voided.status).toBe(409);
    expect(voided.body.error.code).toBe("SALE_VOIDED_FOR_PAYMENT");
  });

  it("annulation d'une vente à crédit : le solde client est libéré", async () => {
    const c = await makeCustomer("Annulation Crédit");
    const sale = await sellWith({ customerId: c.id, payments: [] });
    const before = await ctx.pool.query<{ balance: number }>(
      "SELECT balance::float FROM customers WHERE id=$1",
      [c.id],
    );
    expect(before.rows[0]!.balance).toBe(400);
    await ctx.agent
      .post(`/api/sales/${sale.body.sale.id}/void`)
      .set(auth(ids.adminToken))
      .send({ reason: "Erreur caisse" });
    const after = await ctx.pool.query<{ balance: number }>(
      "SELECT balance::float FROM customers WHERE id=$1",
      [c.id],
    );
    expect(after.rows[0]!.balance).toBe(0);
  });
});

describe("E3 · Vieillissement des créances et relance", () => {
  it("aging 0-30/31-60/61-90/>90 calculé sur échéance (ou date de vente)", async () => {
    const c = await makeCustomer("Aging Client");
    // Dette récente (tranche 0-30)
    const s1 = await sellWith({ customerId: c.id, payments: [] });
    expect(s1.status).toBe(201);
    // Dette ancienne « 70 jours » injectée via due_date passée
    const s2 = await sellWith({ customerId: c.id, payments: [] });
    const d70 = new Date(Date.now() - 70 * 86400000).toISOString().slice(0, 10);
    await ctx.pool.query("UPDATE sales SET due_date=$2 WHERE id=$1", [
      s2.body.sale.id,
      d70,
    ]);
    const detail = await ctx.agent
      .get(`/api/customers/${c.id}`)
      .set(auth(ids.adminToken));
    expect(detail.body.aging.d0_30).toBe(400);
    expect(detail.body.aging.d61_90).toBe(400);
    expect(detail.body.debts).toHaveLength(2);
  });

  it("relance SMS : message montant, notification DEBT_REMINDER, 1/jour ; sans numéro → 400", async () => {
    const c = await makeCustomer("Relance Client");
    await sellWith({ customerId: c.id, payments: [] });
    const r1 = await ctx.agent
      .post(`/api/customers/${c.id}/remind`)
      .set(auth(ids.adminToken))
      .send({ channel: "SMS" });
    expect(r1.body.status).toBe("sent");
    expect(r1.body.message).toContain("400");

    const notif = await ctx.pool.query<{ type: string; status: string }>(
      "SELECT type, status FROM notifications WHERE tenant_id=$1 AND type='DEBT_REMINDER' ORDER BY created_at DESC",
      [ids.tenantId],
    );
    expect(notif.rows[0]).toEqual({ type: "DEBT_REMINDER", status: "SENT" });

    // Dedupe : la 2ᵉ relance le même jour est ignorée proprement
    const r2 = await ctx.agent
      .post(`/api/customers/${c.id}/remind`)
      .set(auth(ids.adminToken))
      .send({ channel: "SMS" });
    expect(r2.body.status).toBe("deduped");

    const noPhone = await makeCustomer("Sans Numéro", { phone: null });
    const r3 = await ctx.agent
      .post(`/api/customers/${noPhone.id}/remind`)
      .set(auth(ids.adminToken))
      .send({ channel: "SMS" });
    expect(r3.status).toBe(400);
    expect(r3.body.error.code).toBe("REMIND_NO_PHONE");
  });

  it("liste des débiteurs (withDebt) + isolation multi-tenant", async () => {
    const c = await makeCustomer("Débiteur Isolation");
    await sellWith({ customerId: c.id, payments: [] });
    const debts = await ctx.agent
      .get("/api/customers?withDebt=true&size=100")
      .set(auth(ids.adminToken));
    expect(debts.body.data.some((x: { id: string }) => x.id === c.id)).toBe(
      true,
    );
    // Un autre tenant ne voit pas ce client
    const other = await ctx.agent.post("/api/auth/register").send({
      tenantName: "Autre SARL",
      userName: "Admin Autre",
      email: `autre-${crypto.randomUUID().slice(0, 8)}@test.cm`,
      password: "Passw0rd!",
    });
    const across = await ctx.agent
      .get(`/api/customers/${c.id}`)
      .set(auth(other.body.accessToken));
    expect(across.status).toBe(404);
  });
});
