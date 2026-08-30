/**
 * Plain-data training logs — the pure-core shape of the domain model's workout,
 * set_log, metric_value, deviation and activity records (ARCHITECTURE §5).
 *
 * The core is pure functions over plain data: the export generator consumes these
 * structures, and tests build them directly. IDs are caller-generated strings, which is
 * what lets the offline client mint them and the server replay them idempotently.
 */

export type Difficulty = "easy" | "medium" | "hard";

export type WorkoutStatus = "completed" | "partial" | "stopped";

export type Workout = {
  id: string;
  /** Session `key` from the contract, e.g. `A`. */
  session_key: string;
  /** ISO 8601 timestamp. */
  started_at: string;
  /** ISO 8601 timestamp. */
  completed_at?: string;
  status: WorkoutStatus;
  note?: string;
};

export type SetLog = {
  id: string;
  workout_id: string;
  /** The exercise catalogue slug the set is logged against. */
  exercise_slug: string;
  set_no: number;
  /** Present on `per_side` exercises. */
  side?: "left" | "right";
  reps?: number;
  weight_kg?: number;
  duration_s?: number;
  difficulty?: Difficulty;
};

export type MetricScopeRef =
  | { scope: "set"; set_log_id: string }
  | { scope: "exercise"; workout_id: string; exercise_slug: string }
  | { scope: "session"; workout_id: string };

export type MetricValue = {
  id: string;
  /** The metric `key` declared in the contract. */
  key: string;
  /** Where this value attaches. */
  ref: MetricScopeRef;
  value_num?: number;
  value_text?: string;
};

export type DeviationKind = "skip" | "substitute" | "add_set" | "drop_set" | "stop_red_flag";

export type Deviation = {
  id: string;
  workout_id: string;
  exercise_slug: string;
  kind: DeviationKind;
  /** Structured reason, e.g. `pain`, `time`, `equipment`, `felt_easy`, `other`. */
  reason_code?: string;
  note?: string;
  /** For `substitute`: the slug actually performed. */
  substitute_exercise_slug?: string;
};

/** `kind` is a free-form slug in the user's own vocabulary — GAIN ships no list. */
export type Activity = {
  id: string;
  kind: string;
  /** ISO 8601 timestamp. */
  occurred_at: string;
  duration_min?: number;
  intensity?: string;
  note?: string;
};

export type Logs = {
  workouts: Workout[];
  set_logs: SetLog[];
  metric_values: MetricValue[];
  deviations: Deviation[];
  activities: Activity[];
};

export const EMPTY_LOGS: Logs = {
  workouts: [],
  set_logs: [],
  metric_values: [],
  deviations: [],
  activities: [],
};
