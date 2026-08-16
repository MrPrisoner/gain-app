/**
 * The one thing `logsForPlan` doesn't carry: which plan version a workout ran under.
 * `Logs.Workout` (the phase-1 export-shaped type) deliberately has no version number —
 * export replays `source_md` verbatim rather than needing one — so History's "Plan v2,
 * imported 2026-07-01" label is a separate, narrow read rather than a widened phase-1
 * type threaded through every existing consumer.
 */

import type { UserDb } from "./user-db";

type Row = { workout_id: string; version_no: number; imported_at: string };

export function versionsByWorkout(
  userDb: UserDb,
  planId: string,
): Map<string, { versionNo: number; importedAt: string }> {
  const rows = userDb.db
    .prepare(
      `SELECT w.id AS workout_id, pv.version_no AS version_no, pv.imported_at AS imported_at
       FROM workout w
       JOIN plan_version pv ON pv.id = w.plan_version_id
       WHERE pv.plan_id = ?`,
    )
    .all(planId) as Row[];

  return new Map(
    rows.map((r) => [r.workout_id, { versionNo: r.version_no, importedAt: r.imported_at }]),
  );
}
