/**
 * Read-side query for resuming a workout (ARCHITECTURE §9, "Resuming"): everything one
 * in-progress workout has already written, so the runner can rebuild its client state
 * after a reload instead of starting from an empty ledger.
 *
 * Read-only, and scoped to the one workout id the caller resolved through
 * `getUserDbFor(locals.user.id)` — physical isolation means there is no cross-user row to
 * leak here in the first place (ARCHITECTURE decision 4).
 *
 * Every row carries its `id`, which is a ULID, so the pure reconstruction layer
 * (`$lib/session/resume`) can order by insertion without a timestamp column. Slugs come
 * from a join on `exercise_def`: `set_log` and `deviation` store `exercise_def_id`, and
 * every client-side identity in the runner is keyed by slug.
 */

import type { UserDb } from "./user-db";
import type {
  WorkoutDeviationRow,
  WorkoutHistory,
  WorkoutMetricRow,
  WorkoutSetRow,
} from "../session/resume";

export function workoutHistoryFor(userDb: UserDb, workoutId: string): WorkoutHistory {
  return {
    sets: setLogsFor(userDb, workoutId),
    deviations: deviationsFor(userDb, workoutId),
    metrics: metricValuesFor(userDb, workoutId),
  };
}

function setLogsFor(userDb: UserDb, workoutId: string): WorkoutSetRow[] {
  return userDb.db
    .prepare(
      `SELECT s.id AS id, e.slug AS exerciseSlug, s.set_no AS setNo, s.side AS side,
              s.reps AS reps, s.weight_kg AS weightKg, s.duration_s AS durationS,
              s.difficulty AS difficulty
       FROM set_log s
       JOIN exercise_def e ON e.id = s.exercise_def_id
       WHERE s.workout_id = ?
       ORDER BY s.id`,
    )
    .all(workoutId) as WorkoutSetRow[];
}

function deviationsFor(userDb: UserDb, workoutId: string): WorkoutDeviationRow[] {
  return userDb.db
    .prepare(
      `SELECT d.id AS id, e.slug AS exerciseSlug, d.kind AS kind,
              d.substitute_exercise_slug AS substituteSlug
       FROM deviation d
       JOIN exercise_def e ON e.id = d.exercise_def_id
       WHERE d.workout_id = ?
       ORDER BY d.id`,
    )
    .all(workoutId) as WorkoutDeviationRow[];
}

/**
 * Only the rows that hang off the workout itself — `scope: 'set'` values reference a
 * `set_log` row and leave `workout_id` null, so they are out of reach of this query by
 * construction. The wrap-up sheet wants `scope: 'session'`; the filtering happens in the
 * pure layer, which is where the decision is tested.
 */
function metricValuesFor(userDb: UserDb, workoutId: string): WorkoutMetricRow[] {
  return userDb.db
    .prepare(
      `SELECT id, scope, metric_key AS metricKey, value_num AS valueNum,
              value_text AS valueText
       FROM metric_value
       WHERE workout_id = ?
       ORDER BY id`,
    )
    .all(workoutId) as WorkoutMetricRow[];
}
