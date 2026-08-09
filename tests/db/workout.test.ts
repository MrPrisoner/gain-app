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
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-dumbbell-v1.md", ROOT), "utf8");
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
    const exerciseDefId = getExerciseDefIdBySlug(userDb, planId, "supported-one-arm-row");
    if (!exerciseDefId) throw new Error("expected supported-one-arm-row in the catalogue");

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
      metricKey: "set_symptom",
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
      metricKey: "energy_after",
      valueNum: 6,
      clientId: "mv-client-3",
    });
    const sessionMetric1Replay = logMetric(userDb, {
      scope: "session",
      workoutId: workout.id,
      metricKey: "energy_after",
      valueNum: 6,
      clientId: "mv-client-3",
    });
    expect(sessionMetric1Replay.id).toBe(sessionMetric1.id);

    const count = userDb.db.prepare("SELECT COUNT(*) AS n FROM metric_value").get() as {
      n: number;
    };
    expect(count.n).toBe(3);
  });

  it("logs a deviation with a substitute slug, idempotently", () => {
    const workout = startWorkout(userDb, {
      planVersionId,
      sessionKey: "B",
      clientId: "wk-client-5",
      now: NOW,
    });
    const exerciseDefId = getExerciseDefIdBySlug(userDb, planId, "overhead-triceps-extension");
    if (!exerciseDefId) throw new Error("expected overhead-triceps-extension in the catalogue");

    const first = logDeviation(userDb, {
      workoutId: workout.id,
      exerciseDefId,
      kind: "substitute",
      reasonCode: "comfort",
      note: "Lumbar arching overhead.",
      substituteExerciseSlug: "lying-triceps-extension",
      clientId: "dev-client-1",
    });
    const replay = logDeviation(userDb, {
      workoutId: workout.id,
      exerciseDefId,
      kind: "substitute",
      reasonCode: "comfort",
      note: "Lumbar arching overhead.",
      substituteExerciseSlug: "lying-triceps-extension",
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
    const plan = getPlanBySlug(userDb, "home-dumbbell");
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
