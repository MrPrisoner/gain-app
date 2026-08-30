/**
 * Plan archiving, at the route boundary. Semantics settled 2026-08-23.
 *
 * The interesting assertions are all about the *asymmetry*: archiving takes a plan off
 * the active Home list and closes the two inbound write paths — starting a session and
 * committing a revision — while leaving every read path open. Shipping the button
 * against the 404s that used to guard export/history/progress would have made archiving
 * a silent, unrecoverable loss of the user's own logged history, so the read routes
 * staying open is the load-bearing half, not an afterthought.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isHttpError } from "@sveltejs/kit";
import { actions as homeActions, load as homeLoad } from "../../src/routes/+page.server";
import { load as sessionLoad } from "../../src/routes/plan/[slug]/session/[key]/+page.server";
import { load as historyLoad } from "../../src/routes/plan/[slug]/history/+page.server";
import { load as exportLoad } from "../../src/routes/plan/[slug]/export/+page.server";
import { actions as importActions } from "../../src/routes/import/+page.server";
import { archivePlan } from "../../src/lib/db/archive";
import { importPlan } from "../../src/lib/db/import-plan";
import { getPlanBySlug } from "../../src/lib/db/read";
import { openUserDb } from "../../src/lib/db/user-db";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { openControlDb, createUser, type ControlUser } from "../../src/lib/server/control-db";
import { getUserDbFor, resetAppStateForTests } from "../../src/lib/server/app-state";
import { resetConfigForTests } from "../../src/lib/server/config";

const v1Md = fs.readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const v2Md = fs.readFileSync("fixtures/plans/home-training-v2.md", "utf8");
const NOW = new Date("2026-09-08T08:00:00Z");

// `Actions` is `Record<string, Action>`, so `noUncheckedIndexedAccess` makes a bare
// lookup possibly undefined even though the routes always define these.
const archive = homeActions.archive!;
const unarchive = homeActions.unarchive!;
const importCheck = importActions.check!;
const importCommit = importActions.commit!;

let dataDir: string;
let user: ControlUser;

function locals() {
  return { user: { id: user.id, isAdmin: false, bypass: true, displayName: null } };
}

function pageEvent(params: Record<string, string> = {}) {
  return { params, locals: locals(), url: new URL("http://localhost/") } as never;
}

function formEvent(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return { locals: locals(), request: { formData: () => Promise.resolve(form) } } as never;
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-archive-route-"));
  process.env.DATA_DIR = dataDir;
  process.env.GAIN_DEV_USER = "tester";
  resetConfigForTests();
  resetAppStateForTests();

  const control = openControlDb(dataDir, NOW);
  user = createUser(control, "sub-tester", NOW);
  control.close();

  const userDb = openUserDb(dataDir, user.id, { now: NOW });
  const parsed = parsePlanDocument(v1Md);
  if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
  const result = importPlan(userDb, { parsed, now: NOW });
  if (!result.ok) throw new Error(result.message);
  userDb.close();
});

afterEach(() => {
  resetAppStateForTests();
  resetConfigForTests();
  delete process.env.DATA_DIR;
  delete process.env.GAIN_DEV_USER;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("the Home archive actions", () => {
  it("moves a plan out of the active list and into the archived group, and back", async () => {
    const before = homeLoad(pageEvent()) as { view: string; plans: unknown[]; archived: unknown[] };
    expect(before.view).toBe("plan");
    expect(before.plans).toHaveLength(1);
    expect(before.archived).toHaveLength(0);

    await archive(formEvent({ slug: "home-training" }));

    const archived = homeLoad(pageEvent()) as {
      view: string;
      plans: unknown[];
      archived: { slug: string }[];
    };
    // Still the plan view, not first run: a user who archives their only plan must land
    // somewhere that can reach it, and the bootstrap interview would read as deletion.
    expect(archived.view).toBe("plan");
    expect(archived.plans).toHaveLength(0);
    expect(archived.archived.map((p) => p.slug)).toEqual(["home-training"]);

    await unarchive(formEvent({ slug: "home-training" }));

    const restored = homeLoad(pageEvent()) as { plans: unknown[]; archived: unknown[] };
    expect(restored.plans).toHaveLength(1);
    expect(restored.archived).toHaveLength(0);
  });

  it("fails rather than throws on a slug that cannot be archived", async () => {
    // A form action that throws is a 500, and a 500 on Home is a wall where a sentence
    // would do (CLAUDE.md, "What the phase-4 review changed").
    const result = (await archive(formEvent({ slug: "no-such-plan" }))) as { status: number };
    expect(result.status).toBe(404);
    const second = (await unarchive(formEvent({ slug: "home-training" }))) as { status: number };
    expect(second.status).toBe(404);
  });
});

describe("what an archived plan still opens", () => {
  beforeEach(() => {
    archivePlan(getUserDbFor(user.id), "home-training", NOW);
  });

  it("keeps history and export open, marked archived", () => {
    const history = historyLoad(pageEvent({ slug: "home-training" })) as { planArchived: boolean };
    expect(history.planArchived).toBe(true);

    const exported = exportLoad(pageEvent({ slug: "home-training" })) as { planArchived: boolean };
    expect(exported.planArchived).toBe(true);
  });

  it("refuses to start a new session", async () => {
    try {
      await sessionLoad(pageEvent({ slug: "home-training", key: "A" }));
    } catch (err) {
      expect(isHttpError(err) && err.status === 404).toBe(true);
      return;
    }
    throw new Error("expected the session runner to refuse an archived plan");
  });

  it("refuses a revision, by name, on both import actions", async () => {
    const checked = (await importCheck(formEvent({ source_md: v2Md }))) as {
      status: number;
      data: { importError: string; source: string };
    };
    expect(checked.status).toBe(409);
    expect(checked.data.importError).toMatch(/archived/i);
    // The pasted document survives the refusal — UI-DECISIONS §11: a failed import must
    // never be a wall with an empty box behind it.
    expect(checked.data.source).toBe(v2Md);

    const committed = (await importCommit(formEvent({ source_md: v2Md }))) as {
      status: number;
      data: { importError: string };
    };
    expect(committed.status).toBe(409);
    expect(committed.data.importError).toMatch(/archived/i);

    // And nothing was written: the plan is still on v1.
    const plan = getPlanBySlug(getUserDbFor(user.id), "home-training")!;
    expect(plan.archived_at).toBe(NOW.toISOString());
  });
});
