/**
 * The outbox, on IndexedDB. The `OutboxStore` implementation the flush
 * loop actually runs against; `$lib/sync/queue` holds the rules it obeys.
 *
 * This is the store that makes a browser kill survivable. The workout's client id sits
 * in `localStorage` beside it (`$lib/session/workout-storage.ts`) rather than in
 * `sessionStorage`, which dies with the tab.
 *
 * **Ops leave this store two ways, and only two.** The server acknowledged them, or the
 * server declared the generation they belong to void — a reset wiped the account, and
 * the data they describe no longer exists to be reconciled against. A
 * quarantined op is neither: it is updated in place and kept, so the user can be told
 * about it, and it leaves only when the user discards it themselves.
 */

import type { OutboxRecord, OutboxStore } from "./queue";
import type { SyncOp } from "./ops";

const DB_NAME = "gain-sync";
const DB_VERSION = 1;
const STORE = "outbox";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "op.id" });
        store.createIndex("workoutClientId", "op.workoutClientId", { unique: false });
        store.createIndex("state", "state", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB.open failed"));
  });
}

/** Wraps a single IDBRequest as a Promise. Deliberately takes no `IDBObjectStore` — the
 * caller holds that itself so it can issue further requests against the same
 * transaction; a request and the store that produced it are not the same thing. */
function run<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function openOutbox(): Promise<OutboxStore> {
  const db = await open();

  return {
    async append(op: SyncOp): Promise<void> {
      const record: OutboxRecord = { op, state: "pending" };
      // One transaction: hold the store, issue the request against it, await that same
      // request. Calling `tx()` a second time here would open an unrelated transaction
      // whose request is never the one actually awaited.
      const store = tx(db, "readwrite");
      await run(store.put(record));
    },

    async pending(): Promise<SyncOp[]> {
      const store = tx(db, "readonly");
      const all = await run(store.getAll() as IDBRequest<OutboxRecord[]>);
      return all.filter((record) => record.state === "pending").map((record) => record.op);
    },

    async ack(ids: readonly string[]): Promise<void> {
      const store = tx(db, "readwrite");
      // Every `delete` is issued synchronously here, before any `await` — so all of them
      // land on this one transaction regardless of how long the whole `Promise.all` takes
      // to settle.
      await Promise.all(ids.map((id) => run(store.delete(id))));
    },

    async quarantine(entries: readonly { id: string; error: string }[]): Promise<void> {
      const store = tx(db, "readwrite");
      for (const entry of entries) {
        const existing = await run(store.get(entry.id) as IDBRequest<OutboxRecord | undefined>);
        if (!existing) continue;
        await run(
          store.put({
            ...existing,
            state: "quarantined",
            error: entry.error,
          }),
        );
      }
    },

    async forWorkout(workoutClientId: string): Promise<OutboxRecord[]> {
      const store = tx(db, "readonly");
      const index = store.index("workoutClientId");
      return run(index.getAll(workoutClientId) as IDBRequest<OutboxRecord[]>);
    },

    async counts(): Promise<{ pending: number; quarantined: number }> {
      const store = tx(db, "readonly");
      const all = await run(store.getAll() as IDBRequest<OutboxRecord[]>);
      return {
        pending: all.filter((record) => record.state === "pending").length,
        quarantined: all.filter((record) => record.state === "quarantined").length,
      };
    },

    async clearAll(): Promise<void> {
      const store = tx(db, "readwrite");
      await run(store.clear());
    },

    async clearQuarantined(): Promise<void> {
      const store = tx(db, "readwrite");
      const index = store.index("state");
      await new Promise<void>((resolve, reject) => {
        const request = index.openCursor(IDBKeyRange.only("quarantined"));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          cursor.delete();
          cursor.continue();
        };
        request.onerror = () => reject(request.error ?? new Error("IndexedDB cursor failed"));
      });
    },
  };
}
