/**
 * The `/account` route: the self-service half of `resetUserData` (ROADMAP "A user can
 * reset their own account."). Driven through the exported `actions.reset`, same level as
 * `tests/server/admin-route.test.ts` drives `/admin`'s.
 *
 * Three things must hold: a wrong (or case-differing) confirmation writes nothing and
 * fails with 400 rather than throwing; a correct one wipes the account, bumps the
 * generation, and — when the request carried a real session cookie — re-mints a fresh
 * session with the same tokens so the caller is not left signed out; and a request with
 * no session to re-mint (the dev bypass shape) skips that step cleanly rather than
 * erroring.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { actions } from "../../src/routes/account/+page.server";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { importPlan } from "../../src/lib/db/import-plan";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import {
  createSession,
  createUser,
  getDataGeneration,
  getSession,
  type ControlUser,
} from "../../src/lib/server/control-db";
import { getControlDb, resetAppStateForTests } from "../../src/lib/server/app-state";
import { getConfig, resetConfigForTests } from "../../src/lib/server/config";
import { SESSION_COOKIE, signSessionId } from "../../src/lib/server/session-cookie";
import { statsForUsers } from "../../src/lib/server/admin-stats";

const fixtureMd = fs.readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const NOW = new Date("2026-08-27T09:00:00Z");
// `Actions` is `Record<string, Action>`, so a bare `actions.reset` is possibly undefined
// even though the route always defines it (matches `tests/server/admin-route.test.ts`).
const reset = actions.reset!;

function seedPlan(userDb: UserDb): void {
  const parsed = parsePlanDocument(fixtureMd);
  if (!parsed.ok) throw new Error(`fixture failed to parse (${parsed.kind}):\n${parsed.report}`);
  const result = importPlan(userDb, { parsed, now: NOW });
  if (!result.ok) throw new Error(`fixture failed to import: ${result.message}`);
}

function statsFor(dataDir: string, user: ControlUser) {
  const [row] = statsForUsers(dataDir, [user]);
  if (!row) throw new Error(`expected a stats row for ${user.id}`);
  return row;
}

/** A minimal cookie jar: a fixed value for `get`, and a spy for `set`. */
function cookieJar(initial: string | undefined) {
  const sets: { name: string; value: string }[] = [];
  return {
    get: (name: string) => (name === SESSION_COOKIE ? initial : undefined),
    set: (name: string, value: string) => {
      sets.push({ name, value });
    },
    sets,
  };
}

function event(
  user: { id: string } | null,
  fields: Record<string, string>,
  cookies: ReturnType<typeof cookieJar>,
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return {
    locals: { user: user && { ...user, bypass: false, displayName: null, isAdmin: false } },
    cookies,
    request: { formData: () => Promise.resolve(form) },
  } as never;
}

let dataDir: string;
let subject: ControlUser;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-account-route-"));
  process.env.DATA_DIR = dataDir;
  process.env.GAIN_DEV_USER = "tester";
  process.env.SESSION_SECRET = "test-account-route-secret";
  delete process.env.OIDC_ISSUER;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_CLIENT_SECRET;
  delete process.env.OIDC_REQUIRED_GROUP;
  delete process.env.OIDC_ADMIN_GROUP;
  resetConfigForTests();
  resetAppStateForTests();

  const control = getControlDb();
  subject = createUser(control, "sub-subject", NOW);

  const subjectDb = openUserDb(dataDir, subject.id, { now: NOW });
  seedPlan(subjectDb);
  subjectDb.close();
});

afterEach(() => {
  resetAppStateForTests();
  resetConfigForTests();
  delete process.env.DATA_DIR;
  delete process.env.GAIN_DEV_USER;
  delete process.env.SESSION_SECRET;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("/account reset action", () => {
  it("rejects a missing session with a redirect", async () => {
    await expect(
      reset(event(null, { confirm: "RESET" }, cookieJar(undefined))),
    ).rejects.toMatchObject({
      status: 303,
    });
  });

  it("writes nothing on a wrong confirmation", async () => {
    const result = await reset(event(subject, { confirm: "nope" }, cookieJar(undefined)));
    expect(result).toMatchObject({ status: 400, data: { actionError: expect.any(String) } });
    expect(statsFor(dataDir, subject).plans).toBe(1);
  });

  it("accepts the confirmation case-insensitively and wipes the account", async () => {
    expect(statsFor(dataDir, subject).plans).toBe(1);

    const result = await reset(event(subject, { confirm: "  reset  " }, cookieJar(undefined)));
    expect(result).toMatchObject({ reset: true });

    const after = statsFor(dataDir, subject);
    expect(after.provisioned).toBe(true);
    expect(after.plans).toBe(0);
    expect(getDataGeneration(getControlDb(), subject.id)).toBe(1);
  });

  it("skips re-minting when there is no session to find (dev bypass shape)", async () => {
    const cookies = cookieJar(undefined);
    const result = await reset(event(subject, { confirm: "RESET" }, cookies));
    expect(result).toMatchObject({ reset: true });
    expect(cookies.sets).toHaveLength(0);
  });

  it("re-mints a fresh session with the old tokens when one was found", async () => {
    const control = getControlDb();
    const original = createSession(control, {
      userId: subject.id,
      now: NOW,
      idleMs: 60_000,
      tokens: {
        access_token: "at-1",
        access_expires_at: null,
        refresh_token: "rt-1",
        id_token: "idt-1",
      },
      isAdmin: false,
    });

    const config = getConfig();
    const cookies = cookieJar(signSessionId(config.sessionSecret, original.id));

    const result = await reset(event(subject, { confirm: "RESET" }, cookies));
    expect(result).toMatchObject({ reset: true });

    // The old session row is gone — `resetUserData` signs everyone out first.
    expect(getSession(control, original.id, NOW)).toBeUndefined();

    // A new cookie was set, and it verifies to a session id different from the old one,
    // carrying the same tokens forward.
    expect(cookies.sets).toHaveLength(1);
    const set = cookies.sets[0]!;
    expect(set.name).toBe(SESSION_COOKIE);
    const dot = set.value.lastIndexOf(".");
    const newSessionId = set.value.slice(0, dot);
    expect(newSessionId).not.toBe(original.id);

    const fresh = getSession(control, newSessionId, NOW);
    expect(fresh?.access_token).toBe("at-1");
    expect(fresh?.refresh_token).toBe("rt-1");
    expect(fresh?.id_token).toBe("idt-1");
  });
});
