import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { replayOps } from "../../src/lib/sync/replay";
import type { SyncOp } from "../../src/lib/sync/ops";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");
const NOW = new Date("2026-09-08T08:00:00Z");
const W = "01JZ000000000000000000000W";

/** Slugs the fixture really defines — an op naming anything else is a *permanent*
 * failure, which is a different property and belongs in the example-based suite. */
const SLUGS = ["goblet-squat", "dead-bug", "bird-dog"] as const;

type Harness = { userDb: UserDb; planVersionId: string; dataDir: string };

function freshDb(): Harness {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-replay-prop-"));
  const userDb = openUserDb(dataDir, "user-1", { now: NOW });
  const parsed = parsePlanDocument(fixtureMd);
  if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
  const result = importPlan(userDb, { parsed, now: NOW });
  if (!result.ok) throw new Error(result.message);
  return { userDb, planVersionId: result.plan_version_id, dataDir };
}

function dispose(harness: Harness): void {
  harness.userDb.close();
  fs.rmSync(harness.dataDir, { recursive: true, force: true });
}

/**
 * A copy of `ops` with only the `start` op's `planVersionId` rewritten to `harness`'s
 * real one. Every op log is generated once against an arbitrary placeholder id (see
 * `opLog` below), but each harness is its own database with its own `plan_version.id`
 * — `importPlan` mints that id via the shared, module-level `monotonicFactory()` in
 * `src/lib/db/ulid.ts`, so two separate `freshDb()` calls never produce the same one,
 * even from byte-identical fixture content. Replaying a `start` op that names a
 * `plan_version.id` foreign to the target database trips the `plan_version_id`
 * foreign key (`schema.ts`, `workout` table) — caught by `replayOps` as an ordinary
 * per-op failure, not thrown — so the workout silently never starts and every "set"
 * op after it silently stays pending forever. Rewriting only this one field on the
 * `start` op, and nothing else about the log's shape, keeps that from happening
 * without changing anything fast-check is exploring.
 */
function forHarness(ops: readonly SyncOp[], harness: Harness): SyncOp[] {
  return ops.map((op) =>
    op.kind === "start" ? { ...op, planVersionId: harness.planVersionId } : op,
  );
}

/** A ULID-shaped, sortable id from an index. */
function opId(n: number): string {
  return `01JZ${String(n).padStart(22, "0")}`;
}

function setLogClientIds(userDb: UserDb): string[] {
  const rows = userDb.db.prepare("SELECT client_id FROM set_log ORDER BY client_id").all() as {
    client_id: string;
  }[];
  return rows.map((row) => row.client_id);
}

/** A valid op log for one workout: a start, some sets, and maybe a finish. */
const opLog = (planVersionId: string) =>
  fc
    .array(
      fc.record({
        slug: fc.constantFrom(...SLUGS),
        reps: fc.integer({ min: 1, max: 20 }),
        weightKg: fc.integer({ min: 0, max: 40 }),
      }),
      { minLength: 1, maxLength: 20 },
    )
    .map((sets): SyncOp[] => [
      {
        kind: "start",
        id: opId(0),
        workoutClientId: W,
        planVersionId,
        sessionKey: "A",
        startedAt: "2026-09-08T08:00:00.000Z",
      },
      ...sets.map((set, index): SyncOp => ({
        kind: "set",
        id: opId(index + 1),
        workoutClientId: W,
        exerciseSlug: set.slug,
        setNo: index + 1,
        reps: set.reps,
        weightKg: set.weightKg,
        difficulty: "medium",
      })),
    ]);

describe("replay properties", () => {
  it("is order-independent: a shuffled delivery lands the same rows as an ordered one", () => {
    const reference = freshDb();
    try {
      fc.assert(
        fc.property(opLog(reference.planVersionId), fc.array(fc.nat()), (ops, shuffleSeed) => {
          const ordered = freshDb();
          const shuffled = freshDb();
          try {
            const permuted = [...ops].sort(
              (a, b) => (shuffleSeed[ops.indexOf(a)] ?? 0) - (shuffleSeed[ops.indexOf(b)] ?? 0),
            );
            replayOps(ordered.userDb, forHarness(ops, ordered));
            replayOps(shuffled.userDb, forHarness(permuted, shuffled));
            expect(setLogClientIds(shuffled.userDb)).toEqual(setLogClientIds(ordered.userDb));
          } finally {
            dispose(ordered);
            dispose(shuffled);
          }
        }),
        { numRuns: 50 },
      );
    } finally {
      dispose(reference);
    }
  });

  it("never duplicates a set, however many times a batch is re-delivered", () => {
    const reference = freshDb();
    try {
      fc.assert(
        fc.property(
          opLog(reference.planVersionId),
          fc.integer({ min: 1, max: 4 }),
          (ops, redeliveries) => {
            const harness = freshDb();
            try {
              const rewritten = forHarness(ops, harness);
              for (let i = 0; i < redeliveries; i += 1) {
                replayOps(harness.userDb, rewritten);
              }
              const ids = setLogClientIds(harness.userDb);
              const expected = ops
                .filter((op) => op.kind === "set")
                .map((op) => op.id)
                .sort();
              expect(ids).toEqual(expected);
            } finally {
              dispose(harness);
            }
          },
        ),
        { numRuns: 50 },
      );
    } finally {
      dispose(reference);
    }
  });

  it("loses nothing when the log is split into arbitrary batches", () => {
    const reference = freshDb();
    try {
      fc.assert(
        fc.property(
          opLog(reference.planVersionId),
          fc.integer({ min: 1, max: 5 }),
          (ops, batchSize) => {
            const harness = freshDb();
            try {
              const rewritten = forHarness(ops, harness);
              for (let i = 0; i < rewritten.length; i += batchSize) {
                replayOps(harness.userDb, rewritten.slice(i, i + batchSize));
              }
              const expected = ops
                .filter((op) => op.kind === "set")
                .map((op) => op.id)
                .sort();
              expect(setLogClientIds(harness.userDb)).toEqual(expected);
            } finally {
              dispose(harness);
            }
          },
        ),
        { numRuns: 50 },
      );
    } finally {
      dispose(reference);
    }
  });

  it("invents nothing: a prefix of the log writes only that prefix's rows", () => {
    const reference = freshDb();
    try {
      fc.assert(
        fc.property(opLog(reference.planVersionId), fc.nat(), (ops, cut) => {
          const harness = freshDb();
          try {
            const rewritten = forHarness(ops, harness);
            const prefix = rewritten.slice(0, (cut % rewritten.length) + 1);
            replayOps(harness.userDb, prefix);
            const expected = prefix
              .filter((op) => op.kind === "set")
              .map((op) => op.id)
              .sort();
            expect(setLogClientIds(harness.userDb)).toEqual(expected);
          } finally {
            dispose(harness);
          }
        }),
        { numRuns: 50 },
      );
    } finally {
      dispose(reference);
    }
  });
});
