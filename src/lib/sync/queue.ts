/**
 * The outbox queue's rules, as pure functions over plain data (design spec §3, §6).
 *
 * Nothing here touches IndexedDB. The storage adapter is an interface (`OutboxStore`,
 * implemented by `$lib/sync/idb`) so the two decisions worth getting right — which ops
 * go in a batch, and what an ack means — are unit-testable without a browser.
 *
 * The ordering rule is load-bearing rather than cosmetic. Ops are ULIDs, so sorting by
 * `id` is chronological, and `logMetric` is documented as relying on it: two corrections
 * to the same metric delivered out of order would land on the earlier answer.
 */

import type { SyncOp } from "./ops";

/** An op as the outbox holds it: the op, plus whether it is still deliverable. */
export type OutboxRecord = {
  op: SyncOp;
  state: "pending" | "quarantined";
  /** Why it was quarantined. Shown to the user; never a reason to delete the record. */
  error?: string;
};

/** What the flush loop needs of a store. `$lib/sync/idb` implements it for real. */
export interface OutboxStore {
  append(op: SyncOp): Promise<void>;
  pending(): Promise<SyncOp[]>;
  ack(ids: readonly string[]): Promise<void>;
  quarantine(entries: readonly { id: string; error: string }[]): Promise<void>;
  forWorkout(workoutClientId: string): Promise<OutboxRecord[]>;
  counts(): Promise<{ pending: number; quarantined: number }>;
  /**
   * Drop every record, pending and quarantined. Called only on a generation mismatch —
   * the server has said this outbox describes data that no longer exists (spec §7).
   */
  clearAll(): Promise<void>;
  /** Drop only the quarantined records, at the user's explicit request. */
  clearQuarantined(): Promise<void>;
}

/** What the server says came of a batch. */
export type AckResponse = {
  applied: string[];
  failed: { id: string; error: string }[];
  /** Ops the server saw but could not yet apply — e.g. a set whose start op hasn't
   * arrived. Not a failure: the client should keep these queued and retry. Optional so
   * existing constructions of this type don't need updating; `replayOps` always
   * populates it. */
  pending?: string[];
};

/** What the sync banner renders from. */
export type SyncStatus = {
  pending: number;
  quarantined: number;
  state: "idle" | "syncing" | "offline" | "needs-auth" | "error";
  /** Set once, on a generation mismatch (spec §7). The outbox has already been cleared
   * by the time this is true; it exists purely so the banner can say why. */
  resetNotice: boolean;
};

/** The default batch size. Large enough that a whole session leaves in one request. */
export const BATCH_LIMIT = 100;

/**
 * The next ops to send, oldest first. Sorting here rather than trusting the store means
 * the ordering guarantee holds whatever an IndexedDB cursor happens to return.
 */
export function planBatch(pending: readonly SyncOp[], limit: number = BATCH_LIMIT): SyncOp[] {
  return [...pending].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, limit);
}

/**
 * Resolve a server ack against the batch that produced it.
 *
 * Two rules, both about not losing data. An op the server said *nothing* about stays
 * pending — silence is not success, and a truncated or partial response must cost a
 * retry rather than a workout. And an id that was not in the batch is ignored entirely,
 * so a confused or replayed response can never ack an op that has not been sent.
 */
export function applyAck(
  batch: readonly SyncOp[],
  ack: AckResponse,
): { ackIds: string[]; quarantine: { id: string; error: string }[] } {
  const sent = new Set(batch.map((op) => op.id));
  return {
    ackIds: ack.applied.filter((id) => sent.has(id)),
    quarantine: ack.failed.filter((entry) => sent.has(entry.id)),
  };
}
