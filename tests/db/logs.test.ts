/**
 * The read path from `gain.db` to the plain-data `Logs` shape the export generator
 * consumes. The subtle requirements are in the module comment of `src/lib/db/logs.ts`:
 * unwindowed, across every version of the plan, and metric refs rebuilt per scope.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { logsForPlan } from "../../src/lib/db/logs";
import { getDefaultTemplate, getExerciseDefIdBySlug } from "../../src/lib/db/read";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { logDeviation, logMetric, logSet, startWorkout } from "../../src/lib/db/workout";
import { parsePlanDocument } from "../../src/lib/parse/parser";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");
const NOW = new Date("2026-09-08T08:00:00Z");

describe("logsForPlan", () => {
  let dataDir: string;
  let userDb: UserDb;
  let planId: string;
  let planVersionId: string;
  let squatId: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-logs-test-"));
    userDb = openUserDb(dataDir, "user-1", {
      now: NOW,
      seedTemplates: [
        { name: "Default revision instructions", body_md: "TEMPLATE BODY", is_default: true },
      ],
    });

    const parsed = parsePlanDocument(fixtureMd);
    if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error(result.message);
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

  it("returns empty logs for a plan with no workouts", () => {
    const logs = logsForPlan(userDb, planId);
    expect(logs.workouts).toEqual([]);
    expect(logs.set_logs).toEqual([]);
    expect(logs.metric_values).toEqual([]);
    expect(logs.deviations).toEqual([]);
    expect(logs.activities).toEqual([]);
  });

  it("reads a workout and its sets, keyed on the exercise slug", () => {
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
      difficulty: "medium",
      clientId: "c-s1",
    });

    const logs = logsForPlan(userDb, planId);
    expect(logs.workouts).toHaveLength(1);
    expect(logs.workouts[0]).toMatchObject({
      id: workoutId,
      session_key: "A",
      started_at: NOW.toISOString(),
      status: "partial",
    });
    expect(logs.set_logs).toHaveLength(1);
    expect(logs.set_logs[0]).toMatchObject({
      workout_id: workoutId,
      exercise_slug: "goblet-squat",
      set_no: 1,
      reps: 12,
      weight_kg: 6,
      difficulty: "medium",
    });
  });

  it("maps SQL NULL to undefined, never to null", () => {
    const { id: workoutId } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });
    logSet(userDb, { workoutId, exerciseDefId: squatId, setNo: 1, reps: 10, clientId: "c-s1" });

    const logs = logsForPlan(userDb, planId);
    const [workout] = logs.workouts;
    const [set] = logs.set_logs;
    // `renderRawLogs` and `renderExerciseSets` both test `!== undefined`; a null
    // would render as the string "null" in the CSV and in the summary tables.
    expect(workout?.completed_at).toBeUndefined();
    expect(workout?.note).toBeUndefined();
    expect(set?.side).toBeUndefined();
    expect(set?.weight_kg).toBeUndefined();
    expect(set?.duration_s).toBeUndefined();
    expect(set?.difficulty).toBeUndefined();
    expect(Object.values({ ...workout, ...set })).not.toContain(null);
  });

  it("rebuilds each metric_value's ref from its scope", () => {
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
      clientId: "c-s1",
    });
    logMetric(userDb, { scope: "set", setLogId, metricKey: "rir", valueNum: 2, clientId: "c-m1" });
    logMetric(userDb, {
      scope: "exercise",
      workoutId,
      exerciseDefId: squatId,
      metricKey: "knee_pain",
      valueNum: 0,
      clientId: "c-m2",
    });
    logMetric(userDb, {
      scope: "session",
      workoutId,
      metricKey: "energy",
      valueNum: 4,
      clientId: "c-m3",
    });

    const logs = logsForPlan(userDb, planId);
    const byKey = new Map(logs.metric_values.map((v) => [v.key, v]));

    expect(byKey.get("rir")?.ref).toEqual({ scope: "set", set_log_id: setLogId });
    expect(byKey.get("knee_pain")?.ref).toEqual({
      scope: "exercise",
      workout_id: workoutId,
      exercise_slug: "goblet-squat",
    });
    expect(byKey.get("energy")?.ref).toEqual({ scope: "session", workout_id: workoutId });
    expect(byKey.get("rir")?.value_num).toBe(2);
    expect(byKey.get("rir")?.value_text).toBeUndefined();
  });

  it("keeps two same-named metrics at different scopes apart", () => {
    // The contract only requires a metric key to be unique WITHIN its scope, so a
    // plan may legally declare `rpe` at set scope and at session scope. Losing the
    // scope here merges two unrelated series downstream (AGENTS.md, Invariants).
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
      clientId: "c-s1",
    });
    logMetric(userDb, { scope: "set", setLogId, metricKey: "rpe", valueNum: 8, clientId: "c-m1" });
    logMetric(userDb, {
      scope: "session",
      workoutId,
      metricKey: "rpe",
      valueNum: 3,
      clientId: "c-m2",
    });

    const rpe = logsForPlan(userDb, planId).metric_values.filter((v) => v.key === "rpe");
    expect(rpe).toHaveLength(2);
    expect(rpe.map((v) => v.ref.scope).sort()).toEqual(["session", "set"]);
    expect(rpe.find((v) => v.ref.scope === "set")?.value_num).toBe(8);
    expect(rpe.find((v) => v.ref.scope === "session")?.value_num).toBe(3);
  });

  it("reads deviations with both the exercise slug and any substitute", () => {
    const { id: workoutId } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });
    logDeviation(userDb, {
      workoutId,
      exerciseDefId: squatId,
      kind: "substitute",
      reasonCode: "equipment",
      substituteExerciseSlug: "split-squat",
      clientId: "c-d1",
    });

    const [deviation] = logsForPlan(userDb, planId).deviations;
    expect(deviation).toMatchObject({
      workout_id: workoutId,
      exercise_slug: "goblet-squat",
      kind: "substitute",
      reason_code: "equipment",
      substitute_exercise_slug: "split-squat",
    });
    expect(deviation?.note).toBeUndefined();
  });

  it("returns workouts in chronological order", () => {
    const later = new Date("2026-09-10T08:00:00Z");
    const earlier = new Date("2026-09-01T08:00:00Z");
    startWorkout(userDb, { planVersionId, sessionKey: "A", clientId: "c-w2", now: later });
    startWorkout(userDb, { planVersionId, sessionKey: "B", clientId: "c-w1", now: earlier });

    const logs = logsForPlan(userDb, planId);
    expect(logs.workouts.map((w) => w.session_key)).toEqual(["B", "A"]);
  });

  it("is unwindowed — filtering is the generator's job, and weeksElapsed needs the full set", () => {
    const old = new Date("2026-01-01T08:00:00Z");
    startWorkout(userDb, { planVersionId, sessionKey: "A", clientId: "c-old", now: old });
    startWorkout(userDb, { planVersionId, sessionKey: "B", clientId: "c-new", now: NOW });

    expect(logsForPlan(userDb, planId).workouts).toHaveLength(2);
  });

  it("spans every version of the plan, not only the current one", () => {
    // A plan on v2 still has v1 workouts worth exporting. Section 1 is the current
    // version's source_md; the logs are not version-scoped.
    const { id: oldWorkoutId } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-v1",
      now: NOW,
    });

    // Built from the fixture's own parsed contract, the same way
    // tests/db/second-import.test.ts does — not a string replace, which would as
    // happily match `schema_version: 1` as `plan.version`.
    const parsedV1 = parsePlanDocument(fixtureMd);
    if (!parsedV1.ok) throw new Error(`fixture failed to parse: ${parsedV1.kind}`);
    const v2Contract = structuredClone(parsedV1.contract);
    v2Contract.plan.version = 2;
    v2Contract.plan.based_on_version = 1;
    const revised = `${parsedV1.context_md}\`\`\`gain-plan\n${stringify(v2Contract)}\`\`\`\n`;

    const parsed = parsePlanDocument(revised);
    if (!parsed.ok) throw new Error(`revision failed to parse: ${parsed.kind}`);
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error(result.message);
    startWorkout(userDb, {
      planVersionId: result.plan_version_id,
      sessionKey: "B",
      clientId: "c-v2",
      now: NOW,
    });

    const logs = logsForPlan(userDb, planId);
    expect(logs.workouts).toHaveLength(2);
    expect(logs.workouts.map((w) => w.id)).toContain(oldWorkoutId);
  });

  it("returns nothing for an unknown plan id", () => {
    expect(logsForPlan(userDb, "not-a-plan").workouts).toEqual([]);
  });
});

describe("getDefaultTemplate", () => {
  let dataDir: string;
  let userDb: UserDb;

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns the seeded default template body", () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-template-test-"));
    userDb = openUserDb(dataDir, "user-1", {
      now: NOW,
      seedTemplates: [{ name: "Default revision instructions", body_md: "BODY", is_default: true }],
    });
    expect(getDefaultTemplate(userDb)).toBe("BODY");
  });

  it("returns undefined when nothing is marked default", () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-template-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });
    expect(getDefaultTemplate(userDb)).toBeUndefined();
  });
});
