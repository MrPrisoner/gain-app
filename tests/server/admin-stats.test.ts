/**
 * The count-only cross-user reader (spec §5). These tests are the guarantee that
 * ARCHITECTURE §4 still holds with an operator screen in the app: what leaves this
 * module is counts, dates and byte totals, and never a row of anyone's training data.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { importPlan } from "../../src/lib/db/import-plan";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { CURRENT_SCHEMA_VERSION, statsForUsers } from "../../src/lib/server/admin-stats";
import type { ControlUser } from "../../src/lib/server/control-db";

const fixtureMd = fs.readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const NOW = new Date("2026-08-17T09:00:00Z");

/** Import the fixture plan as version 1. Throws loudly rather than half-seeding. */
function seedPlan(userDb: UserDb): void {
  const parsed = parsePlanDocument(fixtureMd);
  if (!parsed.ok) throw new Error(`fixture failed to parse (${parsed.kind}):\n${parsed.report}`);
  const result = importPlan(userDb, { parsed, now: NOW });
  if (!result.ok) throw new Error(`fixture failed to import: ${result.message}`);
}

function user(id: string): ControlUser {
  return {
    id,
    oidc_sub: `sub-${id}`,
    created_at: "2026-01-01T00:00:00.000Z",
    last_login_at: "2026-08-17T00:00:00.000Z",
    display_label: id,
    data_generation: 0,
  };
}

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-admin-stats-"));
});
afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("statsForUsers", () => {
  it("reports a zeroed, unprovisioned record for a user with no directory", () => {
    const [stats] = statsForUsers(dataDir, [user("ghost")]);
    expect(stats).toMatchObject({
      userId: "ghost",
      provisioned: false,
      plans: 0,
      workoutsStarted: 0,
      setLogs: 0,
      lastWorkoutAt: null,
      diskBytes: 0,
    });
  });

  it("counts a provisioned user's plans without reading their content", () => {
    const db = openUserDb(dataDir, "alice", { now: NOW });
    seedPlan(db);
    db.close();

    const [stats] = statsForUsers(dataDir, [user("alice")]);
    if (!stats) throw new Error("expected a stats row for alice");
    expect(stats.provisioned).toBe(true);
    expect(stats.plans).toBe(1);
    expect(stats.planVersions).toBe(1);
    expect(stats.workoutsStarted).toBe(0);
    expect(stats.diskBytes).toBeGreaterThan(0);
    // Nothing the plan says reaches the operator — not its name, not a slug.
    const serialised = JSON.stringify(stats);
    expect(serialised).not.toContain("Home");
    expect(serialised).not.toContain("goblet");
  });

  it("opens a cold WAL database that has never been written to", () => {
    // Provision and close immediately: no -shm exists on disk. A readonly open of a
    // WAL database can fail here with SQLITE_CANTOPEN, so the module must fall back.
    openUserDb(dataDir, "cold", { now: NOW }).close();
    fs.rmSync(path.join(dataDir, "users", "cold", "gain.db-shm"), { force: true });
    fs.rmSync(path.join(dataDir, "users", "cold", "gain.db-wal"), { force: true });

    expect(() => statsForUsers(dataDir, [user("cold")])).not.toThrow();
    expect(statsForUsers(dataDir, [user("cold")])[0]?.plans).toBe(0);
  });

  it("keeps one user's counts out of another's", () => {
    const db = openUserDb(dataDir, "alice", { now: NOW });
    seedPlan(db);
    db.close();
    openUserDb(dataDir, "bob", { now: NOW }).close();

    const stats = statsForUsers(dataDir, [user("alice"), user("bob")]);
    expect(stats.find((s) => s.userId === "alice")?.plans).toBe(1);
    expect(stats.find((s) => s.userId === "bob")?.plans).toBe(0);
  });

  it("reports null schemaVersion for an unprovisioned user and the applied version for a real one", () => {
    openUserDb(dataDir, "fresh", { now: NOW }).close();

    const stats = statsForUsers(dataDir, [user("ghost"), user("fresh")]);
    expect(stats.find((s) => s.userId === "ghost")?.schemaVersion).toBeNull();
    // A freshly provisioned database has run every migration this build knows about —
    // that is what `openUserDb` guarantees, and it is the fact CURRENT_SCHEMA_VERSION
    // exists to name.
    expect(stats.find((s) => s.userId === "fresh")?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});
