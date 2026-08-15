import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  SeedIds,
  seedTenant,
  TestContext,
} from "./helpers/app";

/**
 * E2 — Traçabilité lot bout-en-bout (docs/05_AUDIT_EXPERT_STOCK.md §B.2) :
 *  FEFO avec coût par lot, ventilation multi-lots des ventes, blocage de la
 *  vente de lots périmés, lot obligatoire (track_batch), recrédit exact à
 *  l'annulation/au retour, transfert préservant le lot, rapport de rappel.
 */

let ctx: TestContext;
let ids: SeedIds;
let depotB: string;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const exp = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await createTestContext();
  ids = await seedTenant(ctx);
  const b = await ctx.agent
    .post("/api/depots")
    .set(auth(ids.adminToken))
    .send({ name: "Dépôt Lots B" });
  depotB = b.body.id;
});
afterAll(async () => {
  await destroyTestContext(ctx);
});

async function makeProduct(name: string, trackBatch = false) {
  const res = await ctx.agent
    .post("/api/products")
    .set(auth(ids.adminToken))
    .send({
      name,
      barcode: `64${Date.now()}${Math.floor(Math.random() * 1000)}`,
      purchasePrice: 100,
      sellingPrice: 400,
      unitId: ids.unitId,
      trackBatch,
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function receive(
  productId: string,
  quantity: number,
  opts: {
    unitCost?: number;
    batchNumber?: string;
    expiryDate?: string | null;
    depotId?: string;
  } = {},
) {
  return ctx.agent
    .post("/api/stock/receipts")
    .set(auth(ids.adminToken))
    .send({
      depotId: opts.depotId ?? ids.depotId,
      items: [
        {
          productId,
          quantity,
          unitCost: opts.unitCost ?? 100,
          batchNumber: opts.batchNumber,
          expiryDate: opts.expiryDate ?? null,
        },
      ],
    });
}

const batchQty = async (batchNumber: string, depotId?: string) => {
  const r = await ctx.pool.query<{ quantity: number }>(
    `SELECT quantity::float FROM stock_batches WHERE batch_number=$1 ${depotId ? "AND depot_id=$2" : ""} ORDER BY created_at`,
    depotId ? [batchNumber, depotId] : [batchNumber],
  );
  return r.rows.reduce((a, b) => a + b.quantity, 0);
};

describe("E2 · FEFO et ventilation par lot", () => {
  it("FEFO : le lot le plus proche de l'expiration part en premier, lignes ventilées avec lot et coût", async () => {
    const p = await makeProduct("FEFO Produit 1");
    // L1 expire dans 30 j (coût 100), L2 expire dans 10 j (coût 80)
    await receive(p, 5, { batchNumber: "E2-L1", expiryDate: exp(30) });
    await receive(p, 5, {
      batchNumber: "E2-L2",
      expiryDate: exp(10),
      unitCost: 80,
    });

    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({ items: [{ productId: p, quantity: 7 }], paymentMethod: "CASH" });
    expect(sale.status).toBe(201);
    const items = sale.body.sale.items;
    // 2 lignes : L2 (5 @ coût 80, FEFO) puis L1 (2 @ coût 100)
    expect(items).toHaveLength(2);
    const l2 = items.find(
      (i: { batch_number: string }) => i.batch_number === "E2-L2",
    );
    const l1 = items.find(
      (i: { batch_number: string }) => i.batch_number === "E2-L1",
    );
    expect(Number(l2.base_qty)).toBe(5);
    expect(Number(l2.unit_cost)).toBe(80);
    expect(Number(l1.base_qty)).toBe(2);
    expect(Number(l1.unit_cost)).toBe(100);
    // Total exact garanti par absorbage d'arrondi sur la dernière ligne
    const sum = items.reduce(
      (a: number, i: { total_price: number }) => a + Number(i.total_price),
      0,
    );
    expect(sale.body.sale.total_amount).toBe(2800); // 7 × 400
    expect(Math.round(sum * 100) / 100).toBe(2800);
    // Les mouvements SALE portent le lot + coût
    const moves = await ctx.agent
      .get(`/api/stock/movements?productId=${p}&type=SALE`)
      .set(auth(ids.adminToken));
    expect(moves.body.data).toHaveLength(2);
    expect(
      moves.body.data.every((m: { batch_id: string | null }) => m.batch_id),
    ).toBe(true);
    // Lots décrémentés : L2 épuisé, L1 à 3
    expect(await batchQty("E2-L2")).toBe(0);
    expect(await batchQty("E2-L1")).toBe(3);
  });

  it("blocage métier : un produit dont tous les lots sont périmés ne peut pas être vendu", async () => {
    const p = await makeProduct("FEFO Produit 2");
    await receive(p, 5, { batchNumber: "E2-OLD", expiryDate: "2020-01-01" });
    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({ items: [{ productId: p, quantity: 1 }], paymentMethod: "CASH" });
    expect(sale.status).toBe(409);
    expect(sale.body.error.code).toBe("STOCK_BATCHES_EXPIRED");
    // Le stock n'a pas bougé
    const lvl = await ctx.pool.query<{ q: number }>(
      "SELECT quantity::float AS q FROM stock_levels WHERE product_id=$1 AND depot_id=$2",
      [p, ids.depotId],
    );
    expect(lvl.rows[0]!.q).toBe(5);
  });

  it("un lot valide cohabitant avec un périmé : seul le lot valide alimente la vente", async () => {
    const p = await makeProduct("FEFO Produit 3");
    await receive(p, 5, {
      batchNumber: "E2-EXPIRED",
      expiryDate: "2020-06-01",
    });
    await receive(p, 3, { batchNumber: "E2-GOOD", expiryDate: exp(90) });
    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({ items: [{ productId: p, quantity: 2 }], paymentMethod: "CASH" });
    expect(sale.status).toBe(201);
    expect(sale.body.sale.items[0].batch_number).toBe("E2-GOOD");
    expect(await batchQty("E2-EXPIRED")).toBe(5); // intact
    // Vendre plus que le lot valide reste refusé proprement
    const tooMuch = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({ items: [{ productId: p, quantity: 50 }], paymentMethod: "CASH" });
    expect(tooMuch.status).toBe(409);
  });
});

describe("E2 · Gestion par lot obligatoire (track_batch)", () => {
  it("réception sans numéro de lot refusée pour un produit tracé", async () => {
    const p = await makeProduct("Tracé Produit 1", true);
    const noBatch = await receive(p, 5);
    expect(noBatch.status).toBe(400);
    expect(noBatch.body.error.code).toBe("BATCH_REQUIRED");
    const withBatch = await receive(p, 5, { batchNumber: "E2-TRK-1" });
    expect(withBatch.status).toBe(201);
  });
});

describe("E2 · Recrédit exact à l'annulation et au retour", () => {
  it("annulation : le lot d'origine est recrédité intégralement", async () => {
    const p = await makeProduct("Recrédit Produit 1");
    await receive(p, 6, { batchNumber: "E2-RET-1", expiryDate: exp(60) });
    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({ items: [{ productId: p, quantity: 4 }], paymentMethod: "CASH" });
    expect(await batchQty("E2-RET-1")).toBe(2);
    await ctx.agent
      .post(`/api/sales/${sale.body.sale.id}/void`)
      .set(auth(ids.adminToken))
      .send({});
    expect(await batchQty("E2-RET-1")).toBe(6); // lot restauré
  });

  it("retour partiel : recrédite le lot d'origine de la quantité retournée", async () => {
    const p = await makeProduct("Recrédit Produit 2");
    await receive(p, 6, { batchNumber: "E2-RET-2", expiryDate: exp(60) });
    const sale = await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({ items: [{ productId: p, quantity: 5 }], paymentMethod: "CASH" });
    expect(await batchQty("E2-RET-2")).toBe(1);
    const ret = await ctx.agent
      .post(`/api/sales/${sale.body.sale.id}/returns`)
      .set(auth(ids.adminToken))
      .send({
        items: [{ saleItemId: sale.body.sale.items[0].id, baseQty: 2 }],
      });
    expect(ret.status).toBe(201);
    expect(await batchQty("E2-RET-2")).toBe(3);
  });
});

describe("E2 · Transferts préservant les lots", () => {
  it("le lot part avec le transfert et arrive à l'identique (numéro, expiration, coût)", async () => {
    const p = await makeProduct("Transfert Lot Produit");
    await receive(p, 8, {
      batchNumber: "E2-MOVE",
      expiryDate: exp(45),
      unitCost: 120,
    });
    const tr = await ctx.agent
      .post("/api/stock/transfers")
      .set(auth(ids.adminToken))
      .send({
        fromDepotId: ids.depotId,
        toDepotId: depotB,
        items: [{ productId: p, quantity: 5 }],
      });
    expect(tr.status).toBe(201);
    // Dès l'émission, le lot source est débité (cohérence lots/niveaux)
    expect(await batchQty("E2-MOVE", ids.depotId)).toBe(3);

    await ctx.agent
      .post(`/api/stock/transfers/${tr.body.transferId}/receive`)
      .set(auth(ids.adminToken));
    // …et il arrive au dépôt B avec le MÊME numéro (unicité étendue au dépôt)
    const dest = await ctx.pool.query<{
      quantity: number;
      expiry_date: string | Date;
      unit_cost: number;
    }>(
      "SELECT quantity::float, expiry_date, unit_cost::float FROM stock_batches WHERE batch_number='E2-MOVE' AND depot_id=$1",
      [depotB],
    );
    expect(dest.rows).toHaveLength(1);
    expect(dest.rows[0]!.quantity).toBe(5);
    const expStr =
      dest.rows[0]!.expiry_date instanceof Date
        ? dest.rows[0]!.expiry_date.toISOString().slice(0, 10)
        : String(dest.rows[0]!.expiry_date).slice(0, 10);
    expect(expStr).toBe(exp(45));
    expect(dest.rows[0]!.unit_cost).toBe(120);
    // Les niveaux suivent
    const lvlB = await ctx.pool.query<{ q: number }>(
      "SELECT quantity::float AS q FROM stock_levels WHERE product_id=$1 AND depot_id=$2",
      [p, depotB],
    );
    expect(lvlB.rows[0]!.q).toBe(5);
  });

  it("annulation d'un transfert : le lot alloué est rendu à la source", async () => {
    const p = await makeProduct("Transfert Lot Produit 2");
    await receive(p, 6, { batchNumber: "E2-MOVE2", expiryDate: exp(30) });
    const tr = await ctx.agent
      .post("/api/stock/transfers")
      .set(auth(ids.adminToken))
      .send({
        fromDepotId: ids.depotId,
        toDepotId: depotB,
        items: [{ productId: p, quantity: 4 }],
      });
    expect(await batchQty("E2-MOVE2", ids.depotId)).toBe(2);
    await ctx.agent
      .post(`/api/stock/transfers/${tr.body.transferId}/cancel`)
      .set(auth(ids.adminToken));
    expect(await batchQty("E2-MOVE2", ids.depotId)).toBe(6);
    expect(await batchQty("E2-MOVE2", depotB)).toBe(0);
  });
});

describe("E2 · Rapport de traçabilité / rappel de lot", () => {
  it("origine fournisseur, ventes prélevées et reste — la réponse au rappel", async () => {
    const p = await makeProduct("Rappel Produit");
    const sup = await ctx.agent
      .post("/api/suppliers")
      .set(auth(ids.adminToken))
      .send({ name: "Fournisseur Rappel" });
    await ctx.agent
      .post("/api/stock/receipts")
      .set(auth(ids.adminToken))
      .send({
        depotId: ids.depotId,
        supplierId: sup.body.id,
        reference: "BL-RAPPEL",
        items: [
          {
            productId: p,
            quantity: 10,
            unitCost: 90,
            batchNumber: "E2-RECALL",
            expiryDate: exp(200),
          },
        ],
      });
    await ctx.agent
      .post("/api/sales")
      .set(auth(ids.vendorToken))
      .send({ items: [{ productId: p, quantity: 4 }], paymentMethod: "CASH" });

    const trace = await ctx.agent
      .get(`/api/reports/batch-trace?productId=${p}&batchNumber=E2-RECALL`)
      .set(auth(ids.adminToken));
    expect(trace.status).toBe(200);
    expect(trace.body.found).toBe(true);
    // Entrée : la réception du fournisseur
    expect(trace.body.inflows).toHaveLength(1);
    expect(trace.body.inflows[0].supplier).toBe("Fournisseur Rappel");
    expect(Number(trace.body.inflows[0].qty)).toBe(10);
    // Sortie : la vente du lot, avec vendeur et dépôt
    expect(trace.body.outflows).toHaveLength(1);
    expect(Number(trace.body.outflows[0].qty)).toBe(4);
    expect(trace.body.outflows[0].vendor).toBeTruthy();
    // Reste : 6 dans le dépôt
    const batch = trace.body.batches.find(
      (b: { depot_name: string | null }) => b.depot_name !== null,
    );
    expect(Number(batch.quantity)).toBe(6);
  });

  it("lot inconnu : found=false sans erreur", async () => {
    const p = await makeProduct("Rappel Produit 2");
    const trace = await ctx.agent
      .get(`/api/reports/batch-trace?productId=${p}&batchNumber=INCONNU`)
      .set(auth(ids.adminToken));
    expect(trace.body.found).toBe(false);
    expect(trace.body.outflows).toHaveLength(0);
  });
});
