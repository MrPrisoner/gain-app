/**
 * The offline-sync idempotency column, asserted structurally.
 *
 * CLAUDE.md's invariant: "every table the client writes to — `workout`, `set_log`,
 * `metric_value`, `deviation`, `activity` — carries a `client_id TEXT UNIQUE`, and any
 * new log table needs one. A log table without that column looks fine until the day a
 * queue is replayed, and then it silently doubles someone's history."
 *
 * Nothing else in the suite reads the DDL. Idempotency is achieved in application code
 * by `selectByClientId`-then-insert (`src/lib/db/workout.ts`), so dropping the UNIQUE
 * constraint breaks no existing test — every idempotency test still passes, because none
 * performs a raw duplicate insert. That makes the constraint documentation rather than a
 * guarantee, and leaves the forward-looking half of the invariant — a *sixth* log table
 * added without the column — enforced by nothing at all.
 *
 * So this reads `sqlite_master` on a freshly-migrated database and asserts the column and
 * its uniqueness directly, table by table. It fails on a dropped constraint, and it fails
 * on a new writable log table that forgets one.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";

const NOW = new Date("2026-09-08T08:00:00Z");

/** Every table the offline outbox replays into. */
const CLIENT_WRITTEN_TABLES = ["workout", "set_log", "metric_value", "deviation", "activity"];

describe("client-written log tables", () => {
  let dataDir: string;
  let userDb: UserDb | undefined;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-log-tables-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });
  });

  afterEach(() => {
    userDb?.close();
    userDb = undefined;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  for (const table of CLIENT_WRITTEN_TABLES) {
    it(`${table} carries client_id, declared TEXT`, () => {
      const columns = userDb!.db.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
        type: string;
      }[];
      const clientId = columns.find((c) => c.name === "client_id");
      expect(clientId, `${table} has no client_id column`).toBeDefined();
      expect(clientId!.type.toUpperCase()).toBe("TEXT");
    });

    it(`${table}.client_id is UNIQUE`, () => {
      // SQLite implements a column-level UNIQUE as an auto-index, which `index_list`
      // reports with `origin: "u"`. Asserting through the index rather than by matching
      // the DDL text means a constraint declared table-level (`UNIQUE(client_id)`) or
      // via a separate `CREATE UNIQUE INDEX` counts too — it is the property that
      // matters, not the spelling.
      const indexes = userDb!.db.prepare(`PRAGMA index_list(${table})`).all() as {
        name: string;
        unique: number;
      }[];
      const uniqueOnClientId = indexes
        .filter((i) => i.unique === 1)
        .some((i) => {
          const cols = userDb!.db.prepare(`PRAGMA index_info(${i.name})`).all() as {
            name: string | null;
          }[];
          return cols.length === 1 && cols[0]?.name === "client_id";
        });
      expect(uniqueOnClientId, `${table}.client_id is not UNIQUE`).toBe(true);
    });
  }

  /**
   * The forward-looking half of the invariant: "any new log table needs one."
   *
   * `src/lib/db/workout.ts` is the module the sync replay writes every op through — the
   * replay itself delegates rather than issuing SQL — so its `INSERT INTO` targets are
   * the authoritative set of client-written tables. Scanning it means a sixth log table
   * cannot be added without either appearing here or failing this test.
   */
  it("covers every table the sync write path inserts into", () => {
    const source = fs.readFileSync(new URL("../../src/lib/db/workout.ts", import.meta.url), "utf8");
    const written = [...source.matchAll(/INSERT\s+INTO\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase());
    // Guard against the scan silently matching nothing and passing vacuously — the exact
    // failure mode `e2e/progress-walkthrough.spec.ts` was rewritten to avoid.
    expect(new Set(written).size).toBe(CLIENT_WRITTEN_TABLES.length);
    for (const table of written) {
      expect(
        CLIENT_WRITTEN_TABLES,
        `${table} is written by the sync write path but is not covered here — it needs ` +
          `a client_id TEXT UNIQUE column and an entry in CLIENT_WRITTEN_TABLES.`,
      ).toContain(table);
    }
  });
});
