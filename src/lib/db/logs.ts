/**
 * The read path from `gain.db` to the plain-data `Logs` shape (`src/lib/logs/types.ts`)
 * that the export generator consumes — phase 5's missing half. `generateExport` has been
 * finished since phase 1; the database has the rows; this module is the join between them.
 *
 * Three properties this has to hold, each of which fails silently rather than loudly:
 *
 * 1. **Unwindowed.** `generateExport` calls `filterLogsToWindow` itself, but `weeksElapsed`
 *    deliberately reads the *unfiltered* set to compute `{{weeks_elapsed}}`. Handing this
 *    module's caller a pre-filtered `Logs` makes that token quietly read 0.
 * 2. **Every version of the plan.** `workout.plan_version_id` binds a workout to the version
 *    it ran under, so a plan on v3 still has v1 and v2 workouts worth exporting. Every query
 *    here joins through `plan_version` to `plan_id`, never to one version.
 * 3. **Metric refs are rebuilt per scope.** `metric_value` is one flat row with three
 *    nullable reference columns; `MetricValue.ref` is a discriminated union. `scope = 'set'`
 *    rows leave `workout_id` null by construction and reach the plan through `set_log`.
 *
 * Read-only, and scoped to one plan in one user's own database — physical isolation means
 * there is no cross-user row to leak here in the first place (ARCHITECTURE decision 4).
 *
 * Slugs come from joins on `exercise_def`: log rows store `exercise_def_id`, and every
 * identity the export keys on is a slug (`exercise_def.slug` is load-bearing, CLAUDE.md).
 */

import type {
  Activity,
  Deviation,
  DeviationKind,
  Difficulty,
  Logs,
  MetricValue,
  SetLog,
  Workout,
  WorkoutStatus,
} from "../logs/types";
import type { UserDb } from "./user-db";

/** SQLite hands back null; the `Logs` types use optional properties. */
function opt<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

export function logsForPlan(userDb: UserDb, planId: string): Logs {
  return {
    workouts: workoutsOf(userDb, planId),
    set_logs: setLogsOf(userDb, planId),
    metric_values: metricValuesOf(userDb, planId),
    deviations: deviationsOf(userDb, planId),
    activities: activitiesOf(userDb),
  };
}

type WorkoutRow = {
  id: string;
  session_key: string;
  started_at: string;
  completed_at: string | null;
  status: WorkoutStatus;
  note: string | null;
};

function workoutsOf(userDb: UserDb, planId: string): Workout[] {
  const rows = userDb.db
    .prepare(
      `SELECT w.id AS id, w.session_key AS session_key, w.started_at AS started_at,
              w.completed_at AS completed_at, w.status AS status, w.note AS note
       FROM workout w
       JOIN plan_version pv ON pv.id = w.plan_version_id
       WHERE pv.plan_id = ?
       ORDER BY w.started_at, w.id`,
    )
    .all(planId) as WorkoutRow[];

  return rows.map((row) => ({
    id: row.id,
    session_key: row.session_key,
    started_at: row.started_at,
    completed_at: opt(row.completed_at),
    status: row.status,
    note: opt(row.note),
  }));
}

type SetLogRow = {
  id: string;
  workout_id: string;
  exercise_slug: string;
  set_no: number;
  side: "left" | "right" | null;
  reps: number | null;
  weight_kg: number | null;
  duration_s: number | null;
  difficulty: Difficulty | null;
};

/**
 * Ordered by the workout's start then by `id` — a ULID, so within a workout that is
 * insertion order. `renderRawLogs` emits `sets.csv` in array order, so this ordering is
 * what the reviewing AI reads.
 */
function setLogsOf(userDb: UserDb, planId: string): SetLog[] {
  const rows = userDb.db
    .prepare(
      `SELECT s.id AS id, s.workout_id AS workout_id, e.slug AS exercise_slug,
              s.set_no AS set_no, s.side AS side, s.reps AS reps, s.weight_kg AS weight_kg,
              s.duration_s AS duration_s, s.difficulty AS difficulty
       FROM set_log s
       JOIN workout w ON w.id = s.workout_id
       JOIN plan_version pv ON pv.id = w.plan_version_id
       JOIN exercise_def e ON e.id = s.exercise_def_id
       WHERE pv.plan_id = ?
       ORDER BY w.started_at, s.id`,
    )
    .all(planId) as SetLogRow[];

  return rows.map((row) => ({
    id: row.id,
    workout_id: row.workout_id,
    exercise_slug: row.exercise_slug,
    set_no: row.set_no,
    side: opt(row.side),
    reps: opt(row.reps),
    weight_kg: opt(row.weight_kg),
    duration_s: opt(row.duration_s),
    difficulty: opt(row.difficulty),
  }));
}

type MetricValueRow = {
  id: string;
  scope: "set" | "exercise" | "session";
  metric_key: string;
  value_num: number | null;
  value_text: string | null;
  set_log_id: string | null;
  workout_id: string | null;
  exercise_slug: string | null;
};

/**
 * `COALESCE(m.workout_id, s.workout_id)` is what reaches the plan for all three scopes at
 * once: `scope = 'set'` rows reference a `set_log` and leave `workout_id` null, so they
 * arrive at their workout through the set.
 *
 * A row whose scope's required reference is missing is skipped rather than emitted with a
 * malformed `ref`. The schema does not constrain the combination — nothing in the app
 * writes one (`logMetric` validates first), but a half-written row must not become a
 * plausible wrong number in the summary.
 */
function metricValuesOf(userDb: UserDb, planId: string): MetricValue[] {
  const rows = userDb.db
    .prepare(
      `SELECT m.id AS id, m.scope AS scope, m.metric_key AS metric_key,
              m.value_num AS value_num, m.value_text AS value_text,
              m.set_log_id AS set_log_id,
              COALESCE(m.workout_id, s.workout_id) AS workout_id,
              e.slug AS exercise_slug
       FROM metric_value m
       LEFT JOIN set_log s ON s.id = m.set_log_id
       LEFT JOIN exercise_def e ON e.id = m.exercise_def_id
       JOIN workout w ON w.id = COALESCE(m.workout_id, s.workout_id)
       JOIN plan_version pv ON pv.id = w.plan_version_id
       WHERE pv.plan_id = ?
       ORDER BY m.id`,
    )
    .all(planId) as MetricValueRow[];

  const values: MetricValue[] = [];
  for (const row of rows) {
    const ref = refOf(row);
    if (!ref) continue;
    values.push({
      id: row.id,
      key: row.metric_key,
      ref,
      value_num: opt(row.value_num),
      value_text: opt(row.value_text),
    });
  }
  return values;
}

function refOf(row: MetricValueRow): MetricValue["ref"] | undefined {
  switch (row.scope) {
    case "set":
      return row.set_log_id === null ? undefined : { scope: "set", set_log_id: row.set_log_id };
    case "exercise":
      return row.workout_id === null || row.exercise_slug === null
        ? undefined
        : { scope: "exercise", workout_id: row.workout_id, exercise_slug: row.exercise_slug };
    case "session":
      return row.workout_id === null ? undefined : { scope: "session", workout_id: row.workout_id };
  }
}

type DeviationRow = {
  id: string;
  workout_id: string;
  exercise_slug: string;
  kind: DeviationKind;
  reason_code: string | null;
  note: string | null;
  substitute_exercise_slug: string | null;
};

function deviationsOf(userDb: UserDb, planId: string): Deviation[] {
  const rows = userDb.db
    .prepare(
      `SELECT d.id AS id, d.workout_id AS workout_id, e.slug AS exercise_slug, d.kind AS kind,
              d.reason_code AS reason_code, d.note AS note,
              d.substitute_exercise_slug AS substitute_exercise_slug
       FROM deviation d
       JOIN workout w ON w.id = d.workout_id
       JOIN plan_version pv ON pv.id = w.plan_version_id
       JOIN exercise_def e ON e.id = d.exercise_def_id
       WHERE pv.plan_id = ?
       ORDER BY w.started_at, d.id`,
    )
    .all(planId) as DeviationRow[];

  return rows.map((row) => ({
    id: row.id,
    workout_id: row.workout_id,
    exercise_slug: row.exercise_slug,
    kind: row.kind,
    reason_code: opt(row.reason_code),
    note: opt(row.note),
    substitute_exercise_slug: opt(row.substitute_exercise_slug),
  }));
}

type ActivityRow = {
  id: string;
  kind: string;
  occurred_at: string;
  duration_min: number | null;
  intensity: string | null;
  note: string | null;
};

/**
 * Every activity, not this plan's: the `activity` table carries no plan reference (it is a
 * swim, not a session), so activities are per user and the window does the narrowing —
 * `filterLogsToWindow` filters them on `occurred_at`.
 */
function activitiesOf(userDb: UserDb): Activity[] {
  const rows = userDb.db
    .prepare(
      `SELECT id, kind, occurred_at, duration_min, intensity, note
       FROM activity
       ORDER BY occurred_at, id`,
    )
    .all() as ActivityRow[];

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    occurred_at: row.occurred_at,
    duration_min: opt(row.duration_min),
    intensity: opt(row.intensity),
    note: opt(row.note),
  }));
}
