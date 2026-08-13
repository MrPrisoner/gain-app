/**
 * First import: the real fixture becomes a plan, an immutable version, and the
 * structured rows that drive the app — with the source document on disk
 * byte-for-byte.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deepEqual } from "../../src/lib/diff/diff";
import { importPlan } from "../../src/lib/db/import-plan";
import {
  contractOfVersion,
  getCurrentVersion,
  listVersions,
  readSourceMd,
} from "../../src/lib/db/read";
import { prepareImportReview } from "../../src/lib/db/review";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { parsePlanDocument, type ParsedPlan } from "../../src/lib/parse/parser";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");

const NOW = new Date("2026-09-08T08:00:00Z");

describe("first import of the reference plan", () => {
  let dataDir: string;
  let userDb: UserDb;
  let parsed: ParsedPlan;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-db-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });

    const result = parsePlanDocument(fixtureMd);
    if (!result.ok) throw new Error(`fixture failed to parse: ${result.kind}`);
    parsed = result;
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("reviews as a first import with the fixture's counts", () => {
    const review = prepareImportReview(userDb, parsed);

    expect(review.kind).toBe("first_import");
    if (review.kind !== "first_import") return;
    expect(review.plan_slug).toBe("home-training");
    expect(review.version_no).toBe(1);
    // ARCHITECTURE §6: 4 sessions, 26 catalogued exercises, 49 prescriptions.
    expect(review.counts.sessions).toBe(4);
    expect(review.counts.exercises).toBe(26);
    expect(review.counts.prescriptions).toBe(49);
  });

  it("writes the plan, one current version, and the verbatim source to disk", () => {
    const result = importPlan(userDb, { parsed, now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.first_import).toBe(true);
    expect(result.version_no).toBe(1);
    expect(result.counts.prescriptions).toBe(49);

    // The source document is on disk exactly as it arrived (§11).
    expect(fs.readFileSync(result.source_path, "utf8")).toBe(fixtureMd);
    expect(result.source_path).toBe(path.join(userDb.userDir, "plans", "home-training", "v1.md"));

    const versions = listVersions(userDb, result.plan_id);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.is_current).toBe(1);
    expect(versions[0]?.based_on_version).toBeNull();

    // readSourceMd replays the disk copy.
    const current = getCurrentVersion(userDb, result.plan_id);
    expect(current).toBeDefined();
    if (current) expect(readSourceMd(userDb, current)).toBe(fixtureMd);
  });

  it("stores the contract losslessly and the context verbatim", () => {
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error("import failed");

    const current = getCurrentVersion(userDb, result.plan_id);
    expect(current).toBeDefined();
    if (!current) return;

    expect(deepEqual(contractOfVersion(current), parsed.contract)).toBe(true);
    expect(current.context_md).toBe(parsed.context_md);
  });

  it("derives the structured rows from the contract", () => {
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error("import failed");
    const versionId = result.plan_version_id;
    const db = userDb.db;

    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM exercise_def WHERE plan_id = ?")
          .get(result.plan_id) as { n: number }
      ).n,
    ).toBe(26);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM version_session WHERE plan_version_id = ?")
          .get(versionId) as { n: number }
      ).n,
    ).toBe(4);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM prescription WHERE plan_version_id = ?")
          .get(versionId) as { n: number }
      ).n,
    ).toBe(49);
  });

  it("carries the catalogue's movement properties (gap 5)", () => {
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error("import failed");

    // per-side movements exist.
    const perSide = userDb.db
      .prepare(
        "SELECT COUNT(*) AS n FROM version_exercise WHERE plan_version_id = ? AND per_side = 1",
      )
      .get(result.plan_version_id) as { n: number };
    expect(perSide.n).toBeGreaterThan(0);

    // A conditional movement with substitutes exists.
    const conditional = userDb.db
      .prepare(
        `SELECT substitutes_json FROM version_exercise
         WHERE plan_version_id = ? AND conditional = 1`,
      )
      .all(result.plan_version_id) as { substitutes_json: string | null }[];
    expect(conditional.length).toBeGreaterThan(0);
    expect(conditional.some((row) => row.substitutes_json !== null)).toBe(true);

    // Display names: derived unless the catalogue supplied one.
    const names = userDb.db
      .prepare(
        `SELECT e.slug AS slug, e.name AS name
         FROM exercise_def e WHERE e.plan_id = ?`,
      )
      .all(result.plan_id) as { slug: string; name: string }[];
    for (const row of names) {
      expect(row.name.length).toBeGreaterThan(0);
      expect(row.name[0]).toBe(row.name[0]?.toUpperCase());
    }
  });

  it("carries block structure: rounds, checkoff, ranged sets (gaps 1 and 2)", () => {
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error("import failed");
    const versionId = result.plan_version_id;
    const db = userDb.db;

    // A rounds block exists, with its round count, and no sets on its prescriptions.
    const roundsBlocks = db
      .prepare(
        "SELECT session_key, key FROM version_block WHERE plan_version_id = ? AND type = 'rounds'",
      )
      .all(versionId) as { session_key: string; key: string }[];
    expect(roundsBlocks.length).toBeGreaterThan(0);
    for (const block of roundsBlocks) {
      const rounds = db
        .prepare(
          "SELECT rounds FROM version_block WHERE plan_version_id = ? AND session_key = ? AND key = ?",
        )
        .get(versionId, block.session_key, block.key) as { rounds: number | null };
      expect(rounds.rounds).not.toBeNull();

      const setsInRounds = db
        .prepare(
          `SELECT COUNT(*) AS n FROM prescription
           WHERE plan_version_id = ? AND session_key = ? AND block_key = ?
             AND sets_min IS NOT NULL`,
        )
        .get(versionId, block.session_key, block.key) as { n: number };
      expect(setsInRounds.n).toBe(0);
    }

    // A checkoff block exists.
    const checkoff = db
      .prepare(
        "SELECT COUNT(*) AS n FROM version_block WHERE plan_version_id = ? AND tracking = 'checkoff'",
      )
      .get(versionId) as { n: number };
    expect(checkoff.n).toBeGreaterThan(0);

    // Ranged sets survive as sets_min/sets_max.
    const rangedSets = db
      .prepare(
        `SELECT COUNT(*) AS n FROM prescription
         WHERE plan_version_id = ? AND sets_min IS NOT NULL AND sets_max <> sets_min`,
      )
      .get(versionId) as { n: number };
    expect(rangedSets.n).toBeGreaterThan(0);

    // Block order is preserved.
    const orders = db
      .prepare(
        "SELECT order_no FROM version_block WHERE plan_version_id = ? ORDER BY session_key, order_no",
      )
      .all(versionId) as { order_no: number }[];
    expect(orders.length).toBeGreaterThan(0);
  });

  it("carries load notes (gap 4) and metric definitions", () => {
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error("import failed");
    const versionId = result.plan_version_id;
    const db = userDb.db;

    const loads = db
      .prepare(
        "SELECT ref, label, default_kg, is_bodyweight, note FROM load_config WHERE plan_version_id = ?",
      )
      .all(versionId) as {
      ref: string;
      label: string;
      default_kg: number | null;
      is_bodyweight: number;
      note: string | null;
    }[];
    expect(loads.length).toBeGreaterThan(0);
    expect(loads.some((load) => load.note !== null)).toBe(true);
    expect(loads.some((load) => load.is_bodyweight === 1)).toBe(true);

    const metrics = db
      .prepare("SELECT scope, key, prompt_when FROM metric_def WHERE plan_version_id = ?")
      .all(versionId) as { scope: string; key: string; prompt_when: string | null }[];
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics.some((m) => m.scope === "session" && m.prompt_when !== null)).toBe(true);
    expect(metrics.some((m) => m.scope === "exercise")).toBe(true);
  });

  it("rejects a second import of the same version", () => {
    const first = importPlan(userDb, { parsed, now: NOW });
    expect(first.ok).toBe(true);

    const second = importPlan(userDb, { parsed, now: NOW });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.kind).toBe("version_not_newer");
    expect(second.current_version).toBe(1);
    expect(second.incoming_version).toBe(1);

    // Nothing was written by the rejected import.
    expect(listVersions(userDb, first.ok ? first.plan_id : "")).toHaveLength(1);
  });

  it("leaves no file behind when the database write fails", () => {
    // SQLite can roll itself back; the filesystem cannot. Force a failure inside
    // the transaction and assert that both stores are untouched afterwards.
    const planDir = path.join(userDb.userDir, "plans", "home-training");
    userDb.db.exec(
      "CREATE TRIGGER boom BEFORE INSERT ON prescription BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );

    expect(() => importPlan(userDb, { parsed, now: NOW })).toThrow(/boom/);

    expect(userDb.db.prepare("SELECT COUNT(*) AS n FROM plan").get()).toEqual({ n: 0 });
    expect(userDb.db.prepare("SELECT COUNT(*) AS n FROM plan_version").get()).toEqual({ n: 0 });
    // No orphan document, and no staging debris either.
    expect(fs.existsSync(planDir) ? fs.readdirSync(planDir) : []).toEqual([]);

    // With the failure removed, a retry is clean.
    userDb.db.exec("DROP TRIGGER boom");
    const retry = importPlan(userDb, { parsed, now: NOW });
    expect(retry.ok).toBe(true);
    expect(fs.readdirSync(planDir)).toEqual(["v1.md"]);
    expect(readSourceMd(userDb, getCurrentVersion(userDb, retry.ok ? retry.plan_id : "")!)).toBe(
      fixtureMd,
    );
  });
});
