/**
 * `resolveWorkoutRoute`: which plan and session key a workout actually belongs to.
 *
 * It exists for one caller — the session runner's `?/start`, checking that a
 * user-supplied `?resume=<clientId>` names a workout belonging to the route asking for
 * it. Every other path reaches a workout through a route-keyed `localStorage` pointer or
 * through an op the client minted for it, both of which pair the workout with its session
 * by construction. A pasted or hand-edited URL does not, and without the check
 * `/plan/p/session/A?resume=<a session-B workout>` hydrates B's ledger into A's screen.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { resolveWorkoutRoute, startWorkout } from "../../src/lib/db/workout";
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

describe("resolveWorkoutRoute", () => {
  let dataDir: string;
  let userDb: UserDb;
  let planId: string;
  let planVersionId: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-workout-route-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });
    const result = importDoc(userDb, fixtureMd);
    planId = result.plan_id;
    planVersionId = result.plan_version_id;
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("names the plan and the session key a workout was started on", () => {
    const { id } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "B",
      clientId: "c-w1",
      now: NOW,
    });

    expect(resolveWorkoutRoute(userDb, id)).toEqual({ planId, sessionKey: "B" });
  });

  it("names the plan and not the version, so a workout open across a revision still resumes", () => {
    const { id } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });

    const revised = importDoc(
      userDb,
      fixtureMd
        .replace("  version: 1", "  version: 2")
        .replace("  based_on_version: null", "  based_on_version: 1"),
    );
    expect(revised.plan_version_id).not.toBe(planVersionId);

    // ARCHITECTURE §8: the workout stays bound to the version it ran under, so a
    // version-level check here would refuse to resume it the moment a revision landed.
    expect(resolveWorkoutRoute(userDb, id)?.planId).toBe(revised.plan_id);
  });

  it("returns undefined for a workout id that does not exist", () => {
    expect(resolveWorkoutRoute(userDb, "01JNOTAWORKOUTXXXXXXXXXXXX")).toBeUndefined();
  });
});
