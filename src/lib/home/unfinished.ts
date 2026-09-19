/**
 * What Home knows about unfinished sessions, from the two sources that each know half.
 *
 * The server (`openWorkoutsForPlan`, `$lib/db/home.ts`) is the source of truth and the
 * only one that knows a set count, but it cannot see a session logged offline whose ops
 * have not synced. The device's `localStorage` resume pointers cover exactly that gap —
 * and only that gap, since a pointer is written the moment a workout's first op commits.
 *
 * Pure, and `now` is injected, so the same inputs give the same answer during SSR and
 * after hydration.
 */

import type { OpenWorkoutRef } from "../db/home";
import { isResumable, workoutStartedAtMs } from "../session/workout-age";

export type UnfinishedSession = {
  workoutClientId: string;
  planSlug: string;
  sessionKey: string;
  /** ISO timestamp. From the server's column where it has one, else decoded from the
   * client id's ULID — the same instant either way, since the runner mints that id at
   * mount and the `start` op carries it as `startedAt`. */
  startedAt: string;
  /** `undefined` for a workout only the local pointer knows about: the count lives in
   * the database, and this one has not reached it. The card renders no count rather
   * than a wrong "0 sets" for a session with three in the queue. */
  setCount: number | undefined;
  resumable: boolean;
};

export type MergeInput = {
  server: readonly (OpenWorkoutRef & { planSlug: string })[];
  local: readonly { planSlug: string; sessionKey: string; workoutClientId: string }[];
  /** Workouts with a discard op still queued (`pendingDiscardIds`). */
  pendingDiscards: readonly string[];
  now: Date;
};

export function mergeUnfinished({
  server,
  local,
  pendingDiscards,
  now,
}: MergeInput): UnfinishedSession[] {
  const discarded = new Set(pendingDiscards);
  const byId = new Map<string, UnfinishedSession>();

  for (const row of server) {
    if (discarded.has(row.workoutClientId)) continue;
    byId.set(row.workoutClientId, {
      workoutClientId: row.workoutClientId,
      planSlug: row.planSlug,
      sessionKey: row.sessionKey,
      startedAt: row.startedAt,
      setCount: row.setCount,
      resumable: isResumable(row.workoutClientId, now),
    });
  }

  for (const pointer of local) {
    if (discarded.has(pointer.workoutClientId)) continue;
    // The server's record wins: it is the same workout, and only it knows the set count.
    if (byId.has(pointer.workoutClientId)) continue;
    const startedAtMs = workoutStartedAtMs(pointer.workoutClientId);
    // An id whose age cannot be read supports no honest claim — not a start time, not a
    // resumability verdict. Better to say nothing than to render a guess.
    if (startedAtMs === undefined) continue;
    byId.set(pointer.workoutClientId, {
      workoutClientId: pointer.workoutClientId,
      planSlug: pointer.planSlug,
      sessionKey: pointer.sessionKey,
      startedAt: new Date(startedAtMs).toISOString(),
      setCount: undefined,
      resumable: isResumable(pointer.workoutClientId, now),
    });
  }

  return [...byId.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
