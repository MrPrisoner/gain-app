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
});
