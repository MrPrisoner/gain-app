/**
 * Migration 3 deletes the `workout` rows that earlier builds created just for opening a
 * session. The assertions are as much about what it spares as about what it removes: a
 * row with a single set, metric or deviation recorded something, and the emptiness test
 * is the whole reason this deletion is provably lossless.
 *
 * The migration's SQL is re-run by hand against rows inserted afterwards, rather than
 * driven through `openUserDb`. `openUserDb` applies every migration at once on a fresh
 * database, so there is no moment at which a version-2 database with rows in it exists
 * to migrate — and re-running the real shipped string is a stricter test than
 * reimplementing its logic here would be.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { getExerciseDefIdBySlug } from "../../src/lib/db/read";
import { MIGRATIONS } from "../../src/lib/db/schema";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { logDeviation, logMetric, logSet, startWorkout } from "../../src/lib/db/workout";
import { parsePlanDocument } from "../../src/lib/parse/parser";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");

const IMPORTED = new Date("2026-09-08T08:00:00Z");
const LONG_AGO = new Date("2026-09-01T08:00:00Z");

const cleanupSql = MIGRATIONS.find((m) => m.version === 3)?.sql;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

describe("migration 3: peeked-workout cleanup", () => {
  let dataDir: string;
  let userDb: UserDb;
  let planId: string;
  let versionId: string;
  let squatId: string;

  function countWorkouts(): number {
    const { n } = userDb.db.prepare("SELECT COUNT(*) AS n FROM workout").get() as { n: number };
    return n;
  }

  function peek(clientId: string, now: Date): string {
    return startWorkout(userDb, {
      planVersionId: versionId,
      sessionKey: "A",
      clientId,
      now,
    }).id;
  }

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-peek-cleanup-"));
    userDb = openUserDb(dataDir, "user-1", { now: IMPORTED });

    const parsed = parsePlanDocument(fixtureMd);
    if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
    const result = importPlan(userDb, { parsed, now: IMPORTED });
    if (!result.ok) throw new Error(result.message);
    planId = result.plan_id;

    versionId = (
      userDb.db
        .prepare("SELECT id FROM plan_version WHERE plan_id = ? ORDER BY version_no DESC LIMIT 1")
        .get(planId) as { id: string }
    ).id;

    const found = getExerciseDefIdBySlug(userDb, planId, "goblet-squat");
    if (!found) throw new Error("fixture is missing goblet-squat");
    squatId = found;
  });

  afterEach(() => {
    userDb.db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("ships as version 3", () => {
    expect(cleanupSql, "migration 3 must exist").toBeTruthy();
  });

  it("deletes an old workout with nothing logged against it", () => {
    peek("peek-1", daysAgo(5));
    expect(countWorkouts()).toBe(1);

    userDb.db.exec(cleanupSql as string);

    expect(countWorkouts()).toBe(0);
  });

  it("spares an empty workout inside the 24-hour floor", () => {
    // A session open on someone's phone right now has no rows yet either. Migrations run
    // lazily on any request, POST /api/sync included, so without this floor a restart
    // between the start op syncing and the first set arriving would delete the live
    // workout and strand that set as permanently pending.
    peek("peek-fresh", daysAgo(0));

    userDb.db.exec(cleanupSql as string);

    expect(countWorkouts()).toBe(1);
  });

  it("spares a workout with a logged set", () => {
    const workoutId = peek("real-set", daysAgo(5));
    logSet(userDb, {
      workoutId,
      exerciseDefId: squatId,
      setNo: 1,
      reps: 12,
      weightKg: 6,
      difficulty: "medium",
      clientId: "set-1",
    });

    userDb.db.exec(cleanupSql as string);

    expect(countWorkouts()).toBe(1);
  });

  it("spares a workout with only a session metric", () => {
    // The NOT IN trap lives here: `metric_value.workout_id` is nullable, so a `NOT IN`
    // subquery over it goes NULL and deletes nothing at all. This is the test that
    // catches the wrong spelling.
    const workoutId = peek("real-metric", daysAgo(5));
    logMetric(userDb, {
      scope: "session",
      workoutId,
      metricKey: "energy_before",
      valueNum: 3,
      clientId: "metric-1",
    });

    userDb.db.exec(cleanupSql as string);

    expect(countWorkouts()).toBe(1);
  });

  it("spares a workout with only a deviation", () => {
    const workoutId = peek("real-deviation", daysAgo(5));
    logDeviation(userDb, {
      workoutId,
      exerciseDefId: squatId,
      kind: "skip",
      reasonCode: "time",
      clientId: "deviation-1",
    });

    userDb.db.exec(cleanupSql as string);

    expect(countWorkouts()).toBe(1);
  });

  it("spares a finished workout even with nothing logged against it", () => {
    // `completed_at` means the user tapped Finish. That is a claim they made about their
    // own session, and it is not this migration's to overrule.
    const workoutId = peek("finished-empty", daysAgo(5));
    userDb.db
      .prepare("UPDATE workout SET status = 'completed', completed_at = ? WHERE id = ?")
      .run(LONG_AGO.toISOString(), workoutId);

    userDb.db.exec(cleanupSql as string);

    expect(countWorkouts()).toBe(1);
  });

  it("deletes several peeks and spares several real workouts in one pass", () => {
    peek("peek-a", daysAgo(9));
    peek("peek-b", daysAgo(4));
    const real = peek("real", daysAgo(6));
    logSet(userDb, {
      workoutId: real,
      exerciseDefId: squatId,
      setNo: 1,
      reps: 10,
      clientId: "set-2",
    });
    peek("fresh", daysAgo(0));

    userDb.db.exec(cleanupSql as string);

    expect(countWorkouts()).toBe(2);
  });
});
