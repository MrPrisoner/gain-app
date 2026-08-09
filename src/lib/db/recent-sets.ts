/**
 * Read-side query for pre-fill (UI-DECISIONS §2): the most recent logged sets for one
 * exercise, most-recent-first, so `pickPrefill` (`../session/prefill.ts`) can find the
 * last performance to pre-fill the next one. A thin DB read, covered at the route level
 * (Task 5) rather than by its own unit test — `pickPrefill` carries the logic and is
 * tested directly against plain rows.
 */

import type { UserDb } from "./user-db";
import type { RecentSetRow } from "../session/prefill";

export function recentSetLogsForExercise(
  userDb: UserDb,
  exerciseDefId: string,
  limit = 20,
): RecentSetRow[] {
  return userDb.db
    .prepare(
      `SELECT w.started_at AS startedAt, s.set_no AS setNo, s.side AS side,
              s.reps AS reps, s.weight_kg AS weightKg, s.duration_s AS durationS,
              s.difficulty AS difficulty
       FROM set_log s
       JOIN workout w ON w.id = s.workout_id
       WHERE s.exercise_def_id = ?
       ORDER BY w.started_at DESC, s.set_no DESC
       LIMIT ?`,
    )
    .all(exerciseDefId, limit) as RecentSetRow[];
}
