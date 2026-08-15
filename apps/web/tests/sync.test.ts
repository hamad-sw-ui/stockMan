/** Rejeu de la file hors-ligne : succès → sortie ; erreur métier 4xx →
 *  FAILED ; coupure réseau → conservée QUEUED (FIFO arrêtée). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOutboxForTests,
  enqueueSale,
  listOutbox,
} from "../src/lib/offline/outbox";
import { syncOutbox } from "../src/lib/offline/sync";

const payloadOf = (id: string) => ({
  items: [],
  paymentMethod: "CASH",
  clientSaleId: id,
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  await clearOutboxForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("syncOutbox", () => {
  it("succès : la vente sort de la file", async () => {
    await enqueueSale({ clientSaleId: "ok-1", payload: payloadOf("ok-1") });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(201, { sale: { id: "srv-1" }, deduplicated: false }),
      ),
    );
    const r = await syncOutbox();
    expect(r).toMatchObject({ synced: 1, failed: 0, remaining: 0 });
    expect(await listOutbox()).toEqual([]);
  });

  it("dédoublonnage serveur (200 deduplicated) : traité comme succès", async () => {
    await enqueueSale({ clientSaleId: "dup-1", payload: payloadOf("dup-1") });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, { sale: { id: "srv-x" }, deduplicated: true }),
      ),
    );
    const r = await syncOutbox();
    expect(r.synced).toBe(1);
    expect(r.remaining).toBe(0);
  });

  it("erreur métier 4xx (ex. STOCK_INSUFFICIENT) : FAILED conservée", async () => {
    await enqueueSale({ clientSaleId: "ko-4xx", payload: payloadOf("ko-4xx") });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(409, {
          error: { code: "STOCK_INSUFFICIENT", message: "Stock insuffisant." },
        }),
      ),
    );
    const r = await syncOutbox();
    expect(r).toMatchObject({ synced: 0, failed: 1, remaining: 1 });
    const q = await listOutbox();
    expect(q[0]!.status).toBe("FAILED");
    expect(q[0]!.lastError).toContain("STOCK_INSUFFICIENT");
  });

  it("coupure réseau : entrée conservée, FIFO arrêtée", async () => {
    await enqueueSale({
      clientSaleId: "net-1",
      payload: payloadOf("net-1"),
      createdAt: 100,
    });
    await enqueueSale({
      clientSaleId: "net-2",
      payload: payloadOf("net-2"),
      createdAt: 200,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const r = await syncOutbox();
    expect(r.synced).toBe(0);
    expect(r.failed).toBe(0);
    const q = await listOutbox();
    // La 1ʳᵉ est repassée QUEUED (échec réseau), la 2ᵉ n’a pas été tentée (break)
    expect(q).toHaveLength(2);
    expect(q.map((e) => e.clientSaleId)).toEqual(["net-1", "net-2"]);
    expect(q[1]!.status).toBe("QUEUED");
  });

  it("5xx : conservée pour réessai ultérieur", async () => {
    await enqueueSale({
      clientSaleId: "srv-5xx",
      payload: payloadOf("srv-5xx"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(500, { error: { code: "INTERNAL", message: "boom" } }),
      ),
    );
    const r = await syncOutbox();
    expect(r.synced).toBe(0);
    expect((await listOutbox())[0]!.status).toBe("QUEUED");
  });

  it("single-flight : deux appels simultanés partagent la même exécution", async () => {
    await enqueueSale({ clientSaleId: "sf-1", payload: payloadOf("sf-1") });
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls.push("x");
        await new Promise((res) => setTimeout(res, 20));
        return jsonResponse(201, { sale: { id: "srv" }, deduplicated: false });
      }),
    );
    const [a, b] = await Promise.all([syncOutbox(), syncOutbox()]);
    expect(a.synced).toBe(1);
    expect(b.synced).toBe(1);
    expect(calls).toHaveLength(1); // une seule requête réseau pour les deux appels
  });
});
