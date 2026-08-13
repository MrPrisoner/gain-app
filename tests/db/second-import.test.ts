/**
 * Second import: a revision comes back, the review diffs it against the stored
 * version, and committing it keeps exercise identity stable. This is the
 * phase-2 done criterion — "Import writes a version; second import produces a
 * correct diff."
 *
 * The v2 document is built programmatically from the fixture's parsed contract:
 * bump the version, raise one rep range, add a movement, drop one prescription.
 * Nothing about the fixture's prose is assumed.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GainContract, Prescription } from "../../src/lib/contract/schema";
import { importPlan, type ImportPlanSuccess } from "../../src/lib/db/import-plan";
import { getCurrentVersion, listVersions, readSourceMd } from "../../src/lib/db/read";
import { prepareImportReview } from "../../src/lib/db/review";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { parsePlanDocument, type ParsedPlan } from "../../src/lib/parse/parser";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");

const NOW = new Date("2026-09-08T08:00:00Z");

/** Raise a reps value by one at the top of its range. */
function bumpReps(reps: Prescription["reps"]): Prescription["reps"] {
  if (reps === undefined) return reps;
  return Array.isArray(reps) ? [reps[0], reps[1] + 1] : reps + 1;
}

function buildV2Contract(v1: GainContract): GainContract {
  const contract = structuredClone(v1);

  contract.plan.version = 2;
  contract.plan.based_on_version = 1;
  contract.plan.changelog = [
    "Raised the top of one goblet squat rep range",
    "Added push-ups",
    "Dropped one prescription",
  ];

  // Add a brand-new movement to the catalogue and prescribe it in session A.
  contract.exercises.push({ id: "push-up", load: undefined });
  const sessionA = contract.sessions.find((s) => s.key === "A");
  if (!sessionA) throw new Error("fixture has no session A");
  const hostBlock = sessionA.blocks.find((b) => b.tracking !== "checkoff");
  if (!hostBlock) throw new Error("session A has no tracked block");
  hostBlock.exercises.push({ id: "push-up", sets: 2, reps: [8, 12] });

  // Raise the first goblet-squat prescription's top rep by one.
  outer: for (const session of contract.sessions) {
    for (const block of session.blocks) {
      for (const prescription of block.exercises) {
        if (prescription.id === "goblet-squat") {
          prescription.reps = bumpReps(prescription.reps);
          break outer;
        }
      }
    }
  }

  // Drop the last prescription of session A's last block (when it has ≥ 2).
  const lastBlock = sessionA.blocks[sessionA.blocks.length - 1];
  if (lastBlock && lastBlock.exercises.length >= 2) {
    lastBlock.exercises.pop();
  }

  return contract;
}

function buildDocument(contextMd: string, contract: GainContract): string {
  return `${contextMd}\`\`\`gain-plan\n${stringify(contract)}\`\`\`\n`;
}

describe("second import of a revised plan", () => {
  let dataDir: string;
  let userDb: UserDb;
  let parsedV1: ParsedPlan;
  let parsedV2: ParsedPlan;
  let v1Result: ImportPlanSuccess;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-db-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });

    const result = parsePlanDocument(fixtureMd);
    if (!result.ok) throw new Error(`fixture failed to parse: ${result.kind}`);
    parsedV1 = result;

    const imported = importPlan(userDb, { parsed: parsedV1, now: NOW });
    if (!imported.ok) throw new Error("v1 import failed");
    v1Result = imported;

    const v2Source = buildDocument(parsedV1.context_md, buildV2Contract(parsedV1.contract));
    const parsed = parsePlanDocument(v2Source);
    if (!parsed.ok) throw new Error(`v2 failed to parse: ${parsed.kind}`);
    parsedV2 = parsed;
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("reviews as a revision with a correct diff", () => {
    const review = prepareImportReview(userDb, parsedV2);

    expect(review.kind).toBe("revision");
    if (review.kind !== "revision") return;
    expect(review.previous_version).toBe(1);
    expect(review.new_version).toBe(2);

    const { diff } = review;

    // Nothing blocks this import: slug unchanged, version incremented.
    expect(diff.blocking).toHaveLength(0);

    // The new movement is added; nothing was removed from the catalogue.
    expect(diff.exercises.added.some((exercise) => exercise.id === "push-up")).toBe(true);
    expect(diff.exercises.removed).toHaveLength(0);

    // The goblet-squat reps change shows up among the prescription changes.
    const gobletChange = diff.prescriptions.find(
      (prescription) => prescription.id === "goblet-squat" && prescription.status === "changed",
    );
    expect(gobletChange).toBeDefined();
    expect(gobletChange?.changes.some((change) => change.field === "reps")).toBe(true);

    // The added and dropped prescriptions are both visible.
    expect(
      diff.prescriptions.some(
        (prescription) => prescription.id === "push-up" && prescription.status === "added",
      ),
    ).toBe(true);
    expect(diff.prescriptions.filter((p) => p.status === "removed").length).toBeGreaterThan(0);
  });

  it("commits version 2 and moves is_current", () => {
    const review = prepareImportReview(userDb, parsedV2);
    expect(review.kind).toBe("revision");

    const result = importPlan(userDb, { parsed: parsedV2, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.first_import).toBe(false);
    expect(result.version_no).toBe(2);
    expect(result.plan_id).toBe(v1Result.plan_id);

    const versions = listVersions(userDb, result.plan_id);
    expect(versions).toHaveLength(2);
    expect(versions.filter((v) => v.is_current === 1)).toHaveLength(1);
    expect(versions.find((v) => v.is_current === 1)?.version_no).toBe(2);

    // Old versions stay browsable (§8).
    const current = getCurrentVersion(userDb, result.plan_id);
    expect(current?.version_no).toBe(2);
    expect(current?.based_on_version).toBe(1);

    // The v2 source is on disk byte-for-byte, next to v1.
    expect(readSourceMd(userDb, current!)).toBe(parsedV2.source_md);
    expect(fs.existsSync(path.join(userDb.userDir, "plans", "home-training", "v1.md"))).toBe(true);
    expect(fs.existsSync(path.join(userDb.userDir, "plans", "home-training", "v2.md"))).toBe(true);
  });

  it("keeps exercise identity stable across the revision", () => {
    const defsBefore = userDb.db
      .prepare("SELECT slug, id, first_seen_version FROM exercise_def WHERE plan_id = ?")
      .all(v1Result.plan_id) as { slug: string; id: string; first_seen_version: number }[];
    expect(defsBefore).toHaveLength(26);

    const result = importPlan(userDb, { parsed: parsedV2, now: NOW });
    if (!result.ok) throw new Error("v2 import failed");

    const defsAfter = userDb.db
      .prepare(
        "SELECT slug, id, first_seen_version, last_seen_version FROM exercise_def WHERE plan_id = ?",
      )
      .all(v1Result.plan_id) as {
      slug: string;
      id: string;
      first_seen_version: number;
      last_seen_version: number;
    }[];

    // 26 originals + push-up.
    expect(defsAfter).toHaveLength(27);

    // Every original slug kept its id and its first_seen_version.
    for (const before of defsBefore) {
      const after = defsAfter.find((def) => def.slug === before.slug);
      expect(after).toBeDefined();
      expect(after?.id).toBe(before.id);
      expect(after?.first_seen_version).toBe(1);
      expect(after?.last_seen_version).toBe(2);
    }

    const pushUp = defsAfter.find((def) => def.slug === "push-up");
    expect(pushUp?.first_seen_version).toBe(2);
    expect(pushUp?.last_seen_version).toBe(2);
  });

  it("rejects re-importing an old version", () => {
    const v2 = importPlan(userDb, { parsed: parsedV2, now: NOW });
    expect(v2.ok).toBe(true);

    // v1 again: 1 ≤ 2.
    const replayV1 = importPlan(userDb, { parsed: parsedV1, now: NOW });
    expect(replayV1.ok).toBe(false);
    if (!replayV1.ok) {
      expect(replayV1.kind).toBe("version_not_newer");
      expect(replayV1.current_version).toBe(2);
      expect(replayV1.incoming_version).toBe(1);
    }

    // v2 again: 2 ≤ 2.
    const replayV2 = importPlan(userDb, { parsed: parsedV2, now: NOW });
    expect(replayV2.ok).toBe(false);

    expect(listVersions(userDb, v1Result.plan_id)).toHaveLength(2);
  });

  it("flags a slug rename as a possible rename in the review", () => {
    const result = importPlan(userDb, { parsed: parsedV2, now: NOW });
    if (!result.ok) throw new Error("v2 import failed");

    // v3 renames side-plank to side-plank-2 everywhere.
    const contract = structuredClone(parsedV2.contract);
    contract.plan.version = 3;
    contract.plan.based_on_version = 2;
    contract.plan.changelog = ["Renamed side plank"];

    for (const exercise of contract.exercises) {
      if (exercise.id === "side-plank") exercise.id = "side-plank-2";
      exercise.substitutes = exercise.substitutes?.map((slug) =>
        slug === "side-plank" ? "side-plank-2" : slug,
      );
    }
    for (const session of contract.sessions) {
      for (const block of session.blocks) {
        for (const prescription of block.exercises) {
          if (prescription.id === "side-plank") prescription.id = "side-plank-2";
        }
      }
    }

    const parsedV3 = parsePlanDocument(buildDocument(parsedV2.context_md, contract));
    if (!parsedV3.ok) throw new Error(`v3 failed to parse: ${parsedV3.kind}`);

    const review = prepareImportReview(userDb, parsedV3);
    expect(review.kind).toBe("revision");
    if (review.kind !== "revision") return;

    expect(
      review.diff.exercises.possible_renames.some(
        (rename) => rename.from === "side-plank" && rename.to === "side-plank-2",
      ),
    ).toBe(true);
  });
});
