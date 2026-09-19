/**
 * `openWorkoutsForPlan`'s read path: every workout of a plan the user started and never
 * finished, newest first, with its logged set count. This is the query the Home screen's
 * unfinished-session card is built on, so the cases here are as much about what gets
 * excluded (a finished workout, a row nothing can address) as about what comes back.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { openWorkoutsForPlan } from "../../src/lib/db/home";
import { getExerciseDefIdBySlug } from "../../src/lib/db/read";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { finishWorkout, logMetric, logSet, startWorkout } from "../../src/lib/db/workout";
import { parsePlanDocument } from "../../src/lib/parse/parser";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");

/** The fixture under a different slug, for the "only this plan's workouts" case — its
 * plan slug appears exactly once in the document, so this is a safe string swap rather
 * than a second fixture to maintain. */
function secondPlanMd(): string {
  return fixtureMd.replace("  slug: home-training", "  slug: home-training-2");
}

const NOW = new Date("2026-09-08T08:00:00Z");

function importDoc(userDb: UserDb, md: string) {
  const parsed = parsePlanDocument(md);
  if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
  const result = importPlan(userDb, { parsed, now: NOW });
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe("openWorkoutsForPlan", () => {
  let dataDir: string;
  let userDb: UserDb;
  let planId: string;
  let planVersionId: string;
  let squatId: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-open-workouts-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });

    const result = importDoc(userDb, fixtureMd);
    planId = result.plan_id;
    planVersionId = result.plan_version_id;

    const id = getExerciseDefIdBySlug(userDb, planId, "goblet-squat");
    if (!id) throw new Error("fixture is missing goblet-squat");
    squatId = id;
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns a workout with no completed_at, with its set count", () => {
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
    logSet(userDb, {
      workoutId,
      exerciseDefId: squatId,
      setNo: 2,
      reps: 10,
      weightKg: 6,
      clientId: "c-s2",
    });

    const open = openWorkoutsForPlan(userDb, planId);
    expect(open).toHaveLength(1);
    expect(open[0]?.sessionKey).toBe("A");
    expect(open[0]?.setCount).toBe(2);
  });

  it("omits a finished workout, whatever its status", () => {
    const { id: workoutId } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });
    finishWorkout(userDb, { workoutId, status: "stopped", now: NOW });

    expect(openWorkoutsForPlan(userDb, planId)).toHaveLength(0);
  });

  it("omits a workout with no client_id, which nothing can address", () => {
    userDb.db
      .prepare(
        `INSERT INTO workout (id, plan_version_id, session_key, started_at, status, client_id)
         VALUES (?, ?, ?, ?, 'partial', NULL)`,
      )
      .run("w-no-client", planVersionId, "A", NOW.toISOString());

    expect(openWorkoutsForPlan(userDb, planId)).toHaveLength(0);
  });

  it("returns newest first", () => {
    const earlier = NOW;
    const later = new Date(NOW.getTime() + 60 * 60 * 1000);

    startWorkout(userDb, { planVersionId, sessionKey: "A", clientId: "c-w1", now: earlier });
    startWorkout(userDb, { planVersionId, sessionKey: "B", clientId: "c-w2", now: later });

    const open = openWorkoutsForPlan(userDb, planId);
    expect(open.map((w) => w.sessionKey)).toEqual(["B", "A"]);
  });

  it("returns only this plan's workouts", () => {
    startWorkout(userDb, { planVersionId, sessionKey: "A", clientId: "c-w1", now: NOW });

    const second = importDoc(userDb, secondPlanMd());
    startWorkout(userDb, {
      planVersionId: second.plan_version_id,
      sessionKey: "B",
      clientId: "c-w2",
      now: NOW,
    });

    expect(openWorkoutsForPlan(userDb, planId).map((w) => w.sessionKey)).toEqual(["A"]);
  });

  it("reports a zero set count for a workout whose only write was a metric", () => {
    const { id: workoutId } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });
    logMetric(userDb, {
      scope: "session",
      workoutId,
      metricKey: "squash_since_last",
      valueNum: 1,
      clientId: "c-m1",
    });

    const open = openWorkoutsForPlan(userDb, planId);
    expect(open).toHaveLength(1);
    expect(open[0]?.setCount).toBe(0);
  });
});
