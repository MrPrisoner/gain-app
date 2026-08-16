/**
 * `versionsByWorkout` is the one join `logsForPlan` doesn't already do — proven here by
 * revising the plan mid-test and checking a workout logged before the revision still
 * reports its own (older) version, not the plan's current one.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { versionsByWorkout } from "../../src/lib/db/history";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { startWorkout } from "../../src/lib/db/workout";
import { parsePlanDocument } from "../../src/lib/parse/parser";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");
const NOW = new Date("2026-09-08T08:00:00Z");

describe("versionsByWorkout", () => {
  let dataDir: string;
  let userDb: UserDb;
  let planId: string;
  let v1Id: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-history-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });

    const parsed = parsePlanDocument(fixtureMd);
    if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error(result.message);
    planId = result.plan_id;
    v1Id = result.plan_version_id;
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("maps a workout to the version it ran under, across a revision", () => {
    const { id: firstWorkoutId } = startWorkout(userDb, {
      planVersionId: v1Id,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });

    // Build v2 from the fixture's own parsed contract, the same way
    // tests/db/logs.test.ts's "spans every version of the plan" test does — not a
    // string replace, which would as happily match `schema_version: 1`.
    const parsedV1 = parsePlanDocument(fixtureMd);
    if (!parsedV1.ok) throw new Error(`fixture failed to parse: ${parsedV1.kind}`);
    const v2Contract = structuredClone(parsedV1.contract);
    v2Contract.plan.version = 2;
    v2Contract.plan.based_on_version = 1;
    const revised = `${parsedV1.context_md}\`\`\`gain-plan\n${stringify(v2Contract)}\`\`\`\n`;
    const parsedV2 = parsePlanDocument(revised);
    if (!parsedV2.ok) throw new Error(`revision failed to parse: ${parsedV2.kind}`);
    const v2Result = importPlan(userDb, { parsed: parsedV2, now: NOW });
    if (!v2Result.ok) throw new Error(v2Result.message);

    const { id: secondWorkoutId } = startWorkout(userDb, {
      planVersionId: v2Result.plan_version_id,
      sessionKey: "B",
      clientId: "c-w2",
      now: NOW,
    });

    const versions = versionsByWorkout(userDb, planId);
    expect(versions.get(firstWorkoutId)?.versionNo).toBe(1);
    expect(versions.get(secondWorkoutId)?.versionNo).toBe(2);
  });

  it("returns an empty map for a plan with no workouts", () => {
    expect(versionsByWorkout(userDb, planId).size).toBe(0);
  });

  it("returns nothing for an unknown plan id", () => {
    expect(versionsByWorkout(userDb, "not-a-plan").size).toBe(0);
  });
});
