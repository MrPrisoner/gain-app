/**
 * The per-user reset (spec §6). The order of its steps is what these tests are
 * really about: sessions before the wipe, the cached handle closed before the
 * unlink, and a re-provision afterwards so the user comes back to a working
 * empty instance rather than a broken one.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { importPlan } from "../../src/lib/db/import-plan";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { resetUserData } from "../../src/lib/server/admin-reset";
import {
  openControlDb,
  createUser,
  createSession,
  getSession,
} from "../../src/lib/server/control-db";
import { getUserDbFor, resetAppStateForTests } from "../../src/lib/server/app-state";
import { resetConfigForTests } from "../../src/lib/server/config";
import { statsForUsers } from "../../src/lib/server/admin-stats";

const fixtureMd = fs.readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const NOW = new Date("2026-08-17T09:00:00Z");
const NO_TOKENS = {
  access_token: null,
  access_expires_at: null,
  refresh_token: null,
  id_token: null,
};

function seedPlan(userDb: UserDb): void {
  const parsed = parsePlanDocument(fixtureMd);
  if (!parsed.ok) throw new Error(`fixture failed to parse (${parsed.kind}):\n${parsed.report}`);
  const result = importPlan(userDb, { parsed, now: NOW });
  if (!result.ok) throw new Error(`fixture failed to import: ${result.message}`);
}

/** The one stats row for `userId`, or a loud failure — never a silent undefined. */
function statsFor(dataDir: string, user: Parameters<typeof statsForUsers>[1][number]) {
  const [row] = statsForUsers(dataDir, [user]);
  if (!row) throw new Error(`expected a stats row for ${user.id}`);
  return row;
}

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-admin-reset-"));
  process.env.DATA_DIR = dataDir;
  process.env.GAIN_DEV_USER = "tester";
  delete process.env.OIDC_ISSUER;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_CLIENT_SECRET;
  delete process.env.OIDC_REQUIRED_GROUP;
  delete process.env.OIDC_ADMIN_GROUP;
  resetConfigForTests();
  resetAppStateForTests();
});

afterEach(() => {
  resetAppStateForTests();
  resetConfigForTests();
  delete process.env.DATA_DIR;
  delete process.env.GAIN_DEV_USER;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("resetUserData", () => {
  it("wipes the directory, bumps the generation, and re-provisions", () => {
    const control = openControlDb(dataDir, NOW);
    const user = createUser(control, "sub-a", NOW);
    const db = openUserDb(dataDir, user.id, { now: NOW, seedTemplates: [] });
    seedPlan(db);
    db.close();

    expect(statsFor(dataDir, user).plans).toBe(1);

    const { generation } = resetUserData(control, dataDir, user.id);
    expect(generation).toBe(1);

    const after = statsFor(dataDir, user);
    expect(after.provisioned).toBe(true);
    expect(after.plans).toBe(0);
    expect(after.setLogs).toBe(0);
    control.close();
  });

  it("signs the user out everywhere", () => {
    const control = openControlDb(dataDir, NOW);
    const user = createUser(control, "sub-a", NOW);
    openUserDb(dataDir, user.id, { now: NOW, seedTemplates: [] }).close();
    const session = createSession(control, {
      userId: user.id,
      now: NOW,
      idleMs: 60_000,
      tokens: NO_TOKENS,
      isAdmin: false,
    });

    resetUserData(control, dataDir, user.id);
    expect(getSession(control, session.id, NOW)).toBeUndefined();
    control.close();
  });

  it("closes the cached handle before unlinking, so the fresh db is genuinely empty", () => {
    const control = openControlDb(dataDir, NOW);
    const user = createUser(control, "sub-a", NOW);
    // Warm the process-wide cache the way a live request would.
    seedPlan(getUserDbFor(user.id));

    resetUserData(control, dataDir, user.id);

    // A stale handle would still answer from the deleted inode and report 1.
    const fresh = getUserDbFor(user.id);
    const n = fresh.db.prepare("SELECT COUNT(*) AS n FROM plan").get() as { n: number };
    expect(n.n).toBe(0);
    control.close();
  });

  it("leaves another user untouched", () => {
    const control = openControlDb(dataDir, NOW);
    const a = createUser(control, "sub-a", NOW);
    const b = createUser(control, "sub-b", NOW);
    for (const id of [a.id, b.id]) {
      const db = openUserDb(dataDir, id, { now: NOW, seedTemplates: [] });
      seedPlan(db);
      db.close();
    }

    resetUserData(control, dataDir, a.id);

    expect(statsFor(dataDir, b).plans).toBe(1);
    control.close();
  });
});
