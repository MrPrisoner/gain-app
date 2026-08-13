/**
 * The workout write layer: idempotent on client_id (a replayed write is a no-op),
 * every write resolvable by slug into the right exercise_def_id, and finishing a
 * workout only ever moves status forward (partial -> completed/stopped).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { getExerciseDefIdBySlug, getPlanBySlug } from "../../src/lib/db/read";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import {
  finishWorkout,
  logDeviation,
  logMetric,
  logSet,
  startWorkout,
} from "../../src/lib/db/workout";
import { parsePlanDocument } from "../../src/lib/parse/parser";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");
const NOW = new Date("2026-09-08T08:00:00Z");

describe("workout write layer", () => {
  let dataDir: string;
  let userDb: UserDb;
  let planId: string;
  let planVersionId: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-workout-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });

    const parsed = parsePlanDocument(fixtureMd);
    if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error(result.message);
    planId = result.plan_id;
    planVersionId = result.plan_version_id;
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("resolves an exercise_def id by slug", () => {
    const id = getExerciseDefIdBySlug(userDb, planId, "goblet-squat");
    expect(id).toBeTruthy();
    expect(getExerciseDefIdBySlug(userDb, planId, "not-a-real-slug")).toBeUndefined();
  });

  it("starts a workout once, idempotently on client_id", () => {
    const first = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "wk-client-1",
      now: NOW,
    });
    const replay = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "wk-client-1",
      now: NOW,
    });
    expect(replay.id).toBe(first.id);

    const row = userDb.db
      .prepare("SELECT status, completed_at FROM workout WHERE id = ?")
      .get(first.id) as {
      status: string;
      completed_at: string | null;
    };
    expect(row.status).toBe("partial");
    expect(row.completed_at).toBeNull();

    const count = userDb.db.prepare("SELECT COUNT(*) AS n FROM workout").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("logs a set idempotently and resolves the exercise_def_id", () => {
    const workout = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "wk-client-2",
      now: NOW,
    });
    const exerciseDefId = getExerciseDefIdBySlug(userDb, planId, "goblet-squat");
    if (!exerciseDefId) throw new Error("expected goblet-squat in the catalogue");

    const first = logSet(userDb, {
      workoutId: workout.id,
      exerciseDefId,
      setNo: 1,
      reps: 10,
      weightKg: 12,
      difficulty: "medium",
      clientId: "set-client-1",
    });
    const replay = logSet(userDb, {
      workoutId: workout.id,
      exerciseDefId,
      setNo: 1,
      reps: 10,
      weightKg: 12,
      difficulty: "medium",
      clientId: "set-client-1",
    });
    expect(replay.id).toBe(first.id);

    const count = userDb.db.prepare("SELECT COUNT(*) AS n FROM set_log").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("logs a per-side set with the side recorded", () => {
    const workout = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "wk-client-3",
      now: NOW,
    });
    const exerciseDefId = getExerciseDefIdBySlug(userDb, planId, "split-squat");
    if (!exerciseDefId) throw new Error("expected split-squat in the catalogue");

    const left = logSet(userDb, {
      workoutId: workout.id,
      exerciseDefId,
      setNo: 1,
      side: "left",
      reps: 10,
      difficulty: "easy",
      clientId: "set-client-left-1",
    });
    const right = logSet(userDb, {
      workoutId: workout.id,
      exerciseDefId,
      setNo: 1,
      side: "right",
      reps: 10,
      difficulty: "easy",
      clientId: "set-client-right-1",
    });
    expect(left.id).not.toBe(right.id);

    const rows = userDb.db.prepare("SELECT side FROM set_log ORDER BY side").all() as {
      side: string;
    }[];
    expect(rows.map((r) => r.side)).toEqual(["left", "right"]);
  });

  it("logs metric values at set, exercise and session scope, idempotently", () => {
    const workout = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "wk-client-4",
      now: NOW,
    });
    const exerciseDefId = getExerciseDefIdBySlug(userDb, planId, "goblet-squat");
    if (!exerciseDefId) throw new Error("expected goblet-squat in the catalogue");
    const set = logSet(userDb, {
      workoutId: workout.id,
      exerciseDefId,
      setNo: 1,
      reps: 10,
      difficulty: "medium",
      clientId: "set-client-metric",
    });

    logMetric(userDb, {
      scope: "set",
      setLogId: set.id,
      metricKey: "symptoms_during",
      valueNum: 0,
      clientId: "mv-client-1",
    });
    logMetric(userDb, {
      scope: "exercise",
      workoutId: workout.id,
      exerciseDefId,
      metricKey: "rir",
      valueNum: 2,
      clientId: "mv-client-2",
    });
    const sessionMetric1 = logMetric(userDb, {
      scope: "session",
      workoutId: workout.id,
      metricKey: "symptoms_during",
      valueNum: 6,
      clientId: "mv-client-3",
    });
    const sessionMetric1Replay = logMetric(userDb, {
      scope: "session",
      workoutId: workout.id,
      metricKey: "symptoms_during",
      valueNum: 6,
      clientId: "mv-client-3",
    });
    expect(sessionMetric1Replay.id).toBe(sessionMetric1.id);

    const count = userDb.db.prepare("SELECT COUNT(*) AS n FROM metric_value").get() as {
      n: number;
    };
    expect(count.n).toBe(3);
  });

  it("corrects a session metric in place rather than logging a second answer", () => {
    const workout = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "wk-client-metric-correction",
      now: NOW,
    });

    // Each scale cell submits its own form with its own `client_id` (UI-DECISIONS §8), so
    // a mis-tap and its correction are two distinct writes — the `client_id` check alone
    // cannot collapse them, and before the upsert both rows survived and both counted in
    // the export's metric trends.
    const mistap = logMetric(userDb, {
      scope: "session",
      workoutId: workout.id,
      metricKey: "symptoms_during",
      valueNum: 2,
      clientId: "mv-correction-01-mistap",
    });
    const corrected = logMetric(userDb, {
      scope: "session",
      workoutId: workout.id,
      metricKey: "symptoms_during",
      valueNum: 8,
      clientId: "mv-correction-02-fixed",
    });
    expect(corrected.id, "the correction must land on the same row").toBe(mistap.id);

    // Retry safety still holds on top of that: the same tap arriving twice (a resubmitted
    // request) is a no-op, not a second update.
    const replay = logMetric(userDb, {
      scope: "session",
      workoutId: workout.id,
      metricKey: "symptoms_during",
      valueNum: 8,
      clientId: "mv-correction-02-fixed",
    });
    expect(replay.id).toBe(corrected.id);

    const rows = userDb.db
      .prepare(
        `SELECT value_num, client_id FROM metric_value
           WHERE workout_id = ? AND scope = 'session' AND metric_key = 'symptoms_during'`,
      )
      .all(workout.id) as { value_num: number; client_id: string }[];
    expect(rows).toEqual([{ value_num: 8, client_id: "mv-correction-02-fixed" }]);

    // A different metric key in the same workout is a different question, so it gets its
    // own row rather than overwriting the one above.
    logMetric(userDb, {
      scope: "session",
      workoutId: workout.id,
      metricKey: "sleep_quality",
      valueNum: 3,
      clientId: "mv-correction-other-key",
    });
    const all = userDb.db
      .prepare("SELECT COUNT(*) AS n FROM metric_value WHERE workout_id = ? AND scope = 'session'")
      .get(workout.id) as { n: number };
    expect(all.n).toBe(2);
  });

  it("does not let a redelivered older correction revert a newer one", () => {
    const workout = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "wk-client-metric-reorder",
      now: NOW,
    });

    // client_id doubles as the row's replay identity, so a lost ack (queue.ts's "silence
    // is not success" rule) can cause an older op to be redelivered after a newer one
    // already landed. ULIDs are chronological, so "05" is older than "09".
    logMetric(userDb, {
      scope: "session",
      workoutId: workout.id,
      metricKey: "symptoms_during",
      valueNum: 2,
      clientId: "05",
    });
    logMetric(userDb, {
      scope: "session",
      workoutId: workout.id,
      metricKey: "symptoms_during",
      valueNum: 8,
      clientId: "09",
    });

    // "05" redelivered — the row's client_id is now "09", so the client_id lookup misses
    // and this falls through to the by-reference upsert. It must not win.
    const replayed = logMetric(userDb, {
      scope: "session",
      workoutId: workout.id,
      metricKey: "symptoms_during",
      valueNum: 2,
      clientId: "05",
    });

    const row = userDb.db
      .prepare(
        `SELECT value_num, client_id FROM metric_value
           WHERE workout_id = ? AND scope = 'session' AND metric_key = 'symptoms_during'`,
      )
      .get(workout.id) as { value_num: number; client_id: string };
    expect(row).toEqual({ value_num: 8, client_id: "09" });

    // The redelivery still resolves to the same row rather than erroring or minting a
    // new one — it is a correctly-ignored write, not a rejected one.
    const idRow = userDb.db
      .prepare(
        `SELECT id FROM metric_value
           WHERE workout_id = ? AND scope = 'session' AND metric_key = 'symptoms_during'`,
      )
      .get(workout.id) as { id: string };
    expect(replayed.id).toBe(idRow.id);
  });

  it("rejects a set-scope metric missing setLogId", () => {
    expect(() =>
      logMetric(userDb, {
        scope: "set",
        metricKey: "symptoms_during",
        valueNum: 0,
        clientId: "mv-client-bad-set",
      }),
    ).toThrow();
  });

  it("rejects an exercise-scope metric missing workoutId or exerciseDefId", () => {
    const workout = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "wk-client-4b",
      now: NOW,
    });
    const exerciseDefId = getExerciseDefIdBySlug(userDb, planId, "goblet-squat");
    if (!exerciseDefId) throw new Error("expected goblet-squat in the catalogue");

    expect(() =>
      logMetric(userDb, {
        scope: "exercise",
        exerciseDefId,
        metricKey: "rir",
        valueNum: 2,
        clientId: "mv-client-bad-exercise-1",
      }),
    ).toThrow();
    expect(() =>
      logMetric(userDb, {
        scope: "exercise",
        workoutId: workout.id,
        metricKey: "rir",
        valueNum: 2,
        clientId: "mv-client-bad-exercise-2",
      }),
    ).toThrow();
  });

  it("rejects a session-scope metric missing workoutId", () => {
    expect(() =>
      logMetric(userDb, {
        scope: "session",
        metricKey: "symptoms_during",
        valueNum: 6,
        clientId: "mv-client-bad-session",
      }),
    ).toThrow();
  });

  it("logs a deviation with a substitute slug, idempotently", () => {
    const workout = startWorkout(userDb, {
      planVersionId,
      sessionKey: "B",
      clientId: "wk-client-5",
      now: NOW,
    });
    const exerciseDefId = getExerciseDefIdBySlug(userDb, planId, "db-shoulder-press");
    if (!exerciseDefId) throw new Error("expected db-shoulder-press in the catalogue");

    const first = logDeviation(userDb, {
      workoutId: workout.id,
      exerciseDefId,
      kind: "substitute",
      reasonCode: "comfort",
      note: "Leaning back on the standing press.",
      substituteExerciseSlug: "seated-floor-shoulder-press",
      clientId: "dev-client-1",
    });
    const replay = logDeviation(userDb, {
      workoutId: workout.id,
      exerciseDefId,
      kind: "substitute",
      reasonCode: "comfort",
      note: "Leaning back on the standing press.",
      substituteExerciseSlug: "seated-floor-shoulder-press",
      clientId: "dev-client-1",
    });
    expect(replay.id).toBe(first.id);

    const count = userDb.db.prepare("SELECT COUNT(*) AS n FROM deviation").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("finishes a workout, moving status and stamping completed_at", () => {
    const workout = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "wk-client-6",
      now: NOW,
    });
    const finishedAt = new Date("2026-09-08T08:45:00Z");
    finishWorkout(userDb, { workoutId: workout.id, status: "completed", now: finishedAt });

    const row = userDb.db
      .prepare("SELECT status, completed_at FROM workout WHERE id = ?")
      .get(workout.id) as { status: string; completed_at: string | null };
    expect(row.status).toBe("completed");
    expect(row.completed_at).toBe(finishedAt.toISOString());
  });

  it("a red-flag stop finishes the workout with status stopped", () => {
    const plan = getPlanBySlug(userDb, "home-training");
    if (!plan) throw new Error("expected the fixture plan to be importable");
    const workout = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "wk-client-7",
      now: NOW,
    });
    finishWorkout(userDb, {
      workoutId: workout.id,
      status: "stopped",
      note: "Red-flag symptom during set 2.",
      now: NOW,
    });

    const row = userDb.db
      .prepare("SELECT status, note FROM workout WHERE id = ?")
      .get(workout.id) as {
      status: string;
      note: string | null;
    };
    expect(row.status).toBe("stopped");
    expect(row.note).toContain("Red-flag");
  });
});
