/**
 * The workout write layer (phase 4, online-only): start/finish a workout, log a set, a
 * metric value, or a deviation. Every write is idempotent on `client_id` — the same
 * shape offline sync (phase 5) will replay, so this layer already behaves as a replay
 * target: writing the same client_id twice is a no-op that returns the original row.
 */

import type { Difficulty, DeviationKind } from "../logs/types";
import { newId } from "./ulid";
import type { UserDb } from "./user-db";

type MetricScope = "set" | "exercise" | "session";

export type StartWorkoutInput = {
  planVersionId: string;
  sessionKey: string;
  clientId: string;
  now: Date;
};

export type FinishWorkoutInput = {
  workoutId: string;
  status: "completed" | "partial" | "stopped";
  note?: string;
  now: Date;
};

export type LogSetInput = {
  workoutId: string;
  exerciseDefId: string;
  setNo: number;
  side?: "left" | "right";
  reps?: number;
  weightKg?: number;
  durationS?: number;
  difficulty?: Difficulty;
  clientId: string;
};

export type LogMetricInput = {
  scope: MetricScope;
  /** Required when scope is "set". */
  setLogId?: string;
  /** Required when scope is "exercise" or "session". */
  workoutId?: string;
  /** Required when scope is "exercise". */
  exerciseDefId?: string;
  metricKey: string;
  valueNum?: number;
  valueText?: string;
  clientId: string;
};

export type LogDeviationInput = {
  workoutId: string;
  exerciseDefId: string;
  kind: DeviationKind;
  reasonCode?: string;
  note?: string;
  substituteExerciseSlug?: string;
  clientId: string;
};

/** Start (or, on replay, resume) a workout. Created with status `partial` — see the
 * plan's Global Constraints on why the schema has no "in progress" state. */
export function startWorkout(userDb: UserDb, input: StartWorkoutInput): { id: string } {
  const existing = selectByClientId(userDb, "workout", input.clientId);
  if (existing) return { id: existing };

  const id = newId();
  userDb.db
    .prepare(
      `INSERT INTO workout (id, plan_version_id, session_key, started_at, status, client_id)
       VALUES (?, ?, ?, ?, 'partial', ?)`,
    )
    .run(id, input.planVersionId, input.sessionKey, input.now.toISOString(), input.clientId);
  return { id };
}

export function finishWorkout(userDb: UserDb, input: FinishWorkoutInput): void {
  userDb.db
    .prepare("UPDATE workout SET status = ?, completed_at = ?, note = ? WHERE id = ?")
    .run(input.status, input.now.toISOString(), input.note ?? null, input.workoutId);
}

export function logSet(userDb: UserDb, input: LogSetInput): { id: string } {
  const existing = selectByClientId(userDb, "set_log", input.clientId);
  if (existing) return { id: existing };

  const id = newId();
  userDb.db
    .prepare(
      `INSERT INTO set_log
         (id, workout_id, exercise_def_id, set_no, side, reps, weight_kg, duration_s, difficulty, client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.workoutId,
      input.exerciseDefId,
      input.setNo,
      input.side ?? null,
      input.reps ?? null,
      input.weightKg ?? null,
      input.durationS ?? null,
      input.difficulty ?? null,
      input.clientId,
    );
  return { id };
}

export function logMetric(userDb: UserDb, input: LogMetricInput): { id: string } {
  const existing = selectByClientId(userDb, "metric_value", input.clientId);
  if (existing) return { id: existing };

  const id = newId();
  userDb.db
    .prepare(
      `INSERT INTO metric_value
         (id, scope, set_log_id, workout_id, exercise_def_id, metric_key, value_num, value_text, client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.scope,
      input.setLogId ?? null,
      input.workoutId ?? null,
      input.exerciseDefId ?? null,
      input.metricKey,
      input.valueNum ?? null,
      input.valueText ?? null,
      input.clientId,
    );
  return { id };
}

export function logDeviation(userDb: UserDb, input: LogDeviationInput): { id: string } {
  const existing = selectByClientId(userDb, "deviation", input.clientId);
  if (existing) return { id: existing };

  const id = newId();
  userDb.db
    .prepare(
      `INSERT INTO deviation
         (id, workout_id, exercise_def_id, kind, reason_code, note, substitute_exercise_slug, client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.workoutId,
      input.exerciseDefId,
      input.kind,
      input.reasonCode ?? null,
      input.note ?? null,
      input.substituteExerciseSlug ?? null,
      input.clientId,
    );
  return { id };
}

function selectByClientId(
  userDb: UserDb,
  table: "workout" | "set_log" | "metric_value" | "deviation",
  clientId: string,
): string | undefined {
  const row = userDb.db.prepare(`SELECT id FROM ${table} WHERE client_id = ?`).get(clientId) as
    { id: string } | undefined;
  return row?.id;
}
