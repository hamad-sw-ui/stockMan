/** Cache du bootstrap de caisse (IndexedDB « kv ») — la caisse démarre hors-ligne
 *  avec le dernier catalogue synchronisé et le signale visuellement. */

export interface CachedBootstrap {
  savedAt: number;
  data: unknown;
}

const KEY_PREFIX = "bootstrap:";
const DB_NAME = "stockman-offline";
const STORE = "kv";

interface KvStore {
  get(k: string): Promise<CachedBootstrap | undefined>;
  set(k: string, v: CachedBootstrap): Promise<void>;
}

class MemoryKv implements KvStore {
  private map = new Map<string, CachedBootstrap>();
  async get(k: string) {
    return this.map.get(k);
  }
  async set(k: string, v: CachedBootstrap) {
    this.map.set(k, v);
  }
}

class IdbKv implements KvStore {
  private dbp: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    this.dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("outbox")) {
          db.createObjectStore("outbox", {
            keyPath: "clientSaleId",
          }).createIndex("createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
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

  async get(k: string) {
    return (await this.tx("readonly", (s) => s.get(k))) as
      CachedBootstrap | undefined;
  }
  async set(k: string, v: CachedBootstrap) {
    await this.tx("readwrite", (s) => s.put(v, k));
  }
}

let store: KvStore | null = null;
function getStore(): KvStore {
  if (!store)
    store = typeof indexedDB !== "undefined" ? new IdbKv() : new MemoryKv();
  return store;
}

export async function saveBootstrap(
  depotId: string,
  data: unknown,
): Promise<void> {
  await getStore().set(`${KEY_PREFIX}${depotId}`, {
    savedAt: Date.now(),
    data,
  });
}

export async function loadBootstrap<T = unknown>(
  depotId: string,
): Promise<(CachedBootstrap & { data: T }) | undefined> {
  return (await getStore().get(`${KEY_PREFIX}${depotId}`)) as
    (CachedBootstrap & { data: T }) | undefined;
}

/** Fraîcheur lisible : « il y a 12 min ». */
export function cacheAge(savedAt: number): string {
  const min = Math.round((Date.now() - savedAt) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  return `il y a ${Math.round(min / 60)} h`;
}
