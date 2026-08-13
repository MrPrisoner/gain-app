/**
 * Server-side replay of a client's outbox batch (design spec §6).
 *
 * Thin by design: `$lib/db/workout` has been idempotent on `client_id` since phase 4 and
 * was written as a replay target, so this module resolves an op's slugs and client ids
 * into server ids and calls the write layer. It adds no write of its own.
 *
 * ## Three rules, all about not losing data
 *
 * **Failures are per op, not per batch.** One undeliverable op must not roll back the
 * session logged around it, so each op is attempted individually and the batch commits
 * the ones that worked.
 *
 * **A permanent failure is quarantined; a transient one is retried.** An op naming a slug
 * the plan does not have can never succeed, and reporting it as `failed` lets the client
 * park it and tell the user. An op whose workout has not arrived yet is neither applied
 * nor failed — it is simply left out of the response, and `applyAck` keeps it pending.
 * Conflating the two either loses data or blocks the queue forever.
 *
 * **The client's clock wins.** `startedAt` and `finishedAt` go into the write layer's
 * injected `now`, so a workout is dated when it was trained rather than when it synced.
 */

import {
  finishWorkout,
  logDeviation,
  logMetric,
  logSet,
  resolveSetLogIdByClientId,
  resolveWorkoutIdByClientId,
  startWorkout,
} from "../db/workout";
import { getExerciseDefIdBySlug } from "../db/read";
import type { UserDb } from "../db/user-db";
import type { AckResponse } from "./queue";
import type { SyncOp } from "./ops";

/** Thrown for an op that can never succeed, and caught into `failed`. */
class PermanentOpError extends Error {}

/** Signals "not yet" — the op stays pending and is neither applied nor failed. */
class NotYetError extends Error {}

export function replayOps(userDb: UserDb, planId: string, ops: readonly SyncOp[]): AckResponse {
  const applied: string[] = [];
  const failed: { id: string; error: string }[] = [];

  const ordered = [...ops].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // IMMEDIATE for the same reason import uses it: reads that later writes depend on must
  // not race another connection (AGENTS.md, Invariants).
  userDb.db
    .transaction(() => {
      for (const op of ordered) {
        try {
          applyOp(userDb, planId, op);
          applied.push(op.id);
        } catch (err) {
          if (err instanceof NotYetError) continue;
          failed.push({ id: op.id, error: err instanceof Error ? err.message : "unknown error" });
        }
      }
    })
    .immediate();

  return { applied, failed };
}

function applyOp(userDb: UserDb, planId: string, op: SyncOp): void {
  switch (op.kind) {
    case "start":
      // The workout's replay identity is `workoutClientId`, not the start op's own id — a
      // later "set" or "finish" op resolves the workout through `workoutClientId`
      // (`requireWorkout` below), so that is what must land in `workout.client_id`.
      startWorkout(userDb, {
        planVersionId: op.planVersionId,
        sessionKey: op.sessionKey,
        clientId: op.workoutClientId,
        now: new Date(op.startedAt),
      });
      return;

    case "set":
      logSet(userDb, {
        workoutId: requireWorkout(userDb, op.workoutClientId),
        exerciseDefId: requireExercise(userDb, planId, op.exerciseSlug),
        setNo: op.setNo,
        side: op.side,
        reps: op.reps,
        weightKg: op.weightKg,
        durationS: op.durationS,
        difficulty: op.difficulty,
        clientId: op.id,
      });
      return;

    case "deviation":
      logDeviation(userDb, {
        workoutId: requireWorkout(userDb, op.workoutClientId),
        exerciseDefId: requireExercise(userDb, planId, op.exerciseSlug),
        kind: op.deviationKind,
        reasonCode: op.reasonCode,
        note: op.note,
        substituteExerciseSlug: op.substituteExerciseSlug,
        clientId: op.id,
      });
      return;

    case "metric": {
      const workoutId = requireWorkout(userDb, op.workoutClientId);
      logMetric(userDb, {
        scope: op.scope,
        setLogId: op.scope === "set" ? requireSetLog(userDb, op.setClientId) : undefined,
        workoutId: op.scope === "set" ? undefined : workoutId,
        exerciseDefId:
          op.exerciseSlug === undefined
            ? undefined
            : requireExercise(userDb, planId, op.exerciseSlug),
        metricKey: op.metricKey,
        valueNum: op.valueNum,
        valueText: op.valueText,
        clientId: op.id,
      });
      return;
    }

    case "finish":
      finishWorkout(userDb, {
        workoutId: requireWorkout(userDb, op.workoutClientId),
        status: op.status,
        note: op.note,
        now: new Date(op.finishedAt),
      });
      return;
  }
}

/** Transient: a later batch may still deliver the start op. */
function requireWorkout(userDb: UserDb, workoutClientId: string): string {
  const id = resolveWorkoutIdByClientId(userDb, workoutClientId);
  if (!id) throw new NotYetError(`workout ${workoutClientId} has not been started here yet`);
  return id;
}

/** Transient for the same reason: the set op may be in a batch still to come. */
function requireSetLog(userDb: UserDb, setClientId: string | undefined): string {
  if (!setClientId) throw new PermanentOpError('a "set" scope metric needs setClientId');
  const id = resolveSetLogIdByClientId(userDb, setClientId);
  if (!id) throw new NotYetError(`set ${setClientId} has not arrived yet`);
  return id;
}

/** Permanent: a slug this plan does not define will not start existing on a retry. */
function requireExercise(userDb: UserDb, planId: string, slug: string): string {
  const id = getExerciseDefIdBySlug(userDb, planId, slug);
  if (!id) throw new PermanentOpError(`unknown exercise \`${slug}\` in this plan`);
  return id;
}
