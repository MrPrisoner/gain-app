/**
 * When a workout's `start` op actually enters the outbox.
 *
 * Opening the session runner used to write a `start` op on mount, before the user had
 * touched anything, so a session someone opened to *look* at became a `workout` row with
 * `status = 'partial'` — counted as an attempt by `suggestNextSession`'s rotation cursor
 * and as a Partial in the export's Adherence table, which is a wrong claim reaching the
 * reviewing AI. The runner now arms the start op instead, and the first write against
 * that workout drags it into the outbox ahead of itself. UI §2's "effort is the commit
 * action", one level up: effort commits the workout, not only the set.
 *
 * **Every op carrying a `workoutClientId` commits, with no exceptions** — a `finish`
 * included. This is not a judgement about which ops count as real effort: an op that
 * reached the server with no workout behind it would resolve nothing, throw
 * `NotYetError`, and be retried forever with no start op left in the outbox to rescue
 * it. That is the one thing ARCHITECTURE §4 says an op must never be.
 *
 * The op's ULID ordering is the caller's job, not this module's: the start op is minted
 * whole when the runner mounts, so every op created afterwards is automatically higher
 * (ULIDs are monotonic) and `planBatch` sorts the start first however the two were
 * appended. Minting it at commit time instead would sort it *after* the set that
 * triggered it and cost a wasted round trip on every session.
 *
 * Pure, and separate from `client.svelte.ts`, because that module uses `$state` and
 * `vitest.config.ts` runs without the Svelte plugin — a rule expressed there is untested
 * by construction. Same split as `queue.ts` and `idb.ts`.
 */

import type { StartOp, SyncOp } from "./ops";

/** What to append for one write, and whether it consumed the armed start. */
export type ResolvedWrite = {
  /** In append order. The armed start first, where the write commits it. */
  ops: SyncOp[];
  /** True when the caller must now clear the armed start. */
  consumed: boolean;
};

/**
 * Resolve one write against whatever start op is currently armed.
 *
 * An op with no `workoutClientId` at all — an `activity`, logged from Home — can never
 * commit a workout. Reading a missing property as a match would start a workout nobody
 * opened, which is the exact failure this module exists to prevent, arrived at from the
 * other side.
 */
export function resolveWrite(deferred: StartOp | undefined, op: SyncOp): ResolvedWrite {
  if (deferred === undefined) return { ops: [op], consumed: false };
  if (!("workoutClientId" in op)) return { ops: [op], consumed: false };
  if (op.workoutClientId !== deferred.workoutClientId) return { ops: [op], consumed: false };
  return { ops: [deferred, op], consumed: true };
}
