# Phase 5 — Export UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: shipped — this is an archived plan, kept for its reasoning.** Its
> checkboxes were never ticked as the batches landed;
> [`docs/ROADMAP.md`](../../ROADMAP.md) is the record of what shipped, with commit
> SHAs. Do not restart it from its first unticked box.

**Goal:** Make a logged block leave GAIN as one pasteable document in one tap, so the copy-paste loop has a return crossing.

**Architecture:** The export generator (`src/lib/export/bundle.ts`) has been finished and unit-tested since phase 1 and is unreachable from the app. This phase builds the three things between it and a user: a read path turning `gain.db` rows into the plain-data `Logs` shape the generator consumes, a pure window-picker module, and a thin SvelteKit route that wires them to a copy button. Nothing pure needs writing — do not reimplement summary or CSV rendering.

**Tech Stack:** TypeScript 6 (strict), SvelteKit (Svelte 5 runes), better-sqlite3 13, Vitest 4, Playwright, Zod 4.

## Global Constraints

- **Read `AGENTS.md` first**, then `docs/ARCHITECTURE.md` §11 and `docs/UI-DECISIONS.md` §11. They are the contract; this plan implements them.
- **Node 24 LTS.** Every dependency is on a current major — Zod 4, TypeScript 6, ESLint 10, Vitest 4, better-sqlite3 13. Do not write Zod 3 idioms from memory.
- **`npm run verify` is the definition of done.** It short-circuits, so a lint failure means the tests never ran. Run it before claiming any task complete.
- **Never write a literal control character — write the escape** (`\u0000`). Two checks enforce this.
- **Run `npx prettier --write <file>` after editing any TypeScript or Svelte file.**
- **A form action must never throw.** Every failure path returns `fail(status, { actionError })`. Only `redirect` is thrown. A thrown `Error` in an action is a 500 that renders `+error.svelte` and destroys in-progress client state.
- **Metric values key on `(scope, key)`, never the bare key.** A plan may legally declare `rpe` at both set and session scope; merging them reports a plausible wrong number rather than failing.
- **`weight_kg` is always total kilograms.** No `paired` field, no per-side doubling.
- **Copy is the primary action, download is the fallback** (UI-DECISIONS §11). One document per crossing.
- **360 × 800 is the layout floor**, checked mechanically at three viewports.
- **Do not commit real health data.** The fixture is fictional and stays that way.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/export/windows.ts` | Pure: which export windows to offer, and their labels | 1 |
| `tests/export-windows.test.ts` | Unit tests for the above | 1 |
| `src/lib/db/logs.ts` | Read path: `gain.db` rows → the plain-data `Logs` shape | 2 |
| `src/lib/db/read.ts` | Add `getDefaultTemplate` (modify) | 2 |
| `tests/db/logs.test.ts` | Unit tests for the read path | 2 |
| `src/routes/plan/[slug]/export/+page.server.ts` | Load (picker options) + `generate` action | 3 |
| `tests/server/export-route.test.ts` | Action tests, incl. the 400 path | 3 |
| `src/routes/plan/[slug]/export/+page.svelte` | Window picker, preview, copy/download | 4 |
| `src/routes/+page.svelte` | Add the "Export for review" entry point (modify) | 4 |
| `e2e/export-walkthrough.spec.ts` | Seed → log → export → Section 1 byte-identical | 5 |
| `README.md`, `docs/ROADMAP.md`, `AGENTS.md` | Status close-out (modify) | 6 |

**Important context on what already exists — do not rebuild it:**

- `generateExport`, `filterLogsToWindow`, `renderRawLogs`, `weeksElapsed` in `src/lib/export/bundle.ts`
- `buildProgressSummary`, `renderExerciseSets`, `isoDate` in `src/lib/export/summary.ts`
- `renderInstructionsTemplate` + `INSTRUCTION_VARIABLES` in `src/lib/templates/render.ts` — already exactly the six `{{…}}` tokens ARCHITECTURE §11 names, already leaving unknown tokens as literal text
- `copyText` / `downloadText` in `src/lib/copy.ts`
- `getPlanBySlug`, `getCurrentVersion`, `contractOfVersion`, `readSourceMd` in `src/lib/db/read.ts`
- `contractMd` in `src/lib/server/assets.ts`
- `ai_template` seeded with `is_default = 1` at provisioning

---

### Task 1: The export window picker (pure)

Three windows: everything since the current version was imported (the default), twice the plan's declared block length, and full history. The middle option is **derived from `plan.block_length_weeks`, and absent entirely when the plan declares none** — inventing "last 8 weeks" for a plan that never mentioned weeks is a guess wearing the costume of a setting.

**Files:**
- Create: `src/lib/export/windows.ts` — **may already exist on disk, untracked and uncommitted.** If present, diff it against the code in Step 3 and reconcile rather than assuming either version.
- Test: `tests/export-windows.test.ts`

**Interfaces:**
- Consumes: `ExportWindow` from `src/lib/export/bundle.ts` (`{ label: string; start?: string; end?: string }`), `isoDate` from `src/lib/export/summary.ts`
- Produces:
  - `type ExportWindowId = "since_version" | "recent_blocks" | "full"`
  - `type ExportWindowOption = ExportWindow & { id: ExportWindowId }`
  - `type ExportWindowContext = { versionNo: number; importedAt: string; blockLengthWeeks: number | null; now: Date }`
  - `exportWindowOptions(context: ExportWindowContext): ExportWindowOption[]`
  - `resolveExportWindow(id: string, context: ExportWindowContext): ExportWindowOption | undefined`

- [ ] **Step 1: Write the failing test**

Create `tests/export-windows.test.ts`:

```ts
/**
 * The export window picker's options (ARCHITECTURE §11). Pure, clock injected.
 */

import { describe, expect, it } from "vitest";
import {
  exportWindowOptions,
  resolveExportWindow,
  type ExportWindowContext,
} from "../src/lib/export/windows";

const NOW = new Date("2026-08-12T10:00:00Z");

const CONTEXT: ExportWindowContext = {
  versionNo: 2,
  importedAt: "2026-07-14T09:30:00Z",
  blockLengthWeeks: 4,
  now: NOW,
};

describe("exportWindowOptions", () => {
  it("offers three windows, the current version's first", () => {
    const options = exportWindowOptions(CONTEXT);
    expect(options.map((o) => o.id)).toEqual(["since_version", "recent_blocks", "full"]);
  });

  it("starts the default window at the current version's import", () => {
    const [since] = exportWindowOptions(CONTEXT);
    expect(since?.start).toBe("2026-07-14T09:30:00Z");
    expect(since?.end).toBeUndefined();
  });

  it("labels the default window with the version and its import date", () => {
    const [since] = exportWindowOptions(CONTEXT);
    expect(since?.label).toBe("since v2 (imported 2026-07-14)");
  });

  it("derives the middle window from the plan's own block length, two blocks back", () => {
    const recent = exportWindowOptions(CONTEXT).find((o) => o.id === "recent_blocks");
    expect(recent?.label).toBe("last 8 weeks (2 blocks)");
    // 8 weeks before NOW.
    expect(recent?.start).toBe("2026-06-17T10:00:00.000Z");
  });

  it("scales the middle window with the declared block length", () => {
    const recent = exportWindowOptions({ ...CONTEXT, blockLengthWeeks: 12 }).find(
      (o) => o.id === "recent_blocks",
    );
    expect(recent?.label).toBe("last 24 weeks (2 blocks)");
  });

  it("omits the middle window when the plan declares no block length", () => {
    const options = exportWindowOptions({ ...CONTEXT, blockLengthWeeks: null });
    expect(options.map((o) => o.id)).toEqual(["since_version", "full"]);
  });

  it("omits the middle window for a nonsensical block length rather than inventing one", () => {
    for (const blockLengthWeeks of [0, -4, 2.5]) {
      const options = exportWindowOptions({ ...CONTEXT, blockLengthWeeks });
      expect(options.map((o) => o.id), `block_length_weeks = ${blockLengthWeeks}`).toEqual([
        "since_version",
        "full",
      ]);
    }
  });

  it("bounds full history at neither end", () => {
    const full = exportWindowOptions(CONTEXT).find((o) => o.id === "full");
    expect(full?.start).toBeUndefined();
    expect(full?.end).toBeUndefined();
    expect(full?.label).toBe("full history");
  });
});

describe("resolveExportWindow", () => {
  it("resolves an offered id", () => {
    expect(resolveExportWindow("full", CONTEXT)?.label).toBe("full history");
  });

  it("returns undefined for an unknown id rather than defaulting", () => {
    expect(resolveExportWindow("last_year", CONTEXT)).toBeUndefined();
    expect(resolveExportWindow("", CONTEXT)).toBeUndefined();
  });

  it("returns undefined for a window this plan does not offer", () => {
    expect(resolveExportWindow("recent_blocks", { ...CONTEXT, blockLengthWeeks: null })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/export-windows.test.ts`
Expected: FAIL — either "Failed to resolve import" (file absent) or assertion failures (file present with different content).

- [ ] **Step 3: Write the implementation**

Create `src/lib/export/windows.ts`:

```ts
/**
 * The export window picker's options (ARCHITECTURE §11, "windowed by default").
 *
 * A year of raw sets blows past a usable context window and buries the recent
 * signal in old noise, so the user chooses a span. Three of them:
 *
 *   since_version   everything logged against the plan as it stands now
 *   recent_blocks   twice the plan's own declared block length
 *   full            everything
 *
 * `since_version` is the default because it is the span the reviewing AI has not
 * seen yet: a user revising on cadence imports a new version each block, so it
 * tracks their loop without GAIN having to guess at one.
 *
 * `recent_blocks` is derived from `plan.block_length_weeks` rather than a constant,
 * because the plan declares the user's feedback loop and a four-week block and a
 * twelve-week block want different windows. When the plan declares no block length
 * — it is optional in the contract — the option is **absent** rather than falling
 * back to some invented number of weeks: offering "last 8 weeks" for a plan that
 * never mentioned weeks is a guess wearing the costume of a setting.
 *
 * Pure, with the clock injected, like everything else under `src/lib/export/`.
 */

import type { ExportWindow } from "./bundle";
import { isoDate } from "./summary";

export type ExportWindowId = "since_version" | "recent_blocks" | "full";

export type ExportWindowOption = ExportWindow & {
  id: ExportWindowId;
};

export type ExportWindowContext = {
  /** `version_no` of the version currently marked `is_current`. */
  versionNo: number;
  /** That version's `imported_at`, ISO 8601. */
  importedAt: string;
  /** `plan.block_length_weeks`; null when the plan does not declare one. */
  blockLengthWeeks: number | null;
  /** Injected clock. */
  now: Date;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** How many blocks back `recent_blocks` reaches. See the module comment. */
const RECENT_BLOCK_COUNT = 2;

/**
 * The options to offer, in picker order. The first is the default.
 *
 * Every `label` is prose the reviewing AI reads — it lands in the bundle's H1 and in
 * `{{export_window}}` — so it says which span it is rather than naming a UI control.
 * "since v2 (imported 2026-07-14)" tells the AI what it has already seen; "current
 * block" tells it nothing it can act on.
 */
export function exportWindowOptions(context: ExportWindowContext): ExportWindowOption[] {
  const options: ExportWindowOption[] = [
    {
      id: "since_version",
      label: `since v${context.versionNo} (imported ${isoDate(new Date(context.importedAt))})`,
      start: context.importedAt,
    },
  ];

  const weeks = recentBlocksWeeks(context.blockLengthWeeks);
  if (weeks !== null) {
    options.push({
      id: "recent_blocks",
      label: `last ${weeks} weeks (${RECENT_BLOCK_COUNT} blocks)`,
      start: new Date(context.now.getTime() - weeks * WEEK_MS).toISOString(),
    });
  }

  options.push({ id: "full", label: "full history" });

  return options;
}

/**
 * The option a submitted picker value names, or undefined when it names none.
 *
 * Undefined is the caller's cue to `fail(400)` rather than to substitute a default:
 * a form action must never throw (AGENTS.md, phase-4 review), and silently exporting
 * a different span than the one asked for mislabels the bundle the AI then reads.
 */
export function resolveExportWindow(
  id: string,
  context: ExportWindowContext,
): ExportWindowOption | undefined {
  return exportWindowOptions(context).find((option) => option.id === id);
}

/**
 * Null when the plan declares no usable block length, which is what removes the
 * option entirely. A non-integer or non-positive value is treated the same way —
 * the contract constrains it, but this module is fed from a nullable DB column
 * rather than from a validated contract.
 */
function recentBlocksWeeks(blockLengthWeeks: number | null): number | null {
  if (blockLengthWeeks === null) return null;
  if (!Number.isInteger(blockLengthWeeks) || blockLengthWeeks < 1) return null;
  return blockLengthWeeks * RECENT_BLOCK_COUNT;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/export-windows.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Format, verify and commit**

```bash
npx prettier --write src/lib/export/windows.ts tests/export-windows.test.ts
npm run verify
git add src/lib/export/windows.ts tests/export-windows.test.ts
git commit -m "feat(export): derive the export window options from the plan's own block length"
```

---

### Task 2: The read path from `gain.db` to `Logs`

The generator consumes the plain-data `Logs` shape from `src/lib/logs/types.ts`; the database has the rows. This is the whole gap.

**Three things that are silently wrong if you get them casually right:**

1. **Return unwindowed logs.** `generateExport` windows internally via `filterLogsToWindow`, but `weeksElapsed` deliberately reads the *full* set to compute `{{weeks_elapsed}}`. Pre-filtering here makes that token quietly read 0.
2. **Span every version of the plan.** `workout.plan_version_id` binds a workout to the version it ran under, and a plan on v3 still has v1 and v2 workouts worth exporting. Join through to `plan_id`. Section 1 is the *current* version's `source_md`; the logs are not version-scoped.
3. **`metric_value` is a flat row and `MetricValue.ref` is a discriminated union.** `scope = 'set'` rows carry `set_log_id` and leave `workout_id` null by construction, so reaching the plan for those goes through `set_log`.

**Files:**
- Create: `src/lib/db/logs.ts`
- Modify: `src/lib/db/read.ts` (append `getDefaultTemplate`)
- Test: `tests/db/logs.test.ts`

**Interfaces:**
- Consumes: `UserDb` from `src/lib/db/user-db.ts`, `Logs` and its member types from `src/lib/logs/types.ts`
- Produces:
  - `logsForPlan(userDb: UserDb, planId: string): Logs`
  - `getDefaultTemplate(userDb: UserDb): string | undefined` (in `read.ts`)

- [ ] **Step 1: Write the failing test**

Create `tests/db/logs.test.ts`:

```ts
/**
 * The read path from `gain.db` to the plain-data `Logs` shape the export generator
 * consumes. The subtle requirements are in the module comment of `src/lib/db/logs.ts`:
 * unwindowed, across every version of the plan, and metric refs rebuilt per scope.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { logsForPlan } from "../../src/lib/db/logs";
import { getDefaultTemplate, getExerciseDefIdBySlug, getPlanBySlug } from "../../src/lib/db/read";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { logDeviation, logMetric, logSet, startWorkout } from "../../src/lib/db/workout";
import { parsePlanDocument } from "../../src/lib/parse/parser";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-dumbbell-v1.md", ROOT), "utf8");
const NOW = new Date("2026-09-08T08:00:00Z");

describe("logsForPlan", () => {
  let dataDir: string;
  let userDb: UserDb;
  let planId: string;
  let planVersionId: string;
  let squatId: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-logs-test-"));
    userDb = openUserDb(dataDir, "user-1", {
      now: NOW,
      seedTemplates: [{ name: "Default revision instructions", body_md: "TEMPLATE BODY", is_default: true }],
    });

    const parsed = parsePlanDocument(fixtureMd);
    if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error(result.message);
    planId = result.plan_id;
    planVersionId = result.plan_version_id;

    const id = getExerciseDefIdBySlug(userDb, planId, "goblet-squat");
    if (!id) throw new Error("fixture is missing goblet-squat");
    squatId = id;
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns empty logs for a plan with no workouts", () => {
    const logs = logsForPlan(userDb, planId);
    expect(logs.workouts).toEqual([]);
    expect(logs.set_logs).toEqual([]);
    expect(logs.metric_values).toEqual([]);
    expect(logs.deviations).toEqual([]);
    expect(logs.activities).toEqual([]);
  });

  it("reads a workout and its sets, keyed on the exercise slug", () => {
    const { id: workoutId } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });
    logSet(userDb, {
      workoutId,
      exerciseDefId: squatId,
      setNo: 1,
      reps: 12,
      weightKg: 6,
      difficulty: "medium",
      clientId: "c-s1",
    });

    const logs = logsForPlan(userDb, planId);
    expect(logs.workouts).toHaveLength(1);
    expect(logs.workouts[0]).toMatchObject({
      id: workoutId,
      session_key: "A",
      started_at: NOW.toISOString(),
      status: "partial",
    });
    expect(logs.set_logs).toHaveLength(1);
    expect(logs.set_logs[0]).toMatchObject({
      workout_id: workoutId,
      exercise_slug: "goblet-squat",
      set_no: 1,
      reps: 12,
      weight_kg: 6,
      difficulty: "medium",
    });
  });

  it("maps SQL NULL to undefined, never to null", () => {
    const { id: workoutId } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });
    logSet(userDb, { workoutId, exerciseDefId: squatId, setNo: 1, reps: 10, clientId: "c-s1" });

    const logs = logsForPlan(userDb, planId);
    const [workout] = logs.workouts;
    const [set] = logs.set_logs;
    // `renderRawLogs` and `renderExerciseSets` both test `!== undefined`; a null
    // would render as the string "null" in the CSV and in the summary tables.
    expect(workout?.completed_at).toBeUndefined();
    expect(workout?.note).toBeUndefined();
    expect(set?.side).toBeUndefined();
    expect(set?.weight_kg).toBeUndefined();
    expect(set?.duration_s).toBeUndefined();
    expect(set?.difficulty).toBeUndefined();
    expect(Object.values({ ...workout, ...set })).not.toContain(null);
  });

  it("rebuilds each metric_value's ref from its scope", () => {
    const { id: workoutId } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });
    const { id: setLogId } = logSet(userDb, {
      workoutId,
      exerciseDefId: squatId,
      setNo: 1,
      reps: 12,
      clientId: "c-s1",
    });
    logMetric(userDb, { scope: "set", setLogId, metricKey: "rir", valueNum: 2, clientId: "c-m1" });
    logMetric(userDb, {
      scope: "exercise",
      workoutId,
      exerciseDefId: squatId,
      metricKey: "knee_pain",
      valueNum: 0,
      clientId: "c-m2",
    });
    logMetric(userDb, {
      scope: "session",
      workoutId,
      metricKey: "energy",
      valueNum: 4,
      clientId: "c-m3",
    });

    const logs = logsForPlan(userDb, planId);
    const byKey = new Map(logs.metric_values.map((v) => [v.key, v]));

    expect(byKey.get("rir")?.ref).toEqual({ scope: "set", set_log_id: setLogId });
    expect(byKey.get("knee_pain")?.ref).toEqual({
      scope: "exercise",
      workout_id: workoutId,
      exercise_slug: "goblet-squat",
    });
    expect(byKey.get("energy")?.ref).toEqual({ scope: "session", workout_id: workoutId });
    expect(byKey.get("rir")?.value_num).toBe(2);
    expect(byKey.get("rir")?.value_text).toBeUndefined();
  });

  it("keeps two same-named metrics at different scopes apart", () => {
    // The contract only requires a metric key to be unique WITHIN its scope, so a
    // plan may legally declare `rpe` at set scope and at session scope. Losing the
    // scope here merges two unrelated series downstream (AGENTS.md, Invariants).
    const { id: workoutId } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });
    const { id: setLogId } = logSet(userDb, {
      workoutId,
      exerciseDefId: squatId,
      setNo: 1,
      reps: 12,
      clientId: "c-s1",
    });
    logMetric(userDb, { scope: "set", setLogId, metricKey: "rpe", valueNum: 8, clientId: "c-m1" });
    logMetric(userDb, {
      scope: "session",
      workoutId,
      metricKey: "rpe",
      valueNum: 3,
      clientId: "c-m2",
    });

    const rpe = logsForPlan(userDb, planId).metric_values.filter((v) => v.key === "rpe");
    expect(rpe).toHaveLength(2);
    expect(rpe.map((v) => v.ref.scope).sort()).toEqual(["session", "set"]);
    expect(rpe.find((v) => v.ref.scope === "set")?.value_num).toBe(8);
    expect(rpe.find((v) => v.ref.scope === "session")?.value_num).toBe(3);
  });

  it("reads deviations with both the exercise slug and any substitute", () => {
    const { id: workoutId } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });
    logDeviation(userDb, {
      workoutId,
      exerciseDefId: squatId,
      kind: "substitute",
      reasonCode: "equipment",
      substituteExerciseSlug: "split-squat",
      clientId: "c-d1",
    });

    const [deviation] = logsForPlan(userDb, planId).deviations;
    expect(deviation).toMatchObject({
      workout_id: workoutId,
      exercise_slug: "goblet-squat",
      kind: "substitute",
      reason_code: "equipment",
      substitute_exercise_slug: "split-squat",
    });
    expect(deviation?.note).toBeUndefined();
  });

  it("returns workouts in chronological order", () => {
    const later = new Date("2026-09-10T08:00:00Z");
    const earlier = new Date("2026-09-01T08:00:00Z");
    startWorkout(userDb, { planVersionId, sessionKey: "A", clientId: "c-w2", now: later });
    startWorkout(userDb, { planVersionId, sessionKey: "B", clientId: "c-w1", now: earlier });

    const logs = logsForPlan(userDb, planId);
    expect(logs.workouts.map((w) => w.session_key)).toEqual(["B", "A"]);
  });

  it("is unwindowed — filtering is the generator's job, and weeksElapsed needs the full set", () => {
    const old = new Date("2026-01-01T08:00:00Z");
    startWorkout(userDb, { planVersionId, sessionKey: "A", clientId: "c-old", now: old });
    startWorkout(userDb, { planVersionId, sessionKey: "B", clientId: "c-new", now: NOW });

    expect(logsForPlan(userDb, planId).workouts).toHaveLength(2);
  });

  it("spans every version of the plan, not only the current one", () => {
    // A plan on v2 still has v1 workouts worth exporting. Section 1 is the current
    // version's source_md; the logs are not version-scoped.
    const { id: oldWorkoutId } = startWorkout(userDb, {
      planVersionId,
      sessionKey: "A",
      clientId: "c-v1",
      now: NOW,
    });

    const revised = fixtureMd.replace("version: 1", "version: 2");
    const parsed = parsePlanDocument(revised);
    if (!parsed.ok) throw new Error(`revision failed to parse: ${parsed.kind}`);
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error(result.message);
    startWorkout(userDb, {
      planVersionId: result.plan_version_id,
      sessionKey: "B",
      clientId: "c-v2",
      now: NOW,
    });

    const logs = logsForPlan(userDb, planId);
    expect(logs.workouts).toHaveLength(2);
    expect(logs.workouts.map((w) => w.id)).toContain(oldWorkoutId);
  });

  it("returns nothing for an unknown plan id", () => {
    expect(logsForPlan(userDb, "not-a-plan").workouts).toEqual([]);
  });
});

describe("getDefaultTemplate", () => {
  let dataDir: string;
  let userDb: UserDb;

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns the seeded default template body", () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-template-test-"));
    userDb = openUserDb(dataDir, "user-1", {
      now: NOW,
      seedTemplates: [{ name: "Default revision instructions", body_md: "BODY", is_default: true }],
    });
    expect(getDefaultTemplate(userDb)).toBe("BODY");
  });

  it("returns undefined when nothing is marked default", () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-template-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });
    expect(getDefaultTemplate(userDb)).toBeUndefined();
  });
});
```

Note: `getPlanBySlug` is imported above so the test file matches the pattern of `tests/db/workout.test.ts`; if ESLint flags it as unused, drop it from the import list.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db/logs.test.ts`
Expected: FAIL — "Failed to resolve import ... src/lib/db/logs".

- [ ] **Step 3: Write the implementation**

Create `src/lib/db/logs.ts`:

```ts
/**
 * The read path from `gain.db` to the plain-data `Logs` shape (`src/lib/logs/types.ts`)
 * that the export generator consumes — phase 5's missing half. `generateExport` has been
 * finished since phase 1; the database has the rows; this module is the join between them.
 *
 * Three properties this has to hold, each of which fails silently rather than loudly:
 *
 * 1. **Unwindowed.** `generateExport` calls `filterLogsToWindow` itself, but `weeksElapsed`
 *    deliberately reads the *unfiltered* set to compute `{{weeks_elapsed}}`. Handing this
 *    module's caller a pre-filtered `Logs` makes that token quietly read 0.
 * 2. **Every version of the plan.** `workout.plan_version_id` binds a workout to the version
 *    it ran under, so a plan on v3 still has v1 and v2 workouts worth exporting. Every query
 *    here joins through `plan_version` to `plan_id`, never to one version.
 * 3. **Metric refs are rebuilt per scope.** `metric_value` is one flat row with three
 *    nullable reference columns; `MetricValue.ref` is a discriminated union. `scope = 'set'`
 *    rows leave `workout_id` null by construction and reach the plan through `set_log`.
 *
 * Read-only, and scoped to one plan in one user's own database — physical isolation means
 * there is no cross-user row to leak here in the first place (ARCHITECTURE decision 4).
 *
 * Slugs come from joins on `exercise_def`: log rows store `exercise_def_id`, and every
 * identity the export keys on is a slug (`exercise_def.slug` is load-bearing, AGENTS.md).
 */

import type {
  Activity,
  Deviation,
  DeviationKind,
  Difficulty,
  Logs,
  MetricValue,
  SetLog,
  Workout,
  WorkoutStatus,
} from "../logs/types";
import type { UserDb } from "./user-db";

/** SQLite hands back null; the `Logs` types use optional properties. */
function opt<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

export function logsForPlan(userDb: UserDb, planId: string): Logs {
  return {
    workouts: workoutsOf(userDb, planId),
    set_logs: setLogsOf(userDb, planId),
    metric_values: metricValuesOf(userDb, planId),
    deviations: deviationsOf(userDb, planId),
    activities: activitiesOf(userDb),
  };
}

type WorkoutRow = {
  id: string;
  session_key: string;
  started_at: string;
  completed_at: string | null;
  status: WorkoutStatus;
  note: string | null;
};

function workoutsOf(userDb: UserDb, planId: string): Workout[] {
  const rows = userDb.db
    .prepare(
      `SELECT w.id AS id, w.session_key AS session_key, w.started_at AS started_at,
              w.completed_at AS completed_at, w.status AS status, w.note AS note
       FROM workout w
       JOIN plan_version pv ON pv.id = w.plan_version_id
       WHERE pv.plan_id = ?
       ORDER BY w.started_at, w.id`,
    )
    .all(planId) as WorkoutRow[];

  return rows.map((row) => ({
    id: row.id,
    session_key: row.session_key,
    started_at: row.started_at,
    completed_at: opt(row.completed_at),
    status: row.status,
    note: opt(row.note),
  }));
}

type SetLogRow = {
  id: string;
  workout_id: string;
  exercise_slug: string;
  set_no: number;
  side: "left" | "right" | null;
  reps: number | null;
  weight_kg: number | null;
  duration_s: number | null;
  difficulty: Difficulty | null;
};

/**
 * Ordered by the workout's start then by `id` — a ULID, so within a workout that is
 * insertion order. `renderRawLogs` emits `sets.csv` in array order, so this ordering is
 * what the reviewing AI reads.
 */
function setLogsOf(userDb: UserDb, planId: string): SetLog[] {
  const rows = userDb.db
    .prepare(
      `SELECT s.id AS id, s.workout_id AS workout_id, e.slug AS exercise_slug,
              s.set_no AS set_no, s.side AS side, s.reps AS reps, s.weight_kg AS weight_kg,
              s.duration_s AS duration_s, s.difficulty AS difficulty
       FROM set_log s
       JOIN workout w ON w.id = s.workout_id
       JOIN plan_version pv ON pv.id = w.plan_version_id
       JOIN exercise_def e ON e.id = s.exercise_def_id
       WHERE pv.plan_id = ?
       ORDER BY w.started_at, s.id`,
    )
    .all(planId) as SetLogRow[];

  return rows.map((row) => ({
    id: row.id,
    workout_id: row.workout_id,
    exercise_slug: row.exercise_slug,
    set_no: row.set_no,
    side: opt(row.side),
    reps: opt(row.reps),
    weight_kg: opt(row.weight_kg),
    duration_s: opt(row.duration_s),
    difficulty: opt(row.difficulty),
  }));
}

type MetricValueRow = {
  id: string;
  scope: "set" | "exercise" | "session";
  metric_key: string;
  value_num: number | null;
  value_text: string | null;
  set_log_id: string | null;
  workout_id: string | null;
  exercise_slug: string | null;
};

/**
 * `COALESCE(m.workout_id, s.workout_id)` is what reaches the plan for all three scopes at
 * once: `scope = 'set'` rows reference a `set_log` and leave `workout_id` null, so they
 * arrive at their workout through the set.
 *
 * A row whose scope's required reference is missing is skipped rather than emitted with a
 * malformed `ref`. The schema does not constrain the combination — nothing in the app
 * writes one (`logMetric` validates first), but a half-written row must not become a
 * plausible wrong number in the summary.
 */
function metricValuesOf(userDb: UserDb, planId: string): MetricValue[] {
  const rows = userDb.db
    .prepare(
      `SELECT m.id AS id, m.scope AS scope, m.metric_key AS metric_key,
              m.value_num AS value_num, m.value_text AS value_text,
              m.set_log_id AS set_log_id,
              COALESCE(m.workout_id, s.workout_id) AS workout_id,
              e.slug AS exercise_slug
       FROM metric_value m
       LEFT JOIN set_log s ON s.id = m.set_log_id
       LEFT JOIN exercise_def e ON e.id = m.exercise_def_id
       JOIN workout w ON w.id = COALESCE(m.workout_id, s.workout_id)
       JOIN plan_version pv ON pv.id = w.plan_version_id
       WHERE pv.plan_id = ?
       ORDER BY m.id`,
    )
    .all(planId) as MetricValueRow[];

  const values: MetricValue[] = [];
  for (const row of rows) {
    const ref = refOf(row);
    if (!ref) continue;
    values.push({
      id: row.id,
      key: row.metric_key,
      ref,
      value_num: opt(row.value_num),
      value_text: opt(row.value_text),
    });
  }
  return values;
}

function refOf(row: MetricValueRow): MetricValue["ref"] | undefined {
  switch (row.scope) {
    case "set":
      return row.set_log_id === null ? undefined : { scope: "set", set_log_id: row.set_log_id };
    case "exercise":
      return row.workout_id === null || row.exercise_slug === null
        ? undefined
        : { scope: "exercise", workout_id: row.workout_id, exercise_slug: row.exercise_slug };
    case "session":
      return row.workout_id === null ? undefined : { scope: "session", workout_id: row.workout_id };
  }
}

type DeviationRow = {
  id: string;
  workout_id: string;
  exercise_slug: string;
  kind: DeviationKind;
  reason_code: string | null;
  note: string | null;
  substitute_exercise_slug: string | null;
};

function deviationsOf(userDb: UserDb, planId: string): Deviation[] {
  const rows = userDb.db
    .prepare(
      `SELECT d.id AS id, d.workout_id AS workout_id, e.slug AS exercise_slug, d.kind AS kind,
              d.reason_code AS reason_code, d.note AS note,
              d.substitute_exercise_slug AS substitute_exercise_slug
       FROM deviation d
       JOIN workout w ON w.id = d.workout_id
       JOIN plan_version pv ON pv.id = w.plan_version_id
       JOIN exercise_def e ON e.id = d.exercise_def_id
       WHERE pv.plan_id = ?
       ORDER BY w.started_at, d.id`,
    )
    .all(planId) as DeviationRow[];

  return rows.map((row) => ({
    id: row.id,
    workout_id: row.workout_id,
    exercise_slug: row.exercise_slug,
    kind: row.kind,
    reason_code: opt(row.reason_code),
    note: opt(row.note),
    substitute_exercise_slug: opt(row.substitute_exercise_slug),
  }));
}

type ActivityRow = {
  id: string;
  kind: string;
  occurred_at: string;
  duration_min: number | null;
  intensity: string | null;
  note: string | null;
};

/**
 * Every activity, not this plan's: the `activity` table carries no plan reference (it is a
 * swim, not a session), so activities are per user and the window does the narrowing —
 * `filterLogsToWindow` filters them on `occurred_at`.
 */
function activitiesOf(userDb: UserDb): Activity[] {
  const rows = userDb.db
    .prepare(
      `SELECT id, kind, occurred_at, duration_min, intensity, note
       FROM activity
       ORDER BY occurred_at, id`,
    )
    .all() as ActivityRow[];

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    occurred_at: row.occurred_at,
    duration_min: opt(row.duration_min),
    intensity: opt(row.intensity),
    note: opt(row.note),
  }));
}
```

- [ ] **Step 4: Add `getDefaultTemplate` to `src/lib/db/read.ts`**

Append to the end of `src/lib/db/read.ts`:

```ts
/**
 * The body of the user's default AI-instruction template — Section 0 of an export
 * (ARCHITECTURE §11). Seeded from `templates/default-ai-instructions.md` at provisioning
 * and user-editable from phase 8; undefined when nothing is marked default, which the
 * caller resolves by falling back to the bundled asset rather than exporting a bundle
 * with no task in it.
 */
export function getDefaultTemplate(userDb: UserDb): string | undefined {
  const row = userDb.db
    .prepare("SELECT body_md FROM ai_template WHERE is_default = 1 ORDER BY updated_at LIMIT 1")
    .get() as { body_md: string } | undefined;
  return row?.body_md;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/db/logs.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Format, verify and commit**

```bash
npx prettier --write src/lib/db/logs.ts src/lib/db/read.ts tests/db/logs.test.ts
npm run verify
git add src/lib/db/logs.ts src/lib/db/read.ts tests/db/logs.test.ts
git commit -m "feat(export): read the plain-data Logs shape out of gain.db"
```

---

### Task 3: The export route's server half

**Files:**
- Create: `src/routes/plan/[slug]/export/+page.server.ts`
- Test: `tests/server/export-route.test.ts`

**Interfaces:**
- Consumes: `logsForPlan`, `getDefaultTemplate`, `exportWindowOptions`, `resolveExportWindow`, `ExportWindowContext` from Tasks 1–2; `generateExport` and `filterLogsToWindow` from `src/lib/export/bundle.ts`; `getPlanBySlug`, `getCurrentVersion`, `contractOfVersion`, `readSourceMd` from `src/lib/db/read.ts`; `contractMd` from `src/lib/server/assets.ts`; `defaultInstructionsTemplate` from the same
- Produces: a `load` returning `{ planSlug, planName, versionNo, options: Array<{ id, label, workouts }>, totalWorkouts }` and one action, `generate`, returning `{ bundle, filename, windowLabel }` or `fail(…, { actionError })`

- [ ] **Step 1: Write the failing test**

Create `tests/server/export-route.test.ts`. This drives the route's exported `actions` the way `tests/server/first-run.test.ts` drives the home screen's:

```ts
/**
 * The export route's server half. The action must never throw — every failure is a
 * `fail(…, { actionError })` — and an unknown window must be rejected rather than
 * quietly exported as some default span under a label that then lies to the AI.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractPlanSourceFromBundle } from "../../src/lib/export/bundle";
import { importPlan } from "../../src/lib/db/import-plan";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { getExerciseDefIdBySlug, getPlanBySlug } from "../../src/lib/db/read";
import { logSet, startWorkout } from "../../src/lib/db/workout";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { buildExportBundle } from "../../src/routes/plan/[slug]/export/bundle-for-plan";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-dumbbell-v1.md", ROOT), "utf8");
const NOW = new Date("2026-09-08T08:00:00Z");

describe("buildExportBundle", () => {
  let dataDir: string;
  let userDb: UserDb;
  let planId: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-export-route-test-"));
    userDb = openUserDb(dataDir, "user-1", {
      now: NOW,
      seedTemplates: [
        { name: "Default revision instructions", body_md: "Review {{plan_name}}.", is_default: true },
      ],
    });

    const parsed = parsePlanDocument(fixtureMd);
    if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error(result.message);
    planId = result.plan_id;

    const squatId = getExerciseDefIdBySlug(userDb, planId, "goblet-squat");
    if (!squatId) throw new Error("fixture is missing goblet-squat");
    const { id: workoutId } = startWorkout(userDb, {
      planVersionId: result.plan_version_id,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });
    logSet(userDb, {
      workoutId,
      exerciseDefId: squatId,
      setNo: 1,
      reps: 12,
      weightKg: 6,
      clientId: "c-s1",
    });
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("replays Section 1 byte-for-byte from the imported document", () => {
    const plan = getPlanBySlug(userDb, "home-dumbbell");
    if (!plan) throw new Error("plan missing");
    const result = buildExportBundle(userDb, plan, "full", NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(extractPlanSourceFromBundle(result.bundle)).toBe(fixtureMd);
  });

  it("substitutes the template's variables for real values", () => {
    const plan = getPlanBySlug(userDb, "home-dumbbell");
    if (!plan) throw new Error("plan missing");
    const result = buildExportBundle(userDb, plan, "full", NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.bundle).toContain("Review 4-Week Home Dumbbell Training Plan.");
    expect(result.bundle).not.toContain("{{plan_name}}");
  });

  it("puts the window label in the title and reflects the logged set in the summary", () => {
    const plan = getPlanBySlug(userDb, "home-dumbbell");
    if (!plan) throw new Error("plan missing");
    const result = buildExportBundle(userDb, plan, "full", NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.bundle).toContain("— full history");
    expect(result.bundle).toContain("goblet-squat");
    expect(result.bundle).toContain("6 kg × 12");
  });

  it("rejects an unknown window rather than defaulting to one", () => {
    const plan = getPlanBySlug(userDb, "home-dumbbell");
    if (!plan) throw new Error("plan missing");
    expect(buildExportBundle(userDb, plan, "last_year", NOW).ok).toBe(false);
    expect(buildExportBundle(userDb, plan, "", NOW).ok).toBe(false);
  });

  it("names the archive file per plan, version and instant", () => {
    const plan = getPlanBySlug(userDb, "home-dumbbell");
    if (!plan) throw new Error("plan missing");
    const result = buildExportBundle(userDb, plan, "full", NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.filename).toBe("gain-export-home-dumbbell-v1.md");
    const archived = fs.readdirSync(path.join(userDb.userDir, "exports"));
    expect(archived).toContain("gain-export-home-dumbbell-v1-2026-09-08T080000Z.md");
  });
});
```

The test imports `buildExportBundle` from a **sibling module of the route**, not from `+page.server.ts`. Route files resolve `$lib` only inside a Vite/SvelteKit context and export SvelteKit-shaped symbols; putting the logic one file over keeps it directly testable, exactly as phase 4 kept the runner's logic in `src/lib/session/`.

The plan name above is the fixture's real one, confirmed at `fixtures/plans/home-dumbbell-v1.md:522`. Note it ends in "Plan", not "Programme" — the contract key is `plan` and synonyms are rejected everywhere (AGENTS.md, Invariants).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/server/export-route.test.ts`
Expected: FAIL — "Failed to resolve import ... bundle-for-plan".

- [ ] **Step 3: Write the bundle builder**

Create `src/routes/plan/[slug]/export/bundle-for-plan.ts`:

```ts
/**
 * Everything the export route's action does apart from talking to SvelteKit: resolve the
 * window, assemble the bundle, archive a copy. It sits beside the route rather than inside
 * `+page.server.ts` so it is directly unit-testable — the same split phase 4 used to keep
 * the session runner's logic in `$lib` and the route thin.
 *
 * Returns a result rather than throwing, because its one caller is a form action and a
 * thrown `Error` there is a 500 that renders `+error.svelte` (AGENTS.md, phase-4 review).
 */

import fs from "node:fs";
import path from "node:path";
import { contractMd, defaultInstructionsTemplate } from "$lib/server/assets";
import { logsForPlan } from "$lib/db/logs";
import {
  contractOfVersion,
  getCurrentVersion,
  getDefaultTemplate,
  readSourceMd,
  type PlanRow,
} from "$lib/db/read";
import type { UserDb } from "$lib/db/user-db";
import { generateExport } from "$lib/export/bundle";
import { resolveExportWindow, type ExportWindowContext } from "$lib/export/windows";

export type BuildExportResult =
  | { ok: true; bundle: string; filename: string; windowLabel: string }
  | { ok: false; status: number; message: string };

/** The picker's context for a plan, so `load` and the action agree on what is offered. */
export function windowContextFor(
  userDb: UserDb,
  plan: PlanRow,
  now: Date,
): ExportWindowContext | undefined {
  const version = getCurrentVersion(userDb, plan.id);
  if (!version) return undefined;
  return {
    versionNo: version.version_no,
    importedAt: version.imported_at,
    blockLengthWeeks: version.block_length_weeks,
    now,
  };
}

export function buildExportBundle(
  userDb: UserDb,
  plan: PlanRow,
  windowId: string,
  now: Date,
): BuildExportResult {
  const version = getCurrentVersion(userDb, plan.id);
  const context = windowContextFor(userDb, plan, now);
  if (!version || !context) {
    return { ok: false, status: 409, message: "That plan has no current version to export." };
  }

  const window = resolveExportWindow(windowId, context);
  if (!window) {
    return { ok: false, status: 400, message: "Choose a window to export." };
  }

  let bundle: string;
  try {
    bundle = generateExport({
      contract: contractOfVersion(version),
      // Section 1 is the document on disk, byte-for-byte — never reassembled from
      // context_md plus a block (ARCHITECTURE §11).
      source_md: readSourceMd(userDb, version),
      instructions_template: getDefaultTemplate(userDb) ?? defaultInstructionsTemplate,
      contract_md: contractMd,
      // Unwindowed on purpose: generateExport filters internally, and weeksElapsed
      // reads the full set for {{weeks_elapsed}}.
      logs: logsForPlan(userDb, plan.id),
      window,
      now,
    });
  } catch {
    // readSourceMd hits the filesystem and a malformed contract_json would throw here
    // too. Either way the user gets a message, not a 500 that wipes the page.
    return {
      ok: false,
      status: 500,
      message: "GAIN could not assemble the bundle. The plan's source document may be missing.",
    };
  }

  archive(userDb, plan, version.version_no, now, bundle);

  return {
    ok: true,
    bundle,
    // The download name is stable and clean; the archived name is unique. Both are built
    // from a validated slug and an integer, so neither can escape the user directory.
    filename: `gain-export-${plan.slug}-v${version.version_no}.md`,
    windowLabel: window.label,
  };
}

/**
 * Keep a copy under `users/<id>/exports/` (ARCHITECTURE §3's data layout), so a user who
 * loses the paste can find it again. Best-effort by design: failing the export the user is
 * about to paste because an archive write failed would break the crossing to save a
 * convenience.
 */
function archive(
  userDb: UserDb,
  plan: PlanRow,
  versionNo: number,
  now: Date,
  bundle: string,
): void {
  try {
    const stamp = `${now.toISOString().slice(0, 19).replaceAll(":", "")}Z`;
    const dir = path.join(userDb.userDir, "exports");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `gain-export-${plan.slug}-v${versionNo}-${stamp}.md`),
      bundle,
      "utf8",
    );
  } catch {
    // Deliberately swallowed — see the comment above.
  }
}
```

**If `$lib` imports fail under Vitest for this file**, switch them to relative paths (`../../../../lib/db/logs`) the way `e2e/seed.ts` does, and note why in the module comment.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/server/export-route.test.ts`
Expected: PASS, 5 tests. If the `6 kg × 12` assertion fails, check `renderExerciseSets` in `src/lib/export/summary.ts` for the exact spacing and fix the *test* to match it — that function is already tested and correct.

- [ ] **Step 5: Write the route's `+page.server.ts`**

Create `src/routes/plan/[slug]/export/+page.server.ts`:

```ts
/**
 * The export route (ARCHITECTURE §11): pick a window, generate one pasteable document.
 *
 * The loop's return crossing. `generateExport` has existed since phase 1 — this route is
 * what makes it reachable, so keep it thin: everything but SvelteKit's shapes lives in
 * `./bundle-for-plan`.
 */

import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { logsForPlan } from "$lib/db/logs";
import { getPlanBySlug } from "$lib/db/read";
import { filterLogsToWindow } from "$lib/export/bundle";
import { exportWindowOptions } from "$lib/export/windows";
import { buildExportBundle, windowContextFor } from "./bundle-for-plan";

export const load: PageServerLoad = ({ params, locals }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan || plan.archived_at) throw error(404, "No such plan");

  const now = new Date();
  const context = windowContextFor(userDb, plan, now);
  if (!context) throw error(409, "That plan has no current version to export");

  // The counts make it visible when two windows cover the same span — on a plan that
  // has never been revised they all do — instead of leaving the user to guess.
  const logs = logsForPlan(userDb, plan.id);
  const options = exportWindowOptions(context).map((option) => ({
    id: option.id,
    label: option.label,
    workouts: filterLogsToWindow(logs, option).workouts.length,
  }));

  return {
    planSlug: plan.slug,
    planName: plan.name,
    versionNo: context.versionNo,
    options,
    totalWorkouts: logs.workouts.length,
  };
};

export const actions: Actions = {
  /**
   * Generate the bundle and hand it back for copying. Nothing here throws: an unknown
   * window, a missing version and a missing source document are all `fail`s carrying a
   * message the user can act on.
   */
  generate: async ({ request, params, locals }) => {
    if (!locals.user) throw redirect(303, "/login");

    const form = await request.formData();
    const raw = form.get("window");
    const windowId = typeof raw === "string" ? raw : "";

    const userDb = getUserDbFor(locals.user.id);
    const plan = getPlanBySlug(userDb, params.slug);
    if (!plan || plan.archived_at) {
      return fail(404, { actionError: "That plan no longer exists." });
    }

    const result = buildExportBundle(userDb, plan, windowId, new Date());
    if (!result.ok) {
      return fail(result.status, { actionError: result.message });
    }

    return {
      bundle: result.bundle,
      filename: result.filename,
      windowLabel: result.windowLabel,
    };
  },
};
```

- [ ] **Step 6: Verify and commit**

```bash
npx prettier --write "src/routes/plan/[slug]/export/*.ts" tests/server/export-route.test.ts
npm run verify
git add "src/routes/plan/[slug]/export" tests/server/export-route.test.ts
git commit -m "feat(export): add the export route's window resolution and bundle assembly"
```

---

### Task 4: The export page and its entry point

Copy is the primary action and download is the fallback (UI-DECISIONS §11) — the same pattern as the bootstrap prompt on the home screen, because it is the same kind of crossing. Read `src/routes/+page.svelte` lines 1–120 before writing this; match its structure and its CSS custom properties (`--surface`, `--line-soft`, `--accent`, `--accent-in`, `--muted`, `--raised`, `--r-md`, `--r-sm`, `--r-xs`). **Never use `var(--red)`** — it belongs to the plan's symptom framework (UI-DECISIONS §5).

**Files:**
- Create: `src/routes/plan/[slug]/export/+page.svelte`
- Modify: `src/routes/+page.svelte` (the plan card gains an export link)

**Interfaces:**
- Consumes: `PageData` (`planSlug`, `planName`, `versionNo`, `options`, `totalWorkouts`) and `ActionData` (`bundle`, `filename`, `windowLabel`, `actionError`) from Task 3; `copyText`, `downloadText` from `$lib/copy`

- [ ] **Step 1: Write the page**

Create `src/routes/plan/[slug]/export/+page.svelte`:

```svelte
<script lang="ts">
  import { enhance } from "$app/forms";
  import { copyText, downloadText } from "$lib/copy";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // The first option is the default window (ARCHITECTURE §11) — see
  // `exportWindowOptions`, which returns them in picker order.
  let selected = $state(data.options[0]?.id ?? "full");
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined = $state(undefined);

  async function copyBundle() {
    if (!form?.bundle) return;
    if (await copyText(form.bundle)) {
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 2000);
    } else {
      downloadText(form.filename, form.bundle);
    }
  }

  function download() {
    if (form?.bundle) downloadText(form.filename, form.bundle);
  }
</script>

<svelte:head>
  <title>Export — {data.planName}</title>
</svelte:head>

<section class="card">
  <h1>Export for review</h1>
  <p class="muted">
    One document for your AI chat: the plan as it stands, what you have logged, and the rules for
    handing a revision back. Paste the whole thing.
  </p>

  <form method="POST" action="?/generate" use:enhance>
    <fieldset>
      <legend>How much history to include</legend>
      {#each data.options as option (option.id)}
        <label class="window">
          <input type="radio" name="window" value={option.id} bind:group={selected} />
          <span class="window-label">{option.label}</span>
          <span class="window-count">
            {option.workouts}
            {option.workouts === 1 ? "workout" : "workouts"}
          </span>
        </label>
      {/each}
    </fieldset>

    {#if data.totalWorkouts === 0}
      <p class="note">
        Nothing is logged yet, so this exports the plan and an empty summary. That is a fine way to
        ask for a revision, just not a progress review.
      </p>
    {/if}

    <div class="actions">
      <button type="submit" class="primary">Generate the export</button>
    </div>
  </form>

  {#if form?.actionError}
    <p class="action-error">{form.actionError}</p>
  {/if}
</section>

{#if form?.bundle}
  <section class="card">
    <h2>Paste this into your AI chat</h2>
    <p class="muted">
      {form.windowLabel} · {form.bundle.length.toLocaleString()} characters. Copy the whole thing; download
      is the fallback.
    </p>
    <textarea class="doc" readonly rows="14" value={form.bundle}></textarea>
    <div class="actions">
      <button type="button" class="primary" onclick={copyBundle}>
        {copied ? "Copied" : "Copy export"}
      </button>
      <button type="button" class="secondary" onclick={download}>Download .md</button>
    </div>
  </section>
{/if}

<p class="back"><a href="/">Back to your plans</a></p>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1.25rem;
    margin-top: 1.25rem;
  }

  h1 {
    margin: 0 0 0.5rem;
    font-size: 1.3rem;
  }

  .card h2 {
    margin: 0 0 0.5rem;
    font-size: 1.05rem;
  }

  .muted {
    color: var(--muted);
    font-size: 0.9rem;
    margin: 0 0 0.75rem;
  }

  fieldset {
    border: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
    min-width: 0;
  }

  legend {
    padding: 0;
    color: var(--muted);
    font-size: 0.9rem;
    margin-bottom: 0.5rem;
  }

  .window {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.7rem 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--raised);
    min-width: 0;
  }

  .window-label {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .window-count {
    flex: 0 0 auto;
    color: var(--muted);
    font-size: 0.85rem;
  }

  .note {
    margin: 0.75rem 0 0;
    color: var(--muted);
    font-size: 0.9rem;
  }

  /* Next to the control that failed, legible at arm's length — never in var(--red),
     which belongs to the plan's symptom framework (UI-DECISIONS §5). */
  .action-error {
    margin: 0.75rem 0 0;
    padding: 0.7rem 0.75rem;
    border: 1px solid var(--amber);
    border-radius: var(--r-sm);
    font-weight: 700;
  }

  .doc {
    width: 100%;
    padding: 0.75rem;
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    line-height: 1.45;
    resize: vertical;
  }

  .actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.75rem;
    flex-wrap: wrap;
  }

  button {
    border: none;
    border-radius: var(--r-sm);
    padding: 0.7rem 1.25rem;
    font-weight: 700;
  }

  button.primary {
    background: var(--accent);
    color: var(--accent-in);
  }

  button.secondary {
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
  }

  .back {
    margin: 1.25rem 0 0;
    font-size: 0.9rem;
  }
</style>
```

- [ ] **Step 2: Add the entry point on the home screen**

In `src/routes/+page.svelte`, inside the `{#each data.plans as plan}` card, immediately after the closing `</ul>` of `.sessions`, add:

```svelte
      <a class="export-link" href={`/plan/${plan.slug}/export`}>Export for review</a>
```

And add to that file's `<style>` block:

```css
  .export-link {
    display: inline-block;
    padding: 0.7rem 1.25rem;
    border-radius: var(--r-sm);
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
    font-weight: 700;
  }

  .export-link:hover {
    text-decoration: none;
  }
```

- [ ] **Step 3: Check it in a browser at 360 px**

```bash
npm run dev
```

Open `http://localhost:5173/plan/home-dumbbell/export` at a 360 px viewport in devtools. Confirm: the radio rows do not overflow, the long `since v1 (imported …)` label wraps rather than pushing the count off-screen, and the preview textarea scrolls rather than widening the page. `npm run verify` cannot see any of this (AGENTS.md, phase-4 review).

- [ ] **Step 4: Verify and commit**

```bash
npx prettier --write "src/routes/plan/[slug]/export/+page.svelte" src/routes/+page.svelte
npm run verify
npm run check
git add "src/routes/plan/[slug]/export/+page.svelte" src/routes/+page.svelte
git commit -m "feat(export): add the export screen and reach it from the plan card"
```

`npm run check` must not add new warnings — there are 9 standing ones (see `todo.md`) and the count should not grow.

---

### Task 5: The end-to-end walkthrough

The roadmap's acceptance criterion: seed a plan, log a session, export, assert Section 1 is byte-identical to the imported document and that the summary reflects what was logged.

**Files:**
- Create: `e2e/export-walkthrough.spec.ts`

**Interfaces:**
- Consumes: `dismissPreSessionPrompt`, `logSetThroughRest`, `assertNoHorizontalOverflow` from `e2e/helpers.ts`; `E2E_PLAN_SLUG` from `e2e/env.ts`; `extractPlanSourceFromBundle` from `src/lib/export/bundle.ts` by **relative path** — `e2e/` runs under plain Node with no `$lib` alias, and `bundle.ts` pulls in no `?raw` imports so it loads fine

- [ ] **Step 1: Write the spec**

Create `e2e/export-walkthrough.spec.ts`:

```ts
/**
 * Phase 5's "done when": a logged block leaves GAIN as one pasteable document, and
 * `extractPlanSourceFromBundle` recovers Section 1 from what the UI actually produced.
 *
 * Three viewport projects share one seeded data directory, so this spec asserts on what
 * it can see rather than on exact totals — another project's workouts are in the same
 * database, and a count assertion would be a race.
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { extractPlanSourceFromBundle } from "../src/lib/export/bundle";
import { E2E_PLAN_SLUG } from "./env";
import { assertNoHorizontalOverflow, dismissPreSessionPrompt, logSetThroughRest } from "./helpers";

const fixtureMd = fs.readFileSync(
  path.join(process.cwd(), "fixtures/plans/home-dumbbell-v1.md"),
  "utf8",
);

test("logs a session, exports it, and replays the plan document byte-for-byte", async ({
  page,
}) => {
  // -- Log a few sets of session A.
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await logSetThroughRest(page);
  await logSetThroughRest(page);

  // -- Export.
  await page.goto(`/plan/${E2E_PLAN_SLUG}/export`);
  await expect(page.getByRole("heading", { name: "Export for review" })).toBeVisible();

  // The default window is the first radio, and it is pre-selected.
  await expect(page.locator('input[name="window"]').first()).toBeChecked();

  await page.getByRole("button", { name: "Generate the export" }).click();
  await expect(page.getByRole("heading", { name: "Paste this into your AI chat" })).toBeVisible();

  const bundle = await page.locator("textarea.doc").inputValue();

  // -- Section 1 is the imported document, byte-for-byte (ARCHITECTURE §11).
  expect(extractPlanSourceFromBundle(bundle)).toBe(fixtureMd);

  // -- All five sections, in order.
  for (const heading of [
    "## 0. Your task",
    "## 1. The current plan",
    "## 2. Progress summary",
    "## 3. Raw logs",
    "## 4. How to return an updated plan",
  ]) {
    expect(bundle, `bundle is missing ${heading}`).toContain(heading);
  }

  // -- The summary reflects what was logged: session A ran, and its first exercise has a
  // progression row. Slug rather than display name — the slug is what the AI keys on.
  expect(bundle).toContain("### Per-exercise progression");
  expect(bundle).not.toContain("No sets logged in this window.");

  // -- Template substitution is real: no token survives into the bundle.
  expect(bundle).not.toMatch(/\{\{\s*(plan_name|plan_version|export_window|today)\s*\}\}/);

  await assertNoHorizontalOverflow(page);
});

test("rejects a window it does not offer rather than exporting a different one", async ({
  page,
}) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/export`);

  // Forge the value the way a stale tab would, and confirm the action fails loudly
  // rather than silently exporting some default span under a label that then lies.
  await page.evaluate(() => {
    const input = document.querySelector('input[name="window"]') as HTMLInputElement | null;
    if (input) input.value = "last_year";
  });
  await page.getByRole("button", { name: "Generate the export" }).click();

  await expect(page.locator(".action-error")).toContainText("Choose a window");
  await expect(page.locator("textarea.doc")).toHaveCount(0);
});
```

- [ ] **Step 2: Run the spec**

```bash
npx playwright install chromium   # once, ~150MB, if not already present
npm run test:e2e -- export-walkthrough
```

Expected: PASS on all three viewport projects.

If the first test fails on `extractPlanSourceFromBundle(bundle)` returning `null`, the bundle's headings did not match — check `generateExport`'s `section()` output against `extractPlanSourceFromBundle`'s markers in `src/lib/export/bundle.ts` and fix neither without understanding why they diverged; the golden test asserts the same pair.

- [ ] **Step 3: Verify and commit**

```bash
npx prettier --write e2e/export-walkthrough.spec.ts
npm run verify
git add e2e/export-walkthrough.spec.ts
git commit -m "test(e2e): walk a logged session out through the export screen"
```

---

### Task 6: Close the phase in all three status files

A stale status costs the next agent a rebuild of something that already exists. Closing a phase means updating three places together (AGENTS.md, "Keep the status current").

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/ARCHITECTURE.md` §12's phase table

- [ ] **Step 1: Tick the roadmap items and move the marker**

In `docs/ROADMAP.md`:

1. Tick all five Phase 5 checkboxes, appending each task's commit SHA — the convention the build has used so far, e.g. `- [x] **A read path from `gain.db` to `Logs`.** … (abc1234)`.
2. In the Status table, change Phase 5's state from `Not started` to `Done`, and add `**Phase 6 is next.**` in place of the current `**Phase 5 is next.**` line.
3. Update the Status paragraph so it says phases 1–5 are done, and name the e2e spec that proves it (`e2e/export-walkthrough.spec.ts`) the way the existing paragraph names the two session-runner walkthroughs.

- [ ] **Step 2: Update the README status banner**

In `README.md` line 7, change `**Status: phase 5 of 8.**` and rewrite the sentence that follows so it mentions that a logged block can now leave GAIN as one pasteable document. Keep the existing voice; do not restructure the banner.

- [ ] **Step 3: Update AGENTS.md's "Current state"**

Rewrite the paragraph so it reads "Phases 1–5 are done", describes phase 5 in one sentence (the read path, the window picker, the route, and the walkthrough that proves it), and changes the closing sentence from "Phase 5 (the export UI) is next" to phase 6 (the offline PWA). Delete the clause explaining that the generator is unreachable — it no longer is.

- [ ] **Step 4: Update ARCHITECTURE §12's phase table**

§12's table is the contract that `docs/ROADMAP.md` defers to. Mark phase 5 done there too, so the two cannot disagree.

- [ ] **Step 5: Verify and commit**

```bash
npm run verify
git add docs/ROADMAP.md README.md AGENTS.md docs/ARCHITECTURE.md
git commit -m "docs: close phase 5 — the export UI ships"
```

`docs/` is byte-sensitive and excluded from Prettier (`.prettierignore`) — do not run Prettier over these files, and do not remove them from the ignore list.

---

## Self-Review

**Spec coverage** — every roadmap item for phase 5 maps to a task:

| Roadmap item | Task |
|---|---|
| A read path from `gain.db` to `Logs`, keyed on `(scope, key)` | 2 |
| The export route: window picker, generate, preview | 3, 4 |
| Copy with download fallback | 4 |
| The template substitutions are real | 3 (asserted), 5 (asserted end-to-end) |
| An e2e walkthrough | 5 |
| "Done when": one pasteable document in one tap, Section 1 recovered | 5 |

**Watch-for items from the roadmap** — the progress summary's arithmetic, load per set, chronological first/latest, `|` escaping — are all inside `buildProgressSummary`, which is finished and unit-tested. No task rewrites it; Task 2's job is only to feed it correct rows, which is why its tests cover null→undefined, metric scope separation and chronological ordering.

**Known open item, deliberately deferred:** phase 5 uses the default `ai_template` and offers no template picker. Multiple named templates and the editor are Phase 8's item in the roadmap, and `getDefaultTemplate` is the seam they will plug into.
