/**
 * The workout write layer: start/finish a workout, log a set, a metric value, or a
 * deviation. Every sync op is replayed through here, and every write is idempotent on
 * `client_id` — writing the same client_id twice is a no-op that returns the original
 * row, which is what makes replaying an outbox batch safe.
 *
 * `logMetric` and `logSet` carry one extra rule on top of that — a metric answer or a
 * set reopened from the runner's ledger is a correction of the previous write to the
 * same question or slot, not a second observation, so both upsert on their own identity
 * as well (guarded so a redelivered older correction can't revert a newer one). See
 * their comments.
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
  /** Set only when the runner is re-showing an already-logged ledger row for correction
   * (`editingSlot` in the session route) — see `logSet`'s own comment for why this must
   * come from the caller rather than be inferred from a reference match. */
  isCorrection?: boolean;
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

export type LogActivityInput = {
  kind: string;
  occurredAt: Date;
  durationMin?: number;
  intensity?: string;
  note?: string;
  clientId: string;
};

/**
 * Start (or, on replay, resume) a workout. Created with status `partial` — see
 * ARCHITECTURE §5 on why the schema has no "in progress" state.
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

  // A resubmission of an already-logged slot is a correction, not a second set (the
  // runner's ledger lets a logged row be reopened and re-submitted) — same upsert-on-
  // reference-plus-ULID-order shape as `logMetric`'s correction handling, see its
  // comment for the reasoning both share.
  //
  // Unlike a metric's reference, `(workout_id, exercise_def_id, set_no, side)` is not a
  // unique slot identity: `set_log` has no `block_key` column (deliberately — see
  // `$lib/session/resume.ts`'s module comment), so the same exercise prescribed directly
  // in a block *and* offered as another exercise's substitute in that same block produces
  // two genuinely distinct sets that share this exact reference the moment the substitute
  // is swapped in. Trusting a reference match alone treated the second slot's first log
  // as a correction of the first slot's row, silently merging two sets into one
  // (`e2e/session-runner-walkthrough-d.spec.ts`'s dead-bug/reverse-crunch case).
  const prior = selectSetByReference(userDb, input);
  if (prior) {
    // A strictly older write must never win — whether it's a genuinely redelivered
    // original op whose `client_id` a later correction has since overwritten on the row
    // (the row's `client_id` doubles as its replay identity, same as `logMetric`), or, in
    // principle, an out-of-order correction. Either way the existing row already holds
    // the newer data, so returning it without writing is always the safe answer — this
    // check runs regardless of `isCorrection` because a stale redelivery of the
    // *original* (non-correction) op must still lose to a correction that landed after
    // it, and it never risks the collision above since it writes nothing.
    if (input.clientId < prior.clientId) return { id: prior.id };

    // A strictly newer write only overwrites the found row when the caller says this
    // really is re-showing an already-logged row for correction (`isCorrection`, set by
    // the runner's `editingSlot`). Otherwise it falls through to the insert below,
    // exactly the fix the collision above needs: a fresh log is never merged into an
    // unrelated slot's row just because they happen to share a reference.
    if (input.isCorrection) {
      userDb.db
        .prepare(
          `UPDATE set_log SET reps = ?, weight_kg = ?, duration_s = ?, difficulty = ?, client_id = ?
             WHERE id = ?`,
        )
        .run(
          input.reps ?? null,
          input.weightKg ?? null,
          input.durationS ?? null,
          input.difficulty ?? null,
          input.clientId,
          prior.id,
        );
      return { id: prior.id };
    }
  }

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
  // prompt and the wrap-up sheet, UI §8) submits one form per scale cell, each
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
  const prior = selectMetricByReference(userDb, input);
  if (prior) {
    // A strictly older correction arriving after a newer one already won must not revert
    // it — client_id doubles as the row's replay identity, so overwriting it on every
    // correction would otherwise let a redelivered (lost-ack) older op silently undo a
    // newer one. ULIDs sort chronologically, so this is a plain string comparison.
    if (input.clientId < prior.clientId) return { id: prior.id };

    userDb.db
      .prepare("UPDATE metric_value SET value_num = ?, value_text = ?, client_id = ? WHERE id = ?")
      .run(input.valueNum ?? null, input.valueText ?? null, input.clientId, prior.id);
    return { id: prior.id };
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

/** `activity` is the one log table with no workout to hang off — the whole reason it
 * needs its own idempotency check rather than piggybacking on a workout's. */
export function logActivity(userDb: UserDb, input: LogActivityInput): { id: string } {
  const existing = selectByClientId(userDb, "activity", input.clientId);
  if (existing) return { id: existing };

  const id = newId();
  userDb.db
    .prepare(
      `INSERT INTO activity (id, kind, occurred_at, duration_min, intensity, note, client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.kind,
      input.occurredAt.toISOString(),
      input.durationMin ?? null,
      input.intensity ?? null,
      input.note ?? null,
      input.clientId,
    );
  return { id };
}

/**
 * The row already holding this metric's answer, if there is one — looked up by the
 * metric's own identity rather than by `client_id`: `metric_key` plus whichever reference
 * columns the scope defines (a set, an exercise within a workout, or the workout itself).
 * See `logMetric` for why that is the right key, and for why the row's current
 * `client_id` travels with it — the correction-ordering guard needs it.
 */
function selectMetricByReference(
  userDb: UserDb,
  input: LogMetricInput,
): { id: string; clientId: string } | undefined {
  const row = (
    input.scope === "set"
      ? userDb.db
          .prepare(
            "SELECT id, client_id AS clientId FROM metric_value WHERE scope = 'set' AND set_log_id = ? AND metric_key = ?",
          )
          .get(input.setLogId, input.metricKey)
      : input.scope === "exercise"
        ? userDb.db
            .prepare(
              `SELECT id, client_id AS clientId FROM metric_value
                 WHERE scope = 'exercise' AND workout_id = ? AND exercise_def_id = ? AND metric_key = ?`,
            )
            .get(input.workoutId, input.exerciseDefId, input.metricKey)
        : userDb.db
            .prepare(
              "SELECT id, client_id AS clientId FROM metric_value WHERE scope = 'session' AND workout_id = ? AND metric_key = ?",
            )
            .get(input.workoutId, input.metricKey)
  ) as { id: string; clientId: string } | undefined;
  return row;
}

/** `side` is nullable, so the lookup uses `IS` rather than `=` — `NULL = NULL` is not
 * true in SQL, and an unpaired exercise's sets all carry a NULL side. */
function selectSetByReference(
  userDb: UserDb,
  input: LogSetInput,
): { id: string; clientId: string } | undefined {
  const row = userDb.db
    .prepare(
      `SELECT id, client_id AS clientId FROM set_log
         WHERE workout_id = ? AND exercise_def_id = ? AND set_no = ? AND side IS ?`,
    )
    .get(input.workoutId, input.exerciseDefId, input.setNo, input.side ?? null) as
    { id: string; clientId: string } | undefined;
  return row;
}

function selectByClientId(
  userDb: UserDb,
  table: "workout" | "set_log" | "metric_value" | "deviation" | "activity",
  clientId: string,
): string | undefined {
  const row = userDb.db.prepare(`SELECT id FROM ${table} WHERE client_id = ?`).get(clientId) as
    { id: string } | undefined;
  return row?.id;
}

/**
 * Resolve a workout by the client-generated id its start op carried (phase 6).
 *
 * `startWorkout` already answers this for the op that creates the row, but ops for one
 * workout can span several batches, so a later batch's set has to find a workout that a
 * previous request created.
 */
export function resolveWorkoutIdByClientId(userDb: UserDb, clientId: string): string | undefined {
  return selectByClientId(userDb, "workout", clientId);
}

/** Resolve a `set_log` row by its client id, for a `scope: 'set'` metric op. */
export function resolveSetLogIdByClientId(userDb: UserDb, clientId: string): string | undefined {
  return selectByClientId(userDb, "set_log", clientId);
}

/** Resolve a workout's plan version id by its server id — the other half of resolving
 * which plan a non-start op belongs to, since only `start` ops carry `planVersionId`
 * directly. */
export function resolvePlanVersionIdForWorkout(
  userDb: UserDb,
  workoutId: string,
): string | undefined {
  const row = userDb.db
    .prepare("SELECT plan_version_id FROM workout WHERE id = ?")
    .get(workoutId) as { plan_version_id: string } | undefined;
  return row?.plan_version_id;
}
