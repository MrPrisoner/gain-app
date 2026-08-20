/**
 * The rename write path. A slug the AI returned mangled is mapped back onto the
 * exercise_def that holds its history, so charts stay one series instead of two.
 * The failure this guards is silent: nothing errors when history splits.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { logDeviation, startWorkout } from "../../src/lib/db/workout";
import { parsePlanDocument } from "../../src/lib/parse/parser";

const ROOT = new URL("../../", import.meta.url);
const v1Md = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");
const NOW = new Date("2026-09-08T08:00:00Z");

/** v1 with `goblet-squat` rewritten to `db-goblet-squat` and the version bumped. */
function mangledV2(): string {
  return v1Md
    .replaceAll("goblet-squat", "db-goblet-squat")
    .replace("  version: 1", "  version: 2")
    .replace("  based_on_version: null", "  based_on_version: 1");
}

function importDoc(userDb: UserDb, md: string, renames: { from: string; to: string }[] = []) {
  const parsed = parsePlanDocument(md);
  if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}\n${parsed.report}`);
  return importPlan(userDb, { parsed, now: NOW, renames });
}

describe("importPlan renames", () => {
  let dataDir: string;
  let userDb: UserDb;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-rename-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });
    const first = importDoc(userDb, v1Md);
    if (!first.ok) throw new Error(first.message);
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function defRow(slug: string) {
    return userDb.db
      .prepare("SELECT id, slug, first_seen_version FROM exercise_def WHERE slug = ?")
      .get(slug) as { id: string; slug: string; first_seen_version: number } | undefined;
  }

  /** `exercise_def` is scoped by `plan_id`, so a second plan needs the slug scoped too. */
  function defRowForPlan(planId: string, slug: string) {
    return userDb.db
      .prepare("SELECT id, slug FROM exercise_def WHERE plan_id = ? AND slug = ?")
      .get(planId, slug) as { id: string; slug: string } | undefined;
  }

  function planVersionId(planSlug: string, versionNo: number): string {
    const plan = userDb.db.prepare("SELECT id FROM plan WHERE slug = ?").get(planSlug) as {
      id: string;
    };
    const version = userDb.db
      .prepare("SELECT id FROM plan_version WHERE plan_id = ? AND version_no = ?")
      .get(plan.id, versionNo) as { id: string };
    return version.id;
  }

  function deviationSubstitute(clientId: string): string | null {
    const row = userDb.db
      .prepare("SELECT substitute_exercise_slug FROM deviation WHERE client_id = ?")
      .get(clientId) as { substitute_exercise_slug: string | null };
    return row.substitute_exercise_slug;
  }

  it("carries history onto the new slug instead of minting a second def", () => {
    const before = defRow("goblet-squat");
    expect(before).toBeDefined();

    const result = importDoc(userDb, mangledV2(), [
      { from: "goblet-squat", to: "db-goblet-squat" },
    ]);
    expect(result.ok).toBe(true);

    expect(defRow("goblet-squat")).toBeUndefined();
    expect(defRow("db-goblet-squat")?.id).toBe(before?.id);
  });

  it("leaves first_seen_version pointing at the movement's first version", () => {
    importDoc(userDb, mangledV2(), [{ from: "goblet-squat", to: "db-goblet-squat" }]);
    expect(defRow("db-goblet-squat")?.first_seen_version).toBe(1);
  });

  it("splits history into two defs when no rename is given", () => {
    const result = importDoc(userDb, mangledV2());
    expect(result.ok).toBe(true);
    expect(defRow("goblet-squat")).toBeDefined();
    expect(defRow("db-goblet-squat")).toBeDefined();
    expect(defRow("goblet-squat")?.id).not.toBe(defRow("db-goblet-squat")?.id);
  });

  it("rejects a rename whose `from` is still in the incoming catalogue", () => {
    const result = importDoc(userDb, mangledV2(), [{ from: "prone-row", to: "db-goblet-squat" }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.kind).toBe("invalid_rename");
  });

  it("rejects a rename whose `to` is not in the incoming catalogue", () => {
    const result = importDoc(userDb, mangledV2(), [{ from: "goblet-squat", to: "not-a-movement" }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.kind).toBe("invalid_rename");
  });

  it("rejects a rename whose `from` was never in this plan", () => {
    const result = importDoc(userDb, mangledV2(), [
      { from: "never-existed", to: "db-goblet-squat" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.kind).toBe("invalid_rename");
  });

  it("rejects two renames targeting the same slug", () => {
    const result = importDoc(userDb, mangledV2(), [
      { from: "goblet-squat", to: "db-goblet-squat" },
      { from: "prone-row", to: "db-goblet-squat" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.kind).toBe("invalid_rename");
  });

  it("writes nothing at all when a rename is invalid", () => {
    const before = userDb.db.prepare("SELECT COUNT(*) AS n FROM plan_version").get() as {
      n: number;
    };
    importDoc(userDb, mangledV2(), [{ from: "never-existed", to: "db-goblet-squat" }]);
    const after = userDb.db.prepare("SELECT COUNT(*) AS n FROM plan_version").get() as {
      n: number;
    };
    expect(after.n).toBe(before.n);
    expect(defRow("goblet-squat")).toBeDefined();
  });

  it("does not leave a staged source document behind on failure", () => {
    importDoc(userDb, mangledV2(), [{ from: "never-existed", to: "db-goblet-squat" }]);
    const dir = path.join(dataDir, "users", "user-1", "plans", "home-training");
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".staged"))).toEqual([]);
  });

  it("rewrites deviation.substitute_exercise_slug alongside the exercise_def it names", () => {
    const proneRow = defRow("prone-row");
    expect(proneRow).toBeDefined();

    const { id: workoutId } = startWorkout(userDb, {
      planVersionId: planVersionId("home-training", 1),
      sessionKey: "A",
      clientId: "workout-rename-a",
      now: NOW,
    });
    logDeviation(userDb, {
      workoutId,
      exerciseDefId: proneRow!.id,
      kind: "substitute",
      substituteExerciseSlug: "goblet-squat",
      clientId: "deviation-rename-a",
    });

    const result = importDoc(userDb, mangledV2(), [
      { from: "goblet-squat", to: "db-goblet-squat" },
    ]);
    expect(result.ok).toBe(true);

    expect(deviationSubstitute("deviation-rename-a")).toBe("db-goblet-squat");
  });

  it("scopes the deviation rewrite to the renamed plan and leaves another plan's alone", () => {
    // A second plan, same fixture content, different slug — its own fresh exercise_defs,
    // including its own `goblet-squat`.
    const secondMd = v1Md.replace("  slug: home-training", "  slug: home-training-two");
    const parsedSecond = parsePlanDocument(secondMd);
    if (!parsedSecond.ok) throw new Error(`fixture failed to parse: ${parsedSecond.kind}`);
    const secondImport = importPlan(userDb, { parsed: parsedSecond, now: NOW, renames: [] });
    if (!secondImport.ok) throw new Error(secondImport.message);

    const secondProneRow = defRowForPlan(secondImport.plan_id, "prone-row");
    expect(secondProneRow).toBeDefined();

    const { id: secondWorkoutId } = startWorkout(userDb, {
      planVersionId: planVersionId("home-training-two", 1),
      sessionKey: "A",
      clientId: "workout-rename-b",
      now: NOW,
    });
    logDeviation(userDb, {
      workoutId: secondWorkoutId,
      exerciseDefId: secondProneRow!.id,
      kind: "substitute",
      substituteExerciseSlug: "goblet-squat",
      clientId: "deviation-rename-b",
    });

    // The rename import targets the FIRST plan only.
    const result = importDoc(userDb, mangledV2(), [
      { from: "goblet-squat", to: "db-goblet-squat" },
    ]);
    expect(result.ok).toBe(true);

    // The second plan's deviation, naming the same slug, must be untouched — proof that
    // `applyRenames`'s join through `plan_version`/`workout` actually scopes by plan
    // rather than rewriting every row that happens to match the slug as a string.
    expect(deviationSubstitute("deviation-rename-b")).toBe("goblet-squat");
  });
});
