/**
 * The `/admin` route (spec §8): a non-admin gets 404, not 403, on both the page and the
 * reset action, and the reset action fails with 400 rather than throwing on a bad
 * confirmation or a user id that no longer exists.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isHttpError } from "@sveltejs/kit";
import { actions as adminActions, load } from "../../src/routes/admin/+page.server";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { importPlan } from "../../src/lib/db/import-plan";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import {
  openControlDb,
  createUser,
  setDisplayLabel,
  type ControlUser,
} from "../../src/lib/server/control-db";
import { resetAppStateForTests } from "../../src/lib/server/app-state";
import { resetConfigForTests } from "../../src/lib/server/config";

const fixtureMd = fs.readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const NOW = new Date("2026-08-17T09:00:00Z");
// `Actions` is `Record<string, Action>`, so `noUncheckedIndexedAccess` makes a bare
// `adminActions.reset` possibly undefined even though the route always defines it.
const reset = adminActions.reset!;

function seedPlan(userDb: UserDb): void {
  const parsed = parsePlanDocument(fixtureMd);
  if (!parsed.ok) throw new Error(`fixture failed to parse (${parsed.kind}):\n${parsed.report}`);
  const result = importPlan(userDb, { parsed, now: NOW });
  if (!result.ok) throw new Error(`fixture failed to import: ${result.message}`);
}

function event(user: { id: string; isAdmin: boolean } | null, fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return {
    locals: { user: user && { ...user, bypass: true, displayName: null } },
    request: { formData: () => Promise.resolve(form) },
  } as never;
}

let dataDir: string;
let admin: ControlUser;
let subject: ControlUser;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-admin-route-"));
  process.env.DATA_DIR = dataDir;
  process.env.GAIN_DEV_USER = "tester";
  delete process.env.OIDC_ISSUER;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_CLIENT_SECRET;
  delete process.env.OIDC_REQUIRED_GROUP;
  delete process.env.OIDC_ADMIN_GROUP;
  resetConfigForTests();
  resetAppStateForTests();

  const control = openControlDb(dataDir, NOW);
  admin = createUser(control, "sub-admin", NOW);
  subject = createUser(control, "sub-subject", NOW);
  setDisplayLabel(control, subject.id, "subject");
  control.close();

  const subjectDb = openUserDb(dataDir, subject.id, { now: NOW });
  seedPlan(subjectDb);
  subjectDb.close();
});

afterEach(() => {
  resetAppStateForTests();
  resetConfigForTests();
  delete process.env.DATA_DIR;
  delete process.env.GAIN_DEV_USER;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** `load` throws synchronously (no `await` in it); unwrap that rather than let it escape. */
function expectNotFound(run: () => unknown): void {
  try {
    run();
  } catch (err) {
    expect(isHttpError(err) && err.status === 404).toBe(true);
    return;
  }
  throw new Error("expected a 404, but the call returned normally");
}

describe("the /admin guard", () => {
  it("404s for a signed-in non-admin", () => {
    expectNotFound(() => load(event({ id: "u1", isAdmin: false })));
  });

  it("404s for an anonymous request", () => {
    expectNotFound(() => load(event(null)));
  });

  it("404s the reset action too, not just the page", async () => {
    // A guard on `load` alone leaves the action reachable by anyone who can POST.
    await expect(
      reset(event({ id: "u1", isAdmin: false }, { userId: "u2", confirmLabel: "x" })),
    ).rejects.toSatisfy((err: unknown) => isHttpError(err) && err.status === 404);
  });
});

describe("the reset action", () => {
  it("fails with 400 rather than throwing when the confirmation is wrong", async () => {
    const result = await reset(
      event({ id: admin.id, isAdmin: true }, { userId: subject.id, confirmLabel: "wrong" }),
    );
    expect(result).toMatchObject({ status: 400 });
    expect((result as { data: { actionError: string } }).data.actionError).toContain(
      "does not match",
    );
  });

  it("fails with 400 for a user id that no longer exists", async () => {
    const result = await reset(
      event({ id: admin.id, isAdmin: true }, { userId: "gone", confirmLabel: "gone" }),
    );
    expect(result).toMatchObject({ status: 400 });
  });

  it("resets when the confirmation matches exactly", async () => {
    const result = await reset(
      event({ id: admin.id, isAdmin: true }, { userId: subject.id, confirmLabel: "subject" }),
    );
    expect(result).toMatchObject({ resetLabel: "subject" });
  });
});
