import type { OutboxRecord, OutboxStore } from "../../src/lib/sync/queue";
import type { SyncOp } from "../../src/lib/sync/ops";

/**
 * An `OutboxStore` over a Map, for testing the queue's contract without a browser.
 * `src/lib/sync/idb.ts` is the real implementation and is covered by the e2e suite —
 * this proves the interface's semantics, not IndexedDB's. Every method here is
 * genuinely synchronous — a `Map` needs no `await` — so none is declared `async`; each
 * returns `Promise.resolve(...)` instead, to satisfy `OutboxStore` without an
 * `async` method that never awaits anything.
 */
export function memoryOutbox(): OutboxStore {
  const records = new Map<string, OutboxRecord>();

  return {
    append(op: SyncOp) {
      records.set(op.id, { op, state: "pending" });
      return Promise.resolve();
    },
    pending() {
      return Promise.resolve(
        [...records.values()].filter((r) => r.state === "pending").map((r) => r.op),
      );
    },
    ack(ids) {
      for (const id of ids) records.delete(id);
      return Promise.resolve();
    },
    quarantine(entries) {
      for (const { id, error } of entries) {
        const record = records.get(id);
        if (record) records.set(id, { ...record, state: "quarantined", error });
      }
      return Promise.resolve();
    },
    forWorkout(workoutClientId) {
      return Promise.resolve(
        [...records.values()].filter(
          (r) => (r.op as { workoutClientId?: string }).workoutClientId === workoutClientId,
        ),
      );
    },
    counts() {
      const all = [...records.values()];
      return Promise.resolve({
        pending: all.filter((r) => r.state === "pending").length,
        quarantined: all.filter((r) => r.state === "quarantined").length,
      });
    },
    clearAll() {
      records.clear();
      return Promise.resolve();
    },
    clearQuarantined() {
      for (const [id, record] of records) {
        if (record.state === "quarantined") records.delete(id);
      }
      return Promise.resolve();
    },
  };
}
