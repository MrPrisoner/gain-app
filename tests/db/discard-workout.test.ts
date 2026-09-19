/**
 * `discardWorkout`'s write path: the app's one surgical hard delete of logged training
 * data. These cases exist because getting the delete order wrong is invisible until a
 * set-scope `metric_value` row (which references `set_log_id`, not `workout_id`) is
 * silently orphaned or the delete fails outright.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { getExerciseDefIdBySlug } from "../../src/lib/db/read";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import {
  discardWorkout,
  logActivity,
  logDeviation,
  logMetric,
  logSet,
  startWorkout,
} from "../../src/lib/db/workout";
import { parsePlanDocument } from "../../src/lib/parse/parser";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");

const NOW = new Date("2026-09-08T08:00:00Z");

function importDoc(userDb: UserDb, md: string) {
  const parsed = parsePlanDocument(md);
  if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
  const result = importPlan(userDb, { parsed, now: NOW });
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe("discardWorkout", () => {
  let dataDir: string;
  let userDb: UserDb;
  let planVersionId: string;
  let squatId: string;

  function countOf(table: string): number {
    const row = userDb.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
    return row.n;
  }

  function setLogCountForWorkout(workoutId: string): number {
    const row = userDb.db
      .prepare("SELECT COUNT(*) AS n FROM set_log WHERE workout_id = ?")
      .get(workoutId) as { n: number };
    return row.n;
  }

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-discard-workout-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });

    const result = importDoc(userDb, fixtureMd);
    planVersionId = result.plan_version_id;

    const id = getExerciseDefIdBySlug(userDb, result.plan_id, "goblet-squat");
    if (!id) throw new Error("fixture is missing goblet-squat");
    squatId = id;
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("deletes the workout and every row that hangs off it", () => {
    const { id: workoutId } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });
    const { id: setLog1 } = logSet(userDb, {
      workoutId,
      exerciseDefId: squatId,
      setNo: 1,
      reps: 12,
      weightKg: 6,
      clientId: "c-s1",
    });
    logSet(userDb, {
      workoutId,
      exerciseDefId: squatId,
      setNo: 2,
      reps: 10,
      weightKg: 6,
      clientId: "c-s2",
    });
    // session-scope metric_value: references workout_id, not set_log_id.
    logMetric(userDb, {
      scope: "session",
      workoutId,
      metricKey: "squash_since_last",
      valueNum: 1,
      clientId: "c-m-session",
    });
    // set-scope metric_value: references set_log_id, not workout_id.
    logMetric(userDb, {
      scope: "set",
      setLogId: setLog1,
      metricKey: "symptoms_during",
      valueText: "none",
      clientId: "c-m-set",
    });
    logDeviation(userDb, {
      workoutId,
      exerciseDefId: squatId,
      kind: "skip",
      reasonCode: "time",
      clientId: "c-d1",
    });

    expect(discardWorkout(userDb, "c-w1")).toBe(true);
    expect(countOf("workout")).toBe(0);
    expect(countOf("set_log")).toBe(0);
    expect(countOf("metric_value")).toBe(0);
    expect(countOf("deviation")).toBe(0);
  });

  it("returns false for a client id it has never seen", () => {
    // Not an error: a discard op replayed twice, or one for a workout whose start op was
    // purged before it ever synced, must both be a quiet no-op.
    expect(discardWorkout(userDb, "01JXXXXXXXXXXXXXXXXXXXXXXX")).toBe(false);
  });

  it("leaves another workout's rows untouched", () => {
    const { id: workoutId } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });
    logSet(userDb, {
      workoutId,
      exerciseDefId: squatId,
      setNo: 1,
      reps: 12,
      weightKg: 6,
      clientId: "c-s1",
    });

    const { id: otherId } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-w2",
      now: NOW,
    });
    logSet(userDb, {
      workoutId: otherId,
      exerciseDefId: squatId,
      setNo: 1,
      reps: 12,
      weightKg: 6,
      clientId: "c-s2",
    });
    const { id: otherSetLogId } = logSet(userDb, {
      workoutId: otherId,
      exerciseDefId: squatId,
      setNo: 2,
      reps: 10,
      weightKg: 6,
      clientId: "c-s3",
    });
    // The second workout also owns a set-scope metric_value (references `set_log_id`,
    // not `workout_id`) and a deviation, so this test actually exercises the two rows
    // that a workout-scoped delete could plausibly leak across: a subquery missing its
    // own `WHERE workout_id = ?` guard would match every set_log in the database, not
    // just the discarded workout's.
    logMetric(userDb, {
      scope: "set",
      setLogId: otherSetLogId,
      metricKey: "symptoms_during",
      valueText: "none",
      clientId: "c-m-other-set",
    });
    logDeviation(userDb, {
      workoutId: otherId,
      exerciseDefId: squatId,
      kind: "skip",
      reasonCode: "time",
      clientId: "c-d-other",
    });

    expect(discardWorkout(userDb, "c-w1")).toBe(true);
    expect(countOf("workout")).toBe(1);
    expect(setLogCountForWorkout(otherId)).toBe(2);
    expect(countOf("metric_value")).toBe(1);
    expect(countOf("deviation")).toBe(1);
  });

  it("deletes a set-scope metric_value, which references the set and not the workout", () => {
    const { id: workoutId } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });
    const { id: setLogId } = logSet(userDb, {
      workoutId,
      exerciseDefId: squatId,
      setNo: 1,
      reps: 12,
      weightKg: 6,
      clientId: "c-s1",
    });
    logMetric(userDb, {
      scope: "set",
      setLogId,
      metricKey: "symptoms_during",
      valueText: "none",
      clientId: "c-m-set",
    });

    expect(countOf("metric_value")).toBe(1);
    expect(discardWorkout(userDb, "c-w1")).toBe(true);
    expect(countOf("metric_value")).toBe(0);
  });

  it("is a no-op on the activity table", () => {
    logActivity(userDb, {
      kind: "squash",
      occurredAt: NOW,
      clientId: "c-a1",
    });

    const { id: workoutId } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });
    logSet(userDb, {
      workoutId,
      exerciseDefId: squatId,
      setNo: 1,
      reps: 12,
      weightKg: 6,
      clientId: "c-s1",
    });

    expect(discardWorkout(userDb, "c-w1")).toBe(true);
    // `activity` carries no workout reference and belongs to the user, not the session.
    expect(countOf("activity")).toBe(1);
  });
});
