/**
 * The import route's server half (ARCHITECTURE §8): paste box, parse-error report
 * and revision review are one route with two actions, `?/check` and `?/commit`.
 *
 * These drive `src/routes/import/+page.server.ts` directly, the same level
 * `tests/server/first-run.test.ts` drives `src/routes/+page.server.ts` at — it is
 * where "nothing is written on a failed parse", "the error is addressed to the
 * AI" and "a disposition actually reaches `importPlan`" hold or fail.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isRedirect } from "@sveltejs/kit";
import { actions } from "../../src/routes/import/+page.server";
import { getUserDbFor, resetAppStateForTests } from "../../src/lib/server/app-state";
import { resetConfigForTests } from "../../src/lib/server/config";

const FIXTURE_V1 = fs.readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const FIXTURE_V2 = fs.readFileSync("fixtures/plans/home-training-v2.md", "utf8");
const USER_ID = "01KZKQ4GB22EEQBF20YDKD1BYE";

/** v1 with a broken line inside the contract block — an unclosed YAML flow sequence. */
const MALFORMED_V1 = FIXTURE_V1.replace("  version: 1", "  version: [1");

const EXPORT_BUNDLE = [
  "# GAIN Export — Home Training — block 1",
  "",
  "## 1. The current plan",
  "",
  "## 2. Progress summary",
].join("\n");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-import-route-"));
  process.env.DATA_DIR = tmpDir;
  process.env.GAIN_DEV_USER = "tester";
  delete process.env.OIDC_ISSUER;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_CLIENT_SECRET;
  delete process.env.OIDC_REQUIRED_GROUP;
  resetConfigForTests();
  resetAppStateForTests();
});

afterEach(() => {
  resetAppStateForTests();
  resetConfigForTests();
  delete process.env.DATA_DIR;
  delete process.env.GAIN_DEV_USER;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Minimal RequestEvent stand-ins — the actions only ever read the form body
// and `locals.user`.
// ---------------------------------------------------------------------------

const locals = { user: { id: USER_ID, bypass: true } };

function event(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return {
    request: { formData: () => Promise.resolve(form) },
    locals,
  } as never;
}

/** `Actions` is an index signature, so each handler needs unwrapping once. */
function action(name: "check" | "commit") {
  const handler = actions[name];
  if (!handler) throw new Error(`the route defines no '${name}' action`);
  return handler;
}

/** Actions signal a redirect by throwing; unwrap it rather than let it escape. */
async function runExpectingRedirect(
  run: () => unknown,
): Promise<{ status: number; location: string }> {
  try {
    await run();
  } catch (err) {
    if (isRedirect(err)) return { status: err.status, location: err.location };
    throw err;
  }
  throw new Error("expected a redirect, but the action returned normally");
}

// The actions open this user's db through `getUserDbFor`, which caches the handle for
// the life of the process — asking for it again here returns the very same connection
// the action just wrote through, rather than racing a second one against it.
function planVersionCount(): number {
  const row = getUserDbFor(USER_ID).db.prepare("SELECT COUNT(*) AS n FROM plan_version").get() as {
    n: number;
  };
  return row.n;
}

function exerciseSlugExists(slug: string): boolean {
  const row = getUserDbFor(USER_ID)
    .db.prepare("SELECT 1 FROM exercise_def WHERE slug = ?")
    .get(slug);
  return row !== undefined;
}

// ---------------------------------------------------------------------------

describe("?/check", () => {
  it("asks for a document rather than reporting a parse error on an empty box", async () => {
    const result = (await action("check")(event({ source_md: "   " }))) as {
      status: number;
      data: { importError: string; source: string };
    };

    expect(result.status).toBe(400);
    expect(result.data.importError).toMatch(/paste.*(document|plan)/i);
    expect(result.data.source).toBe("   ");
  });

  it("previews a first import, without writing anything", async () => {
    const result = (await action("check")(event({ source_md: FIXTURE_V1 }))) as {
      firstImport: { counts: { sessions: number } };
    };

    expect(result.firstImport).toBeDefined();
    expect(result.firstImport.counts.sessions).toBe(4);
    // A review is a review: no version row yet, and no plan document on disk.
    expect(planVersionCount()).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, "users", USER_ID, "plans", "home-training"))).toBe(
      false,
    );
  });

  it("reports malformed YAML, echoing the pasted document back verbatim", async () => {
    const result = (await action("check")(event({ source_md: MALFORMED_V1 }))) as {
      status: number;
      data: { importFailure: { report: string }; source: string };
    };

    expect(result.status).toBe(400);
    expect(result.data.importFailure.report.length).toBeGreaterThan(0);
    expect(result.data.source).toBe(MALFORMED_V1);
  });

  it("names a pasted export bundle as the wrong document, never a field-path report", async () => {
    const result = (await action("check")(event({ source_md: EXPORT_BUNDLE }))) as {
      data: { importFailure: { kind: string } };
    };

    expect(result.data.importFailure.kind).toBe("export_bundle");
  });

  it("previews a revision as a diff, with one disposition per departed exercise", async () => {
    await runExpectingRedirect(() => action("commit")(event({ source_md: FIXTURE_V1 })));

    const result = (await action("check")(event({ source_md: FIXTURE_V2 }))) as {
      revision: { dispositions: readonly unknown[] };
    };

    expect(result.revision).toBeDefined();
    expect(result.revision.dispositions).toHaveLength(3);
  });
});

describe("?/commit", () => {
  it("refuses a revision with no disposition fields, and writes nothing", async () => {
    await runExpectingRedirect(() => action("commit")(event({ source_md: FIXTURE_V1 })));
    expect(planVersionCount()).toBe(1);

    const result = (await action("commit")(event({ source_md: FIXTURE_V2 }))) as {
      status: number;
    };

    expect(result.status).toBe(400);
    expect(planVersionCount()).toBe(1);
  });

  it("commits a clean revision once every disposition is answered", async () => {
    await runExpectingRedirect(() => action("commit")(event({ source_md: FIXTURE_V1 })));

    const redirect = await runExpectingRedirect(() =>
      action("commit")(
        event({
          source_md: FIXTURE_V2,
          "disposition:goblet-squat": "rename:gobletsquat",
          "disposition:rear-delt-reverse-fly": "rename:prone-reverse-fly",
          "disposition:hammer-curl": "removed",
        }),
      ),
    );

    expect(redirect.location).toBe("/");
    expect(planVersionCount()).toBe(2);
  });

  it("carries the rename through to exercise_def, rather than dropping it after parsing", async () => {
    await runExpectingRedirect(() => action("commit")(event({ source_md: FIXTURE_V1 })));
    expect(exerciseSlugExists("goblet-squat")).toBe(true);

    await runExpectingRedirect(() =>
      action("commit")(
        event({
          source_md: FIXTURE_V2,
          "disposition:goblet-squat": "rename:gobletsquat",
          "disposition:rear-delt-reverse-fly": "rename:prone-reverse-fly",
          "disposition:hammer-curl": "removed",
        }),
      ),
    );

    expect(exerciseSlugExists("gobletsquat")).toBe(true);
    expect(exerciseSlugExists("goblet-squat")).toBe(false);
  });
});
