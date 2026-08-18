/**
 * First run, through the page's own actions and load (ARCHITECTURE §7): empty
 * state → bootstrap prompt out → the Home overview once a plan exists.
 *
 * These drive `src/routes/+page.server.ts` directly. The import flow itself
 * — paste, parse-error report, review, commit — moved to its own route in
 * phase 8 and is covered by `tests/server/import-route.test.ts`; what is left
 * here is Home's own behaviour: "the answers are never stored" for the
 * bootstrap prompt, and what `load` shows once a plan has been imported
 * (seeded directly through `importPlan`, the way the db-level tests do,
 * rather than through a page action Home no longer has).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { actions, load } from "../../src/routes/+page.server";
import { getUserDbFor, resetAppStateForTests } from "../../src/lib/server/app-state";
import { resetConfigForTests } from "../../src/lib/server/config";
import { importPlan } from "../../src/lib/db/import-plan";
import { parsePlanDocument } from "../../src/lib/parse/parser";

const FIXTURE = fs.readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const USER_ID = "01KZKQ4GB22EEQBF20YDKD1BYE";
const NOW = new Date("2026-09-08T08:00:00Z");

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
function action(name: "generatePrompt") {
  const handler = actions[name];
  if (!handler) throw new Error(`the page defines no '${name}' action`);
  return handler;
}

const userDir = () => path.join(tmpDir, "users", USER_ID);

/** Seed a committed plan directly through the writer, the way the db-level tests do —
 * Home's `load` no longer has a page action of its own that can commit one. */
function seedFixturePlan(): void {
  const parsed = parsePlanDocument(FIXTURE);
  if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
  const result = importPlan(getUserDbFor(USER_ID), { parsed, now: NOW });
  if (!result.ok) throw new Error(result.message);
}

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

describe("the plan overview, once a plan exists", () => {
  it("shows the plan, so the loop has visibly started", async () => {
    seedFixturePlan();

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
    seedFixturePlan();

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
});
