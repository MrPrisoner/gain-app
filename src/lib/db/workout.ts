/**
 * The workout write layer (phase 4, online-only): start/finish a workout, log a set, a
 * metric value, or a deviation. Every write is idempotent on `client_id` — the same
 * shape offline sync (phase 5) will replay, so this layer already behaves as a replay
 * target: writing the same client_id twice is a no-op that returns the original row.
 *
 * `logMetric` carries one extra rule on top of that — a metric answer is a correction of
 * the previous answer to the same question, not a second observation, so it upserts on
 * the metric's own identity as well. See its comment.
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

/**
 * Start (or, on replay, resume) a workout. Created with status `partial` — see the
 * plan's Global Constraints on why the schema has no "in progress" state.
 *
 * `resumed` distinguishes the two: the idempotent lookup found a workout already started
 * against this `client_id`, so it may already have rows the caller needs to read back
 * (`workoutHistoryFor`) rather than a brand-new empty one. Which of the two it was is
 * something only this function can know, and knowing it saves the resume path's callers
 * three queries and a contract parse on every fresh start.
 */
export function startWorkout(
  userDb: UserDb,
  input: StartWorkoutInput,
): { id: string; resumed: boolean } {
  const existing = selectByClientId(userDb, "workout", input.clientId);
  if (existing) return { id: existing, resumed: true };

  const id = newId();
  userDb.db
    .prepare(
      `INSERT INTO workout (id, plan_version_id, session_key, started_at, status, client_id)
       VALUES (?, ?, ?, ?, 'partial', ?)`,
    )
    .run(id, input.planVersionId, input.sessionKey, input.now.toISOString(), input.clientId);
  return { id, resumed: false };
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
  if (input.scope === "set" && !input.setLogId) {
    throw new Error('logMetric: scope "set" requires setLogId');
  }
  if (input.scope === "exercise" && (!input.workoutId || !input.exerciseDefId)) {
    throw new Error('logMetric: scope "exercise" requires workoutId and exerciseDefId');
  }
  if (input.scope === "session" && !input.workoutId) {
    throw new Error('logMetric: scope "session" requires workoutId');
  }

  const existing = selectByClientId(userDb, "metric_value", input.clientId);
  if (existing) return { id: existing };

  // A metric answer is a *correction*, not a new observation. The UI (the pre-session
  // prompt and the wrap-up sheet, UI-DECISIONS §8) submits one form per scale cell, each
  // carrying its own `client_id` — so tapping "2" and then correcting to "8" is two
  // distinct writes as far as the `client_id` check above is concerned, and used to leave
  // both rows behind. `metric_value` has no uniqueness on the metric's own identity, so
  // the phantom answer then counted as a real data point in the export's metric trends
  // (`src/lib/export/summary.ts` buckets by scope+key and reports n/first/latest/extremes
  // over every matching row). Upserting on that identity — the reference columns the
  // scope itself defines, plus `metric_key` — keeps one answer per question asked.
  //
  // The two idempotency checks compose rather than replace each other: the `client_id`
  // lookup above is replay safety for the *same* tap (a retried request must not write
  // twice), and this one is correction safety for a *different* tap at the same metric.
  // Taking `client_id` with the new value keeps the row's replay identity pointing at the
  // write that actually produced its current value.
  //
  // Phase 5 caveat: a replay queue that delivers two corrections out of order would land
  // on the earlier answer. Ordering the queue is the queue's job — there is no timestamp
  // on `metric_value` to arbitrate with here.
  const prior = selectMetricByReference(userDb, input);
  if (prior) {
    userDb.db
      .prepare("UPDATE metric_value SET value_num = ?, value_text = ?, client_id = ? WHERE id = ?")
      .run(input.valueNum ?? null, input.valueText ?? null, input.clientId, prior);
    return { id: prior };
  }

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

/**
 * The id of the row already holding this metric's answer, if there is one — looked up by
 * the metric's own identity rather than by `client_id`: `metric_key` plus whichever
 * reference columns the scope defines (a set, an exercise within a workout, or the
 * workout itself). See `logMetric` for why that is the right key.
 */
function selectMetricByReference(userDb: UserDb, input: LogMetricInput): string | undefined {
  const row = (
    input.scope === "set"
      ? userDb.db
          .prepare(
            "SELECT id FROM metric_value WHERE scope = 'set' AND set_log_id = ? AND metric_key = ?",
          )
          .get(input.setLogId, input.metricKey)
      : input.scope === "exercise"
        ? userDb.db
            .prepare(
              `SELECT id FROM metric_value
                 WHERE scope = 'exercise' AND workout_id = ? AND exercise_def_id = ? AND metric_key = ?`,
            )
            .get(input.workoutId, input.exerciseDefId, input.metricKey)
        : userDb.db
            .prepare(
              "SELECT id FROM metric_value WHERE scope = 'session' AND workout_id = ? AND metric_key = ?",
            )
            .get(input.workoutId, input.metricKey)
  ) as { id: string } | undefined;
  return row?.id;
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
