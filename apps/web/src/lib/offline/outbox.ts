/** File d'attente hors-ligne des ventes (outbox).
 *  Persistance : IndexedDB en production, mémoire en secours (tests, vieux webviews).
 *  Invariants :
 *  - une vente = un `clientSaleId` (UUID généré au passage en caisse) : jamais de doublon ;
 *  - réémission FIFO (createdAt croissant) ;
 *  - les statuts : QUEUED → SYNCING → (supprimée) | FAILED (re-synchronisable).
 */

export interface OutboxEntry {
  clientSaleId: string;
  /** Corps POST /api/sales (items, paymentMethod, createdAt…). */
  payload: Record<string, unknown>;
  createdAt: number;
  status: "QUEUED" | "SYNCING" | "FAILED";
  attempts: number;
  lastError?: string;
  /** Libellé convivial pour l'UI (n° de ticket local, total). */
  label?: string;
  total?: number;
}

interface OutboxStore {
  put(entry: OutboxEntry): Promise<void>;
  get(id: string): Promise<OutboxEntry | undefined>;
  delete(id: string): Promise<void>;
  all(): Promise<OutboxEntry[]>;
}

/* ---------------------------------- Mémoire ---------------------------------- */
class MemoryStore implements OutboxStore {
  private map = new Map<string, OutboxEntry>();
  async put(e: OutboxEntry) {
    this.map.set(e.clientSaleId, structuredClone(e));
  }
  async get(id: string) {
    return this.map.get(id) ? structuredClone(this.map.get(id)!) : undefined;
  }
  async delete(id: string) {
    this.map.delete(id);
  }
  async all() {
    return [...this.map.values()].map((e) => structuredClone(e));
  }
}

/* --------------------------------- IndexedDB --------------------------------- */
const DB_NAME = "stockman-offline";
const STORE = "outbox";

class IdbStore implements OutboxStore {
  private dbp: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    this.dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, {
            keyPath: "clientSaleId",
          });
          store.createIndex("createdAt", "createdAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(req.error ?? new Error("IndexedDB indisponible"));
    });
    return this.dbp;
  }

  private async tx<T>(
    mode: IDBTransactionMode,
    run: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Erreur IndexedDB"));
    });
  }

  async put(e: OutboxEntry) {
    await this.tx("readwrite", (s) => s.put(e));
  }
  async get(id: string) {
    return (await this.tx("readonly", (s) => s.get(id))) as
      OutboxEntry | undefined;
  }
  async delete(id: string) {
    await this.tx("readwrite", (s) => s.delete(id));
  }
  async all() {
    const rows = (await this.tx("readonly", (s) =>
      s.getAll(),
    )) as OutboxEntry[];
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  }
}

/* ------------------------------ Sélection du store ---------------------------- */
let store: OutboxStore | null = null;
function getStore(): OutboxStore {
  if (!store) {
    store =
      typeof indexedDB !== "undefined" ? new IdbStore() : new MemoryStore();
  }
  return store;
}
/** Injection explicite (tests). */
export function _setStoreForTests(s: OutboxStore | null) {
  store = s;
}

/* --------------------------------- API publique -------------------------------- */

export function newClientSaleId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

/** Enfile une vente. Idempotent : un clientSaleId existant n'est pas ré-enfilé. */
export async function enqueueSale(
  entry: Omit<OutboxEntry, "status" | "attempts" | "createdAt"> & {
    createdAt?: number;
  },
): Promise<OutboxEntry> {
  const existing = await getStore().get(entry.clientSaleId);
  if (existing) return existing;
  const full: OutboxEntry = {
    ...entry,
    createdAt: entry.createdAt ?? Date.now(),
    status: "QUEUED",
    attempts: 0,
  };
  await getStore().put(full);
  return full;
}

/** File FIFO : les FAILED repassent après les QUEUED. */
export async function listOutbox(): Promise<OutboxEntry[]> {
  const all = await getStore().all();
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function countQueued(): Promise<number> {
  return (await getStore().all()).filter((e) => e.status !== "SYNCING").length;
}

export async function markSyncing(id: string): Promise<void> {
  const e = await getStore().get(id);
  if (e)
    await getStore().put({ ...e, status: "SYNCING", attempts: e.attempts + 1 });
}

export async function markFailed(id: string, message: string): Promise<void> {
  const e = await getStore().get(id);
  if (e)
    await getStore().put({
      ...e,
      status: "FAILED",
      lastError: message.slice(0, 300),
    });
}

/** Vente confirmée par le serveur : sortie de file définitive. */
export async function removeEntry(id: string): Promise<void> {
  await getStore().delete(id);
}

/** Remise en file d'une FAILED (action utilisateur « Réessayer »). */
export async function retryEntry(id: string): Promise<void> {
  const e = await getStore().get(id);
  if (e && e.status === "FAILED")
    await getStore().put({ ...e, status: "QUEUED", lastError: undefined });
}

export async function clearOutboxForTests(): Promise<void> {
  const all = await getStore().all();
  for (const e of all) await getStore().delete(e.clientSaleId);
}
