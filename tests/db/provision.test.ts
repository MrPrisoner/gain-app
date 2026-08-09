/**
 * Per-user provisioning: the §3 directory layout, migrations, and template
 * seeding.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appliedSchemaVersion } from "../../src/lib/db/migrate";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";

const NOW = new Date("2026-09-08T08:00:00Z");

describe("openUserDb", () => {
  let dataDir: string;
  let userDb: UserDb | undefined;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-db-test-"));
  });

  afterEach(() => {
    userDb?.close();
    userDb = undefined;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates the §3 directory layout", () => {
    userDb = openUserDb(dataDir, "user-1", { now: NOW });

    expect(fs.existsSync(path.join(userDb.userDir, "gain.db"))).toBe(true);
    expect(fs.statSync(path.join(userDb.userDir, "plans")).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(userDb.userDir, "exports")).isDirectory()).toBe(true);
    expect(userDb.dbPath).toBe(path.join(dataDir, "users", "user-1", "gain.db"));
  });

  it("applies migrations and records them", () => {
    userDb = openUserDb(dataDir, "user-1", { now: NOW });

    expect(appliedSchemaVersion(userDb.db)).toBe(1);

    const rows = userDb.db
      .prepare("SELECT version, name, applied_at FROM _gain_migration")
      .all() as { version: number; name: string; applied_at: string }[];
    expect(rows).toEqual([{ version: 1, name: "domain-model-v1", applied_at: NOW.toISOString() }]);
  });

  it("is idempotent — reopening migrates forward without duplicating", () => {
    userDb = openUserDb(dataDir, "user-1", { now: NOW });
    userDb.close();

    userDb = openUserDb(dataDir, "user-1", { now: new Date("2026-09-09T08:00:00Z") });
    expect(appliedSchemaVersion(userDb.db)).toBe(1);

    const count = userDb.db.prepare("SELECT COUNT(*) AS n FROM _gain_migration").get() as {
      n: number;
    };
    expect(count.n).toBe(1);
  });

  it("seeds templates only when the user has none", () => {
    userDb = openUserDb(dataDir, "user-1", {
      now: NOW,
      seedTemplates: [{ name: "default", body_md: "# Instructions", is_default: true }],
    });

    const rows = userDb.db.prepare("SELECT name, body_md, is_default FROM ai_template").all() as {
      name: string;
      body_md: string;
      is_default: number;
    }[];
    expect(rows).toEqual([{ name: "default", body_md: "# Instructions", is_default: 1 }]);

    userDb.close();

    // Reopening with a different seed must not reseed.
    userDb = openUserDb(dataDir, "user-1", {
      now: NOW,
      seedTemplates: [{ name: "other", body_md: "nope", is_default: true }],
    });
    const after = userDb.db.prepare("SELECT name FROM ai_template").all() as { name: string }[];
    expect(after).toEqual([{ name: "default" }]);
  });

  it("enables foreign keys", () => {
    userDb = openUserDb(dataDir, "user-1", { now: NOW });
    const row = userDb.db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });

  it("rejects user ids that could escape the user directory", () => {
    for (const bad of ["../evil", "a/b", "", " ".repeat(3), "x".repeat(129), "a\\b", "a.b"]) {
      expect(() => openUserDb(dataDir, bad, { now: NOW })).toThrow(/invalid user id/);
    }
  });

  it("isolates users physically", () => {
    userDb = openUserDb(dataDir, "user-1", { now: NOW });
    const second = openUserDb(dataDir, "user-2", { now: NOW });

    expect(userDb.userDir).not.toBe(second.userDir);
    expect(fs.existsSync(path.join(dataDir, "users", "user-2", "gain.db"))).toBe(true);

    second.close();
  });
});
