/**
 * The export route's server half. The action must never throw — every failure is a
 * `fail(…, { actionError })` — and an unknown window must be rejected rather than
 * quietly exported as some default span under a label that then lies to the AI.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractPlanSourceFromBundle } from "../../src/lib/export/bundle";
import { importPlan } from "../../src/lib/db/import-plan";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { getExerciseDefIdBySlug, getPlanBySlug } from "../../src/lib/db/read";
import { logSet, startWorkout } from "../../src/lib/db/workout";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { buildExportBundle } from "../../src/routes/plan/[slug]/export/bundle-for-plan";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");
const NOW = new Date("2026-09-08T08:00:00Z");

describe("buildExportBundle", () => {
  let dataDir: string;
  let userDb: UserDb;
  let planId: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-export-route-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });

    const parsed = parsePlanDocument(fixtureMd);
    if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error(result.message);
    planId = result.plan_id;

    const squatId = getExerciseDefIdBySlug(userDb, planId, "goblet-squat");
    if (!squatId) throw new Error("fixture is missing goblet-squat");
    const { id: workoutId } = startWorkout(userDb, {
      planVersionId: result.plan_version_id,
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
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("replays Section 1 byte-for-byte from the imported document", () => {
    const plan = getPlanBySlug(userDb, "home-training");
    if (!plan) throw new Error("plan missing");
    const result = buildExportBundle(userDb, plan, "full", NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(extractPlanSourceFromBundle(result.bundle)).toBe(fixtureMd);
  });

  it("substitutes the template's variables for real values", () => {
    const plan = getPlanBySlug(userDb, "home-training");
    if (!plan) throw new Error("plan missing");
    const result = buildExportBundle(userDb, plan, "full", NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.bundle).toContain("weeks of Home Training Plan v1");
    expect(result.bundle).not.toContain("{{plan_name}}");
  });

  it("puts the window label in the title and reflects the logged set in the summary", () => {
    const plan = getPlanBySlug(userDb, "home-training");
    if (!plan) throw new Error("plan missing");
    const result = buildExportBundle(userDb, plan, "full", NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.bundle).toContain("— full history");
    expect(result.bundle).toContain("goblet-squat");
    expect(result.bundle).toContain("6 kg × 12");
  });

  it("rejects an unknown window rather than defaulting to one", () => {
    const plan = getPlanBySlug(userDb, "home-training");
    if (!plan) throw new Error("plan missing");
    expect(buildExportBundle(userDb, plan, "last_year", NOW).ok).toBe(false);
    expect(buildExportBundle(userDb, plan, "", NOW).ok).toBe(false);
  });

  it("names the archive file per plan, version and instant", () => {
    const plan = getPlanBySlug(userDb, "home-training");
    if (!plan) throw new Error("plan missing");
    const result = buildExportBundle(userDb, plan, "full", NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.filename).toBe("gain-export-home-training-v1.md");
    const archived = fs.readdirSync(path.join(userDb.userDir, "exports"));
    expect(archived).toContain("gain-export-home-training-v1-2026-09-08T080000Z.md");
  });
});
