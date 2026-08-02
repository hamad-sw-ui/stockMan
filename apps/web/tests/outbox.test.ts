/** File hors-ligne : idempotence par clientSaleId, FIFO, transitions de
 *  statut et rejeu — la base du mode « vente sans réseau ». */
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearOutboxForTests,
  countQueued,
  enqueueSale,
  listOutbox,
  markFailed,
  markSyncing,
  removeEntry,
  retryEntry,
} from "../src/lib/offline/outbox";

const entry = (id: string, total = 1000) => ({
  clientSaleId: id,
  payload: { items: [], paymentMethod: "CASH", clientSaleId: id },
  label: `Ticket ${id}`,
  total,
});

beforeEach(async () => {
  await clearOutboxForTests();
});

describe("enqueueSale", () => {
  it("enfile une vente QUEUED avec horodatage", async () => {
    const e = await enqueueSale(entry("a"));
    expect(e.status).toBe("QUEUED");
    expect(e.attempts).toBe(0);
    expect(e.createdAt).toBeGreaterThan(0);
    expect(await countQueued()).toBe(1);
  });
  it("est idempotente : un même clientSaleId n’est jamais dupliqué", async () => {
    await enqueueSale(entry("a"));
    const again = await enqueueSale(entry("a", 9999)); // même id, autre total
    expect(again.total).toBe(1000); // première version conservée
    expect((await listOutbox()).length).toBe(1);
  });
});

describe("listOutbox (FIFO)", () => {
  it("tri createdAt croissant", async () => {
    await enqueueSale({ ...entry("b"), createdAt: 200 });
    await enqueueSale({ ...entry("a"), createdAt: 100 });
    const q = await listOutbox();
    expect(q.map((e) => e.clientSaleId)).toEqual(["a", "b"]);
  });
});

describe("transitions de statut", () => {
  it("markSyncing incrémente attempts et exclut du compteur", async () => {
    await enqueueSale(entry("a"));
    await markSyncing("a");
    const q = await listOutbox();
    expect(q[0]!.status).toBe("SYNCING");
    expect(q[0]!.attempts).toBe(1);
    expect(await countQueued()).toBe(0);
  });
  it("markFailed conserve l’erreur ; retryEntry remet en file", async () => {
    await enqueueSale(entry("a"));
    await markFailed("a", `${"x".repeat(400)}`);
    let q = await listOutbox();
    expect(q[0]!.status).toBe("FAILED");
    expect(q[0]!.lastError!.length).toBeLessThanOrEqual(300);
    await retryEntry("a");
    q = await listOutbox();
    expect(q[0]!.status).toBe("QUEUED");
    expect(q[0]!.lastError).toBeUndefined();
  });
  it("retryEntry est sans effet hors FAILED", async () => {
    await enqueueSale(entry("a"));
    await markSyncing("a");
    await retryEntry("a");
    expect((await listOutbox())[0]!.status).toBe("SYNCING");
  });
  it("removeEntry sort définitivement de la file", async () => {
    await enqueueSale(entry("a"));
    await removeEntry("a");
    expect(await listOutbox()).toEqual([]);
  });
  it("opérations sur id inconnu : silencieuses", async () => {
    await markSyncing("inconnu");
    await markFailed("inconnu", "err");
    await retryEntry("inconnu");
    await removeEntry("inconnu");
    expect(await listOutbox()).toEqual([]);
  });
});
