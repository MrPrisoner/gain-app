/**
 * First run, end to end through the page actions (ARCHITECTURE §7): empty
 * state → bootstrap prompt out → paste a plan back → summary → commit.
 *
 * These drive `src/routes/+page.server.ts` directly. That is the level worth
 * testing: it is where "the answers are never stored", "nothing is written on
 * a failed parse" and "the error is addressed to the AI" actually hold or fail.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isRedirect } from "@sveltejs/kit";
import { actions, load } from "../../src/routes/+page.server";
import { resetAppStateForTests } from "../../src/lib/server/app-state";
import { resetConfigForTests } from "../../src/lib/server/config";

const FIXTURE = fs.readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const USER_ID = "01KZKQ4GB22EEQBF20YDKD1BYE";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-firstrun-"));
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

const loadEvent = () => ({ locals }) as never;

/** `Actions` is an index signature, so each handler needs unwrapping once. */
function action(name: "generatePrompt" | "import" | "confirmImport") {
  const handler = actions[name];
  if (!handler) throw new Error(`the page defines no '${name}' action`);
  return handler;
}

/** Actions signal a redirect by throwing; unwrap it rather than let it escape. */
async function runExpectingRedirect(run: () => unknown): Promise<{ location: string }> {
  try {
    await run();
  } catch (err) {
    if (isRedirect(err)) return { location: err.location };
    throw err;
  }
  throw new Error("expected a redirect, but the action returned normally");
}

const userDir = () => path.join(tmpDir, "users", USER_ID);

// ---------------------------------------------------------------------------

describe("the empty state", () => {
  it("is what a brand-new account sees", async () => {
    expect(await load(loadEvent())).toEqual({ view: "first_run" });
  });
});

describe("the bootstrap prompt", () => {
  it("is one complete document — answers filled in, CONTRACT.md carried verbatim", async () => {
    const contract = fs.readFileSync("docs/CONTRACT.md", "utf8");
    const result = (await action("generatePrompt")(
      event({
        equipment: "two adjustable dumbbells to 24 kg",
        sessions_per_week: "3",
        session_minutes: "45",
        goals: "general strength",
        constraints: "a dodgy lower back",
      }),
    )) as { prompt: string };

    expect(result.prompt).toContain("two adjustable dumbbells to 24 kg");
    expect(result.prompt).toContain("a dodgy lower back");
    // §7: the spec travels inside the document, so a user who has never read
    // CONTRACT.md can still complete a round.
    expect(result.prompt).toContain(contract);
    // Nothing may be left for the user to assemble by hand.
    expect(result.prompt).not.toMatch(/\{\{\w+\}\}/);
  });

  it("leaves skipped questions out rather than inventing around them", async () => {
    const result = (await action("generatePrompt")(event({ goals: "get stronger" }))) as {
      prompt: string;
    };
    expect(result.prompt).toContain("get stronger");
    expect(result.prompt).not.toMatch(/\{\{\w+\}\}/);
  });

  it("stores nothing — no database, no directory, no answers (§7)", async () => {
    await action("generatePrompt")(
      event({ constraints: "a specific and private health detail", goals: "strength" }),
    );

    // The user directory is only created when a plan is imported. Nothing that
    // was typed into the four questions may outlive the response.
    expect(fs.existsSync(userDir())).toBe(false);
    expect(await load(loadEvent())).toEqual({ view: "first_run" });
  });
});

describe("a plan that does not parse", () => {
  it("writes nothing, and hands back a report addressed to the AI", async () => {
    const result = (await action("import")(
      event({ source_md: "# A plan\n\nProse, but no contract block." }),
    )) as {
      status: number;
      data: { importFailure: { kind: string; report: string }; source: string };
    };

    expect(result.status).toBe(400);
    expect(result.data.importFailure.kind).toBe("missing_block");
    expect(result.data.importFailure.report).toContain("gain-plan");
    expect(fs.existsSync(path.join(userDir(), "plans"))).toBe(false);
  });

  it("echoes the pasted document back so the box can be refilled (UI-DECISIONS §11)", async () => {
    const source = "# A plan\n\nProse, but no contract block.";
    const result = (await action("import")(event({ source_md: source }))) as {
      data: { source: string };
    };
    expect(result.data.source).toBe(source);
  });

  it("names a pasted export bundle as the wrong document, not a parse failure", async () => {
    const bundle = [
      "# GAIN Export — Home Training — block 1",
      "",
      "## 1. The current plan",
      "",
      "## 2. Progress summary",
    ].join("\n");

    const result = (await action("import")(event({ source_md: bundle }))) as {
      data: { importFailure: { kind: string; report: string } };
    };

    expect(result.data.importFailure.kind).toBe("export_bundle");
    expect(result.data.importFailure.report).toContain("not a plan");
  });

  it("asks for a document rather than reporting a parse error on an empty box", async () => {
    const result = (await action("import")(event({ source_md: "   " }))) as {
      status: number;
      data: { importError: string };
    };
    expect(result.status).toBe(400);
    expect(result.data.importError).toBe("Paste a plan document first.");
  });
});

describe("importing the reference plan", () => {
  it("summarises what would be written, without writing it", async () => {
    const result = (await action("import")(event({ source_md: FIXTURE }))) as {
      review: {
        kind: string;
        plan_name: string;
        version_no: number;
        counts: { sessions: number; exercises: number; prescriptions: number };
      };
    };

    expect(result.review.kind).toBe("first_import");
    expect(result.review.version_no).toBe(1);
    // The numbers ARCHITECTURE §6 states for this fixture. The review reports
    // more than the overview does (blocks, loads, metrics), hence the subset.
    expect(result.review.counts).toMatchObject({
      sessions: 4,
      exercises: 26,
      prescriptions: 49,
    });

    // A review is a review: no version row yet.
    expect(await load(loadEvent())).toEqual({ view: "first_run" });
  });

  it("commits, and keeps source_md byte-for-byte on disk (§5, §11)", async () => {
    const redirect = await runExpectingRedirect(() =>
      action("confirmImport")(event({ source_md: FIXTURE })),
    );
    expect(redirect.location).toBe("/");

    const onDisk = fs.readFileSync(path.join(userDir(), "plans", "home-training", "v1.md"), "utf8");
    expect(onDisk).toBe(FIXTURE);
  });

  it("shows the plan once committed, so the loop has visibly started", async () => {
    await runExpectingRedirect(() => action("confirmImport")(event({ source_md: FIXTURE })));

    const data = (await load(loadEvent())) as {
      view: string;
      plans: { slug: string; version_no: number; counts: Record<string, number> }[];
    };

    expect(data.view).toBe("plan");
    expect(data.plans).toHaveLength(1);
    expect(data.plans[0]?.slug).toBe("home-training");
    expect(data.plans[0]?.version_no).toBe(1);
    expect(data.plans[0]?.counts).toEqual({ sessions: 4, exercises: 26, prescriptions: 49 });
  });

  it("suggests the sequence's first session, and lists rest among the activity kinds", async () => {
    await runExpectingRedirect(() => action("confirmImport")(event({ source_md: FIXTURE })));

    const data = (await load(loadEvent())) as {
      plans: { suggestion: { suggestedKey: string; lastSession: unknown } }[];
      activityKinds: string[];
      nextMorningCandidates: unknown[];
    };

    // fixtures/plans/home-training-v1.md declares `scheduling.sequence: [A, B, C, D]` and
    // no workouts exist yet, so the suggestion is the sequence's first entry.
    expect(data.plans[0]?.suggestion.suggestedKey).toBe("A");
    expect(data.plans[0]?.suggestion.lastSession).toBeUndefined();
    expect(data.activityKinds).toContain("rest");
    expect(data.nextMorningCandidates).toEqual([]);
  });

  it("refuses a re-import of the same version, and says why in the plan's terms", async () => {
    await runExpectingRedirect(() => action("confirmImport")(event({ source_md: FIXTURE })));

    const result = (await action("confirmImport")(event({ source_md: FIXTURE }))) as {
      status: number;
      data: { importError: string };
    };

    expect(result.status).toBe(409);
    expect(result.data.importError).toContain("must increment");
  });
});
