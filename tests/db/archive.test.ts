/**
 * Archiving's write path. The whole point of the feature is that it is *not* deletion —
 * so the assertions here are as much about what does not move (the plan row, its
 * versions, its logged workouts and sets) as about the one column that does.
 *
 * Idempotence matters for a reason that is easy to miss: `archived_at` is the only
 * record of when a plan was put away, so a second archive must leave the original
 * timestamp alone rather than stamp today's date over it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { archivePlan, unarchivePlan } from "../../src/lib/db/archive";
import { importPlan } from "../../src/lib/db/import-plan";
import { logsForPlan } from "../../src/lib/db/logs";
import {
  getExerciseDefIdBySlug,
  getPlanBySlug,
  listPlans,
  listVersions,
} from "../../src/lib/db/read";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { logSet, startWorkout } from "../../src/lib/db/workout";
import { parsePlanDocument } from "../../src/lib/parse/parser";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");

const IMPORTED = new Date("2026-09-08T08:00:00Z");
const ARCHIVED = new Date("2026-10-01T19:30:00Z");
const LATER = new Date("2026-11-14T07:00:00Z");

describe("archivePlan / unarchivePlan", () => {
  let dataDir: string;
  let userDb: UserDb;
  let planId: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-archive-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: IMPORTED });

    const parsed = parsePlanDocument(fixtureMd);
    if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
    const result = importPlan(userDb, { parsed, now: IMPORTED });
    if (!result.ok) throw new Error(result.message);
    planId = result.plan_id;

    const squatId = getExerciseDefIdBySlug(userDb, planId, "goblet-squat");
    if (!squatId) throw new Error("fixture is missing goblet-squat");
    const { id: workoutId } = startWorkout(userDb, {
      planVersionId: result.plan_version_id,
      sessionKey: "A",
      clientId: "c-w1",
      now: IMPORTED,
    });
    logSet(userDb, {
      workoutId,
      exerciseDefId: squatId,
      setNo: 1,
      reps: 12,
      weightKg: 6,
      clientId: "c-s1",
    });
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("stamps archived_at from the injected clock", () => {
    expect(archivePlan(userDb, "home-training", ARCHIVED)).toBe(true);
    expect(getPlanBySlug(userDb, "home-training")?.archived_at).toBe(ARCHIVED.toISOString());
  });

  it("leaves the timestamp alone on a second archive", () => {
    archivePlan(userDb, "home-training", ARCHIVED);
    expect(archivePlan(userDb, "home-training", LATER)).toBe(false);
    expect(getPlanBySlug(userDb, "home-training")?.archived_at).toBe(ARCHIVED.toISOString());
  });

  it("unarchives back to exactly the state it came from", () => {
    const before = getPlanBySlug(userDb, "home-training");
    archivePlan(userDb, "home-training", ARCHIVED);
    expect(unarchivePlan(userDb, "home-training")).toBe(true);
    expect(getPlanBySlug(userDb, "home-training")).toEqual(before);
  });

  it("reports nothing done for an already-active plan or an unknown slug", () => {
    expect(unarchivePlan(userDb, "home-training")).toBe(false);
    expect(archivePlan(userDb, "no-such-plan", ARCHIVED)).toBe(false);
    expect(unarchivePlan(userDb, "no-such-plan")).toBe(false);
  });

  it("keeps the plan, its versions and every logged row readable while archived", () => {
    archivePlan(userDb, "home-training", ARCHIVED);

    // `listPlans` is deliberately unfiltered — the Home route splits active from
    // archived itself, and a read helper that hid archived rows would make the
    // archived group on Home unbuildable.
    expect(listPlans(userDb).map((p) => p.slug)).toContain("home-training");
    expect(listVersions(userDb, planId)).toHaveLength(1);

    const logs = logsForPlan(userDb, planId);
    expect(logs.workouts).toHaveLength(1);
    expect(logs.set_logs).toHaveLength(1);
    expect(logs.set_logs[0]?.weight_kg).toBe(6);
  });
});
