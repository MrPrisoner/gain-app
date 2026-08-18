# Phase 8 — Revision Diff Review & Rename Mapping: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop — a logged block exports, comes back revised from an AI, and the diff is reviewed and committed, including a slug the AI renamed mapped back onto its history instead of silently splitting it.

**Architecture:** The phase-1 diff engine is finished and untouched. A new pure module turns its `ContractDiff` into display-ready groups; a new `/import` route renders them and collects a disposition for every removed slug; and `importPlan` gains a rename step that runs inside its existing transaction, before `upsertExerciseDefs`, updating `exercise_def.slug` so every read path follows automatically.

**Tech Stack:** TypeScript 6, SvelteKit (Svelte 5 runes), better-sqlite3 13, Zod 4, Vitest 4, Playwright.

**Spec:** [`docs/superpowers/specs/2026-08-18-phase-8-revision-diff-review-design.md`](../specs/2026-08-18-phase-8-revision-diff-review-design.md) — read it before starting any task. The plan argues from the spec; where they disagree, the spec wins.

## Global Constraints

- **Node 24 LTS.** `npm run verify` is the contract and is what CI runs. Run it before calling any task done.
- **Zod 4, not 3.** `z.strictObject` / `z.looseObject` / `error:`. Never `z.object().strict()` or `message:`.
- **Svelte 5 runes only.** `$state`, `$derived`, `$props`, `$effect`. There is not one `export let` or `createEventDispatcher` in `src/`; do not add the first.
- **Icons from `~icons/lucide/*`.** Never `@iconify/svelte` — it fetches at runtime and offline is a hard requirement. Never set `width`/`height` on an icon; change the font-size of its container.
- **Never write a literal control character — write the escape** (backslash-u-zero-zero-zero-zero), not the character itself. Enforced by `npm run check:chars` and the `gain/no-control-characters` ESLint rule.
- **A form action must never throw.** Every failure path returns `fail(<status>, {...})`. A thrown error is a 500 that destroys the page and the user's pasted document.
- **A contract range is a tuple.** `[8, 12]` interpolates as `8,12`. Format it, never interpolate it.
- **Colour:** inside the session runner, green/amber/red mean symptom severity and nothing else. `/import` is outside the runner — `var(--red)` for blocking problems is correct here (spec §6).
- **Cards, never tables**, and no horizontal overflow at 360 px (UI-DECISIONS §12).
- **`docs/`, `fixtures/`, `templates/` are in `.prettierignore`** and are byte-sensitive. Never remove them from it.
- Run `npx prettier --write <file>` after editing a TypeScript or Svelte file.

## Batch Structure

Six batches. **Each batch leaves the tree green (`npm run verify` passes) and is independently committable**, so work can stop at any batch boundary and resume in a fresh session with no carried state.

| Batch | Tasks | Deliverable | Depends on |
|---|---|---|---|
| 1 | 1 | The per-user `ai_template` is gone | — |
| 2 | 2 | `importPlan` can apply a rename | — |
| 3 | 3, 4 | `home-training-v2.md` exists and round-trips | — |
| 4 | 5 | `presentDiff` turns a `ContractDiff` into display groups | 3 |
| 5 | 6, 7 | `/import` renders the review and commits it | 2, 4 |
| 6 | 8, 9 | e2e proof, and the phase is closed in the status files | 5 |

**Resuming in a new session:** read the spec, then `git log --oneline main..HEAD` to see which batches landed, then start at the first task whose checkboxes are unticked. Batches 1, 2 and 3 have no dependencies on each other and may be done in any order.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/db/schema.ts` | modify | Migration 002 drops `ai_template` |
| `src/lib/db/user-db.ts` | modify | Drop `SeedTemplate`, `seedTemplatesIfEmpty`, the `seedTemplates` option |
| `src/lib/db/read.ts` | modify | Drop `getDefaultTemplate` |
| `src/lib/server/app-state.ts` | modify | Drop the `seedTemplates` argument |
| `src/routes/plan/[slug]/export/bundle-for-plan.ts` | modify | Use `defaultInstructionsTemplate` directly |
| `src/lib/db/import-plan.ts` | modify | `renames` input, validation, the rename step inside the transaction |
| `fixtures/plans/home-training-v2.md` | create | The revision fixture |
| `src/lib/diff/present.ts` | create | `ContractDiff` to `DiffPresentation`; owns range formatting |
| `src/routes/import/+page.server.ts` | create | `check` and `commit` actions |
| `src/routes/import/+page.svelte` | create | Paste box, error report, first-import summary, revision review |
| `src/routes/import/ImportPlanForm.svelte` | move | From `src/routes/ImportPlanForm.svelte` |
| `src/routes/import/DiffGroups.svelte` | create | The collapsed change groups |
| `src/routes/import/DispositionList.svelte` | create | One row per removed slug |
| `src/routes/+page.svelte` | modify | Three embedded forms become links to `/import` |
| `src/routes/+page.server.ts` | modify | Drop the `import` and `confirmImport` actions |

---

# Batch 1 — Remove the per-user `ai_template`

Independent of everything else, and it shrinks the surface the rest of the phase touches. Spec §8.

## Task 1: Drop `ai_template`

**Files:**
- Modify: `src/lib/db/schema.ts` (add migration 002; leave `MIGRATION_001`'s SQL untouched, it has already run in the wild)
- Modify: `src/lib/db/user-db.ts`, `src/lib/db/read.ts`, `src/lib/server/app-state.ts`
- Modify: `src/routes/plan/[slug]/export/bundle-for-plan.ts`
- Modify: `src/lib/server/admin-stats.ts` (its forbidden-read comment lists the table)
- Modify: `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `CLAUDE.md`
- Test: `tests/db/provision.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. This task only removes surface.

- [ ] **Step 1: Find every reference**

```bash
grep -rn "ai_template\|getDefaultTemplate\|seedTemplates\|SeedTemplate" src/ tests/ e2e/ docs/ CLAUDE.md
```

Expected: hits in `schema.ts`, `user-db.ts`, `read.ts`, `app-state.ts`, `bundle-for-plan.ts`, `admin-stats.ts`, plus docs. Note every one before editing.

- [ ] **Step 2: Write the failing test**

Add to the `describe("openUserDb", ...)` block in `tests/db/provision.test.ts`. That block already has a `beforeEach` creating `dataDir` and an `afterEach` closing the outer `userDb` and removing the directory — assign to that outer `userDb` rather than making your own, or the `afterEach` will not clean up after you:

```ts
it("no longer provisions an ai_template table", () => {
  userDb = openUserDb(dataDir, "user-1", { now: NOW });

  const row = userDb.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_template'")
    .get();
  expect(row).toBeUndefined();
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run tests/db/provision.test.ts`
Expected: FAIL — the table still exists.

- [ ] **Step 4: Add migration 002**

In `src/lib/db/schema.ts`, add the migration constant next to `MIGRATION_001` and append it to `MIGRATIONS`. Do **not** edit `MIGRATION_001`'s SQL — it has already been applied on real volumes and migrations are append-only.

```ts
const MIGRATION_002 = `
-- The AI-instruction template is shipped app code, not per-user data: it is coupled to
-- the export's section numbering, the weight_kg invariant and the parser's error
-- behaviour, so a copy pinned at provisioning starts misinstructing the AI after any
-- change to those. Anything user-specific belongs in the plan document instead.
DROP TABLE IF EXISTS ai_template;
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "domain-model-v1", sql: MIGRATION_001 },
  { version: 2, name: "drop-ai-template", sql: MIGRATION_002 },
];
```

- [ ] **Step 5: Delete the seeding path**

In `src/lib/db/user-db.ts`: delete the `SeedTemplate` type, the `seedTemplates` field on `ProvisionOptions`, the `seedTemplatesIfEmpty` function, and the call to it in `openUserDb`. Remove the now-stale sentence about seeding from `openUserDb`'s doc comment.

In `src/lib/db/read.ts`: delete `getDefaultTemplate` and its doc comment.

In `src/lib/server/app-state.ts`: reduce the call to

```ts
const userDb = openUserDb(getConfig().dataDir, userId, { now: new Date() });
```

and drop the now-unused `defaultInstructionsTemplate` import if the file has one. Update the function's doc comment, which currently promises "the default AI-instruction template seeded from `templates/default-ai-instructions.md`".

- [ ] **Step 6: Point the export straight at the asset**

In `src/routes/plan/[slug]/export/bundle-for-plan.ts`, replace

```ts
instructions_template: getDefaultTemplate(userDb) ?? defaultInstructionsTemplate,
```

with

```ts
instructions_template: defaultInstructionsTemplate,
```

and remove `getDefaultTemplate` from the import list.

- [ ] **Step 7: Update `admin-stats.ts`'s comment**

Its doc comment enumerates the tables it must never read. Remove `ai_template` from that list — a table that does not exist cannot be in it, and a stale list makes the next reader doubt the rest.

- [ ] **Step 8: Fix the four assertions that pinned the schema at version 1**

Adding a second migration breaks four existing assertions in `tests/db/provision.test.ts`. They are correct assertions that have simply gone stale — update them, do not weaken them, and above all do not conclude the migration was a mistake:

| Line | Currently | Becomes |
|---|---|---|
| 41 | `expect(appliedSchemaVersion(userDb.db)).toBe(1)` | `.toBe(2)` |
| 46 | `expect(rows).toEqual([{ version: 1, name: "domain-model-v1", applied_at: NOW.toISOString() }])` | the same array plus `{ version: 2, name: "drop-ai-template", applied_at: NOW.toISOString() }` |
| 54 | `expect(appliedSchemaVersion(userDb.db)).toBe(1)` | `.toBe(2)` |
| 58 | `expect(count.n).toBe(1)` | `.toBe(2)` |

The test at line 54 reopens the database with a *different* `now`, which is the point of that test — but both migrations already ran on the first open, so the row count is what changes there, not the timestamps.

- [ ] **Step 9: Run the tests**

Run: `npx vitest run tests/db/ tests/export.test.ts tests/golden.test.ts`
Expected: PASS. If an export test asserted on a seeded template body, it should still pass — the asset is the same text that used to be seeded.

- [ ] **Step 10: Update the documentation**

`docs/ARCHITECTURE.md` §11 — replace the "Section 0 is the user-editable template" bullet. It argues a case, so write prose, not a list. It must say: Section 0 is shipped app code, seeded from `templates/default-ai-instructions.md`; it is deliberately plan-agnostic; it is not per-user and not editable in the app, because it is coupled to the export's structure, the `weight_kg` rule and the parser's error behaviour, and a pinned copy would misinstruct the AI after any change to those; anything user- or plan-specific belongs in the plan document, which Section 0 already defers to. Keep the existing sentence listing the six substitutions — they are unchanged.

`docs/ARCHITECTURE.md` §12 — the phase-8 row's deliverable drops "template editor".

`docs/ROADMAP.md` — delete the third phase-8 checklist item and drop "templates" from the phase-8 heading and the phase table's deliverable.

`CLAUDE.md` — widen the shipped-output invariant. It currently reads that `docs/CONTRACT.md` is shipped output reproduced in both outbound templates. Add that `templates/bootstrap-prompt.md` and `templates/default-ai-instructions.md` are shipped output on the same terms: editing either changes the instructions every AI receives, they are versioned with the app rather than per user, and nothing may reintroduce a per-user copy.

- [ ] **Step 11: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add -A
git commit -m "refactor(db): drop the per-user ai_template and use the shipped asset

templates/default-ai-instructions.md is app code, not user data. In a hundred
lines it references the export's section numbering, the weight_kg invariant, a
cross-reference into Section 4, the six substitution tokens and the parser's
error behaviour, so a copy pinned at provisioning does not go stale so much as
start misinstructing the AI with the app's authority behind it. That was the
live situation: seedTemplatesIfEmpty only seeds an empty table, so every
registered user was pinned to whatever the file said on the day they signed in,
with no editor and therefore no reason for any of them to have diverged.

Anything user-specific belongs in the plan document, which Section 0 already
defers to in its own words. This also removes an inconsistency: all three
outbound documents are ?raw imports, and the other two were already used
straight from the asset.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Batch 2 — The rename write path

Spec §2. Backend only, fully testable without any UI.

## Task 2: `importPlan` applies renames

**Files:**
- Modify: `src/lib/db/import-plan.ts`
- Test: `tests/db/rename.test.ts` (create)

**Interfaces:**
- Consumes: `importPlan(userDb, input)` as it exists today.
- Produces:
  - `export type ExerciseRename = { from: string; to: string };`
  - `ImportPlanInput` gains `renames?: readonly ExerciseRename[]` (optional, defaults to `[]`).
  - `ImportPlanFailure` gains a second member: `{ ok: false; kind: "invalid_rename"; message: string; from: string; to: string }`. The existing `version_not_newer` member is unchanged, so `ImportPlanFailure` becomes a union — callers that narrow on `kind` keep working, callers that read `.message` keep working, and `result.current_version` is now only reachable after narrowing to `version_not_newer`.

- [ ] **Step 1: Write the failing tests**

Create `tests/db/rename.test.ts`:

```ts
/**
 * The rename write path. A slug the AI returned mangled is mapped back onto the
 * exercise_def that holds its history, so charts stay one series instead of two.
 * The failure this guards is silent: nothing errors when history splits.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { parsePlanDocument } from "../../src/lib/parse/parser";

const ROOT = new URL("../../", import.meta.url);
const v1Md = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");
const NOW = new Date("2026-09-08T08:00:00Z");

/** v1 with `goblet-squat` rewritten to `goblet_squat` and the version bumped. */
function mangledV2(): string {
  return v1Md
    .replaceAll("goblet-squat", "goblet_squat")
    .replace("  version: 1", "  version: 2")
    .replace("  based_on_version: null", "  based_on_version: 1");
}

function importDoc(userDb: UserDb, md: string, renames: { from: string; to: string }[] = []) {
  const parsed = parsePlanDocument(md);
  if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}\n${parsed.report}`);
  return importPlan(userDb, { parsed, now: NOW, renames });
}

describe("importPlan renames", () => {
  let dataDir: string;
  let userDb: UserDb;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-rename-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });
    const first = importDoc(userDb, v1Md);
    if (!first.ok) throw new Error(first.message);
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function defRow(slug: string) {
    return userDb.db
      .prepare("SELECT id, slug, first_seen_version FROM exercise_def WHERE slug = ?")
      .get(slug) as { id: string; slug: string; first_seen_version: number } | undefined;
  }

  it("carries history onto the new slug instead of minting a second def", () => {
    const before = defRow("goblet-squat");
    expect(before).toBeDefined();

    const result = importDoc(userDb, mangledV2(), [{ from: "goblet-squat", to: "goblet_squat" }]);
    expect(result.ok).toBe(true);

    expect(defRow("goblet-squat")).toBeUndefined();
    expect(defRow("goblet_squat")?.id).toBe(before?.id);
  });

  it("leaves first_seen_version pointing at the movement's first version", () => {
    importDoc(userDb, mangledV2(), [{ from: "goblet-squat", to: "goblet_squat" }]);
    expect(defRow("goblet_squat")?.first_seen_version).toBe(1);
  });

  it("splits history into two defs when no rename is given", () => {
    const result = importDoc(userDb, mangledV2());
    expect(result.ok).toBe(true);
    expect(defRow("goblet-squat")).toBeDefined();
    expect(defRow("goblet_squat")).toBeDefined();
    expect(defRow("goblet-squat")?.id).not.toBe(defRow("goblet_squat")?.id);
  });

  it("rejects a rename whose `from` is still in the incoming catalogue", () => {
    const result = importDoc(userDb, mangledV2(), [{ from: "prone-row", to: "goblet_squat" }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.kind).toBe("invalid_rename");
  });

  it("rejects a rename whose `to` is not in the incoming catalogue", () => {
    const result = importDoc(userDb, mangledV2(), [{ from: "goblet-squat", to: "not-a-movement" }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.kind).toBe("invalid_rename");
  });

  it("rejects a rename whose `from` was never in this plan", () => {
    const result = importDoc(userDb, mangledV2(), [{ from: "never-existed", to: "goblet_squat" }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.kind).toBe("invalid_rename");
  });

  it("rejects two renames targeting the same slug", () => {
    const result = importDoc(userDb, mangledV2(), [
      { from: "goblet-squat", to: "goblet_squat" },
      { from: "prone-row", to: "goblet_squat" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.kind).toBe("invalid_rename");
  });

  it("writes nothing at all when a rename is invalid", () => {
    const before = userDb.db.prepare("SELECT COUNT(*) AS n FROM plan_version").get() as { n: number };
    importDoc(userDb, mangledV2(), [{ from: "never-existed", to: "goblet_squat" }]);
    const after = userDb.db.prepare("SELECT COUNT(*) AS n FROM plan_version").get() as { n: number };
    expect(after.n).toBe(before.n);
    expect(defRow("goblet-squat")).toBeDefined();
  });

  it("does not leave a staged source document behind on failure", () => {
    importDoc(userDb, mangledV2(), [{ from: "never-existed", to: "goblet_squat" }]);
    const dir = path.join(dataDir, "users", "user-1", "plans", "home-training");
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".staged"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/db/rename.test.ts`
Expected: FAIL — `renames` is not a known property of `ImportPlanInput`.

- [ ] **Step 3: Add the types**

In `src/lib/db/import-plan.ts`:

```ts
/** One accepted rename from the import review: the stored slug, and what it becomes. */
export type ExerciseRename = { from: string; to: string };

export type ImportPlanFailure =
  | {
      ok: false;
      kind: "version_not_newer";
      message: string;
      current_version: number;
      incoming_version: number;
    }
  | {
      ok: false;
      kind: "invalid_rename";
      message: string;
      from: string;
      to: string;
    };
```

and add to `ImportPlanInput`:

```ts
  /**
   * Renames accepted at the import review. Each maps a slug that exists in this
   * database onto a slug the incoming document declares, so the existing
   * exercise_def carries its history forward instead of a second one being minted.
   */
  renames?: readonly ExerciseRename[];
```

- [ ] **Step 4: Write the validator**

Add to `src/lib/db/import-plan.ts`, above `importPlan`:

```ts
/**
 * Validate the accepted renames against both sides before anything is written.
 *
 * Returns the failure to report, or `undefined` when every mapping is coherent.
 * Every check is a way for the review's choices to have gone stale between the
 * review and the commit — the document is re-parsed in between, so a mapping can
 * legitimately no longer make sense by the time it arrives here.
 */
function validateRenames(
  db: UserDb["db"],
  planId: string,
  contract: GainContract,
  renames: readonly ExerciseRename[],
): ImportPlanFailure | undefined {
  const incoming = new Set(contract.exercises.map((e) => e.id));
  const seenFrom = new Set<string>();
  const seenTo = new Set<string>();
  const exists = db.prepare("SELECT 1 FROM exercise_def WHERE plan_id = ? AND slug = ?");

  for (const { from, to } of renames) {
    const bad = (message: string): ImportPlanFailure => ({
      ok: false,
      kind: "invalid_rename",
      message,
      from,
      to,
    });

    if (from === to) return bad(`rename \`${from}\` to \`${to}\` maps a slug onto itself`);
    if (seenFrom.has(from)) return bad(`\`${from}\` is mapped more than once`);
    if (seenTo.has(to)) return bad(`two exercises are both mapped onto \`${to}\``);
    seenFrom.add(from);
    seenTo.add(to);

    if (!exists.get(planId, from)) {
      return bad(`\`${from}\` is not an exercise in this plan, so there is no history to carry`);
    }
    if (incoming.has(from)) {
      return bad(
        `\`${from}\` is still declared in the incoming plan, so it was not renamed — remove the mapping or ask the AI to drop the slug`,
      );
    }
    if (!incoming.has(to)) {
      return bad(`the incoming plan does not declare \`${to}\`, so there is nothing to rename onto`);
    }
    if (exists.get(planId, to)) {
      return bad(
        `\`${to}\` already has its own history in this plan and cannot absorb another movement's`,
      );
    }
  }

  return undefined;
}
```

`GainContract` and `UserDb` are already imported in this file.

- [ ] **Step 5: Write the apply step**

Add below the validator:

```ts
/**
 * Rewrite one exercise_def's slug, and the one denormalised copy of it.
 *
 * `deviation.substitute_exercise_slug` is the only slug in the schema stored as
 * loose text rather than reached through `exercise_def_id`, so it is the only
 * column that goes stale on its own. The join through `plan_version` is not
 * decoration: `workout` keys on `plan_version_id`, and without it a rename in one
 * plan would rewrite an identically-named slug's deviations in another.
 */
function applyRenames(db: UserDb["db"], planId: string, renames: readonly ExerciseRename[]): void {
  const renameDef = db.prepare("UPDATE exercise_def SET slug = ? WHERE plan_id = ? AND slug = ?");
  const renameSubstitute = db.prepare(
    `UPDATE deviation SET substitute_exercise_slug = ?
      WHERE substitute_exercise_slug = ?
        AND workout_id IN (SELECT w.id FROM workout w
                             JOIN plan_version pv ON pv.id = w.plan_version_id
                            WHERE pv.plan_id = ?)`,
  );

  for (const { from, to } of renames) {
    renameDef.run(to, planId, from);
    renameSubstitute.run(to, from, planId);
  }
}
```

- [ ] **Step 6: Wire both into `importPlan`**

Two edits. First, validate before the file is staged — a validation failure must not leave a `.staged` file behind, and the existing code stages before opening the transaction. Put this immediately after the existing version-guard block, which is also a pre-staging early return:

```ts
  const renames = input.renames ?? [];
  if (existingPlan && renames.length > 0) {
    const invalid = validateRenames(db, planId, contract, renames);
    if (invalid) return invalid;
  }
```

Second, inside the transaction, call `applyRenames` **immediately before** `upsertExerciseDefs`:

```ts
      // Renames run before the upsert. After it, a fresh exercise_def has already
      // been minted for the new slug and the history is already split, so a rename
      // applied afterwards would only be repairing damage this transaction caused.
      if (renames.length > 0) applyRenames(db, planId, renames);

      const defIdBySlug = upsertExerciseDefs(db, planId, plan.version, contract.exercises);
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/db/rename.test.ts`
Expected: PASS, all nine.

- [ ] **Step 8: Check nothing else broke**

Run: `npx vitest run`
Expected: PASS. `ImportPlanFailure` became a union; if any caller reads `.current_version` without narrowing on `kind`, `npm run typecheck` will say so — narrow it rather than casting.

- [ ] **Step 9: Update the schema comment and the invariant**

In `src/lib/db/schema.ts`, `exercise_def.slug`'s comment currently reads `-- STABLE ACROSS VERSIONS`. Change it to note the one exception:

```
  slug                TEXT NOT NULL,       -- stable across versions, except by a reviewed rename
```

In `CLAUDE.md`, under "Exercise slugs are load-bearing", add that the one sanctioned way a slug changes is an accepted rename at the import review, which updates the `exercise_def` row in place so history follows, and that `deviation.substitute_exercise_slug` is the one denormalised copy that has to move with it.

- [ ] **Step 10: Verify and commit**

Run: `npm run verify`

```bash
git add -A
git commit -m "feat(db): let an import review map a renamed slug onto its history

The diff engine has detected possible renames since phase 1 and there has never
been a way to act on one. importPlan gains a renames input, validated against
both sides before anything is staged and applied inside the existing
transaction, immediately before upsertExerciseDefs — after the upsert a fresh
exercise_def has already been minted for the new slug and the history is
already split.

Because every log read joins on exercise_def_id and renders exercise_def.slug,
updating that one row carries the whole history forward. The exception is
deviation.substitute_exercise_slug, the only slug stored as loose text, which
is rewritten alongside it and scoped through plan_version so a rename in one
plan cannot touch an identically-named slug in another.

exercise_def.slug therefore stops being unconditionally stable, so the schema
comment and the CLAUDE.md invariant both say so now.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Batch 3 — The v2 fixture

Spec §7. Independent of batches 1 and 2.

## Task 3: Author `fixtures/plans/home-training-v2.md`

**Files:**
- Create: `fixtures/plans/home-training-v2.md`
- Test: `tests/diff.test.ts` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: a fixture at `fixtures/plans/home-training-v2.md` whose `plan.slug` is `home-training` and `plan.version` is 2. Later tasks read it with `fs.readFileSync(new URL("fixtures/plans/home-training-v2.md", ROOT), "utf8")`.

**This fixture is fictional and must stay that way.** The repository is public; never commit real health data.

- [ ] **Step 1: Copy v1 as the starting point**

```bash
cp fixtures/plans/home-training-v1.md fixtures/plans/home-training-v2.md
```

The contract requires a whole document, not a patch, so v2 is v1 plus edits — not a fragment.

- [ ] **Step 2: Apply exactly these contract-block changes**

| # | Change | Where | Why it is in the fixture |
|---|---|---|---|
| 1 | `version: 1` to `version: 2`; `based_on_version: null` to `based_on_version: 1` | `plan` | Otherwise the diff is blocking |
| 2 | Replace `changelog` with 3–4 entries describing changes 3–12 in the AI's voice | `plan` | The review screen renders it unfolded |
| 3 | `goblet-squat` to `goblet_squat` everywhere in the block | catalogue, A/main, D/main | Heuristic-**caught** rename (identical after normalisation) |
| 4 | `rear-delt-reverse-fly` to `prone-reverse-fly`, and its `name:` from `Rear-delt reverse fly (prone)` to `Prone reverse fly` | catalogue, C/main | Heuristic-**missed** rename — edit distance far over 2 and a different display name, so `findRenameCandidates` produces nothing and only any-to-any mapping can express it |
| 5 | Delete `hammer-curl` from the catalogue and from D/main | catalogue, D/main | A genuine removal, so *Removed on purpose* is exercised |
| 6 | Add `single-leg-glute-bridge` to the catalogue (`per_side: true`, `load: bodyweight`, `rest_sec: [45, 60]`, a `note`) and prescribe it in C/main as `{id: single-leg-glute-bridge, sets: 2, reps: [8, 10]}` | catalogue, C/main | An added exercise |
| 7 | A/main `goblet_squat`: `reps: [8, 12]` to `reps: [10, 14]` | A/main | A changed reps range |
| 8 | A/main `db-floor-press`: `sets: 3` to `sets: [3, 4]` | A/main | A changed sets target, scalar to range |
| 9 | C/main `split-squat`: `load: light-pair` to `load: goblet` | C/main | A changed load |
| 10 | D/main `prone-row`: `rest_sec: 60` to `rest_sec: [60, 75]` | D/main | A changed rest, scalar to range |
| 11 | Add a session-scope metric `sleep_quality` (`type: scale`, `min: 1`, `max: 5`, `optional: true`, `prompt_when: start`) | `metrics.session` | An added metric definition |
| 12 | Delete the exercise-scope metric `technique` | `metrics.exercise` | A removed metric — produces the orphaned-history warning |

Change 3 must not touch the prose: prose refers to movements by their human names, and the slug appears only in the block. Change 5 does touch the prose — v1's prose discusses the arm work in session D, and leaving a paragraph describing an exercise the plan no longer prescribes would be a document that contradicts itself.

- [ ] **Step 3: Revise the prose**

Edit the surrounding prose so the document reads as a genuine second version, not v1 with a bumped number:

- Add a short "What changed in version 2, and why" section near the top, in the plan's own voice, covering the same ground as the changelog at more length.
- Update the session D arm-work paragraph to reflect `hammer-curl` being gone.
- Update the session C paragraph to introduce `single-leg-glute-bridge` and the heavier split-squat load.
- Leave the injury context, equipment list and progression philosophy alone — a revision that rewrites those is not what this fixture is testing.

Keep it fictional and keep the tone consistent with v1.

- [ ] **Step 4: Assert it parses and diffs as intended**

Append to `tests/diff.test.ts`:

```ts
describe("the real v1 to v2 fixture pair", () => {
  const ROOT = new URL("../", import.meta.url);
  const read = (p: string) => fs.readFileSync(new URL(p, ROOT), "utf8");

  function contractOf(p: string): GainContract {
    const parsed = parsePlanDocument(read(p));
    if (!parsed.ok) throw new Error(`${p} failed to parse:\n${parsed.report}`);
    return parsed.contract;
  }

  const before = contractOf("fixtures/plans/home-training-v1.md");
  const after = contractOf("fixtures/plans/home-training-v2.md");
  const diff = diffContracts(before, after);

  it("is a clean revision with nothing blocking", () => {
    expect(diff.blocking).toEqual([]);
    expect(diff.plan.version_incremented).toBe(true);
    expect(diff.plan.changelog.length).toBeGreaterThan(0);
  });

  it("reports all three departed slugs", () => {
    expect(diff.exercises.removed.map((e) => e.id).sort()).toEqual([
      "goblet-squat",
      "hammer-curl",
      "rear-delt-reverse-fly",
    ]);
  });

  it("catches the punctuation rename and misses the reworded one", () => {
    const pairs = diff.exercises.possible_renames.map((r) => `${r.from}->${r.to}`);
    expect(pairs).toContain("goblet-squat->goblet_squat");
    expect(pairs.some((p) => p.startsWith("rear-delt-reverse-fly->"))).toBe(false);
  });

  it("reports the added exercise", () => {
    expect(diff.exercises.added.map((e) => e.id)).toContain("single-leg-glute-bridge");
  });

  it("reports the metric added and the metric removed", () => {
    expect(diff.metrics.added.map((m) => m.def.key)).toContain("sleep_quality");
    expect(diff.metrics.removed.map((m) => m.def.key)).toContain("technique");
  });

  it("reports the changed targets", () => {
    const changed = diff.prescriptions.filter((p) => p.status === "changed");
    const fields = changed.flatMap((p) => p.changes.map((c) => `${p.session}:${p.id}:${c.field}`));
    expect(fields).toContain("A:db-floor-press:sets");
    expect(fields).toContain("C:split-squat:load");
    expect(fields).toContain("D:prone-row:rest_sec");
  });
});
```

Add `import fs from "node:fs";`, `import { parsePlanDocument } from "../src/lib/parse/parser";` and `import type { GainContract } from "../src/lib/contract/schema";` to the top of the file if they are not already there.

Note the deliberate absence of an assertion on `A:goblet_squat:reps`. Prescriptions are matched by exercise id, so an unmapped rename makes the old prescription `removed` and the new one `added` rather than `changed` — change 7's reps edit rides along inside that pair and is not reported as a field change. That is correct engine behaviour, and it is worth a comment in the test so the next reader does not "fix" it.

- [ ] **Step 5: Run it**

Run: `npx vitest run tests/diff.test.ts`
Expected: PASS.

- [ ] **Step 6: Confirm the fixture stayed out of Prettier's way**

Run: `npm run format:check`
Expected: PASS, with `fixtures/` untouched — it is in `.prettierignore` and must stay there.

- [ ] **Step 7: Verify and commit**

Run: `npm run verify`

```bash
git add -A
git commit -m "test(diff): add the v2 revision fixture and diff it against v1

Phase 8's done-when is a real round trip and there was nothing to import: the
repository held one plan document and the diff tests built small synthetic
contracts. This is a genuine second version of the same fictional plan,
carrying two renames — one the heuristics catch because it is only punctuation,
one they miss entirely because it is a different word with a different display
name — plus a real removal, an added exercise, changed targets and a metric
added and removed.

The reworded rename is the point. It is what proves mapping any removed slug
onto any added one earns its place over offering only the detected candidates.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

## Task 4: The golden test covers v2

**Files:**
- Modify: `tests/golden.test.ts`

**Interfaces:**
- Consumes: `fixtures/plans/home-training-v2.md` from Task 3.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `tests/golden.test.ts`, following the file's existing helpers rather than re-deriving them:

```ts
describe("a revision round-trips as faithfully as a first import", () => {
  it("replays v2's source_md byte-for-byte after importing it over v1", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-golden-v2-"));
    const userDb = openUserDb(dataDir, "user-1", { now: NOW });

    const v1 = parsePlanDocument(read("fixtures/plans/home-training-v1.md"));
    if (!v1.ok) throw new Error(v1.report);
    expect(importPlan(userDb, { parsed: v1, now: NOW }).ok).toBe(true);

    const v2Md = read("fixtures/plans/home-training-v2.md");
    const v2 = parsePlanDocument(v2Md);
    if (!v2.ok) throw new Error(v2.report);
    const secondImport = importPlan(userDb, {
      parsed: v2,
      now: NOW,
      renames: [
        { from: "goblet-squat", to: "goblet_squat" },
        { from: "rear-delt-reverse-fly", to: "prone-reverse-fly" },
      ],
    });
    if (!secondImport.ok) throw new Error(secondImport.message);

    expect(fs.readFileSync(secondImport.source_path, "utf8")).toBe(v2Md);

    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
```

If `golden.test.ts` names its file-reading helper something other than `read`, or its clock something other than `NOW`, use the file's own names.

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/golden.test.ts`
Expected: PASS. If the byte comparison fails, the fixture picked up a trailing-newline change from an editor — fix the fixture, never the assertion.

- [ ] **Step 3: Verify and commit**

Run: `npm run verify`

```bash
git add -A
git commit -m "test(golden): round-trip a revision import, renames and all

The golden test proved a first import replays byte-for-byte and said nothing
about the second one, which is the import that carries renames and therefore
the one with a write path that could corrupt the document on its way to disk.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Batch 4 — The presentation module

Spec §4. Depends on Batch 3 for its test fixture.

## Task 5: `src/lib/diff/present.ts`

**Files:**
- Create: `src/lib/diff/present.ts`
- Test: `tests/diff/present.test.ts` (create; `mkdir -p tests/diff` first)

**Interfaces:**
- Consumes: `ContractDiff`, `FieldChange` from `src/lib/diff/diff.ts`; `GainContract`, `MetricScope`, `deriveExerciseName` from `src/lib/contract/schema.ts`.
- Produces:

```ts
export function formatValue(value: unknown): string;
export function presentDiff(
  diff: ContractDiff,
  before: GainContract,
  after: GainContract,
): DiffPresentation;

export type ChangeEntry = { headline: string; details: readonly string[] };
export type ChangeGroup = { key: string; title: string; entries: readonly ChangeEntry[] };
export type RenameOption = { slug: string; name: string };
export type Disposition = {
  slug: string;
  name: string;
  suggested: string | null;
  reason: string | null;
  options: readonly RenameOption[];
};
export type DiffPresentation = {
  planSlug: string;
  fromVersion: number;
  toVersion: number;
  blocking: readonly string[];
  warnings: readonly string[];
  changelog: readonly string[];
  dispositions: readonly Disposition[];
  groups: readonly ChangeGroup[];
};
```

`ChangeGroup` has no `count` field — the screen renders `entries.length`, so there is no second copy of the number to fall out of sync.

**`presentDiff` builds `warnings` from the diff's structured fields and ignores `diff.warnings` entirely.** The engine's warning strings duplicate what the dispositions already ask about, and filtering them by prefix would break the first time a message is reworded. Everything needed is structured: `exercises.unreferenced`, `metrics.removed`, and the `based_on_version` check, which `presentDiff` recomputes from the two contracts it is handed.

- [ ] **Step 1: Write the failing tests**

Create `tests/diff/present.test.ts`:

```ts
/**
 * The diff presentation layer. Its job is to be readable on a phone: display names
 * rather than slugs, formatted values rather than raw JSON, and one disposition row
 * per departed slug so no rename can be committed unexamined.
 */

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { GainContract } from "../../src/lib/contract/schema";
import { diffContracts } from "../../src/lib/diff/diff";
import { formatValue, presentDiff } from "../../src/lib/diff/present";
import { parsePlanDocument } from "../../src/lib/parse/parser";

const ROOT = new URL("../../", import.meta.url);

function contractOf(p: string): GainContract {
  const parsed = parsePlanDocument(fs.readFileSync(new URL(p, ROOT), "utf8"));
  if (!parsed.ok) throw new Error(`${p} failed to parse:\n${parsed.report}`);
  return parsed.contract;
}

const before = contractOf("fixtures/plans/home-training-v1.md");
const after = contractOf("fixtures/plans/home-training-v2.md");
const view = presentDiff(diffContracts(before, after), before, after);

describe("formatValue", () => {
  it("renders a range as a range, never as a comma-joined tuple", () => {
    expect(formatValue([8, 12])).toBe("8–12");
  });

  it("collapses a degenerate range to the single number it means", () => {
    expect(formatValue([12, 12])).toBe("12");
  });

  it("renders a bare number unchanged", () => {
    expect(formatValue(60)).toBe("60");
  });

  it("renders an absent value as a dash rather than 'undefined'", () => {
    expect(formatValue(undefined)).toBe("—");
    expect(formatValue(null)).toBe("—");
  });

  it("renders a substitutes list comma-separated", () => {
    expect(formatValue(["dead-bug", "front-plank"])).toBe("dead-bug, front-plank");
  });

  it("renders a boolean as yes or no, not true or false", () => {
    expect(formatValue(true)).toBe("yes");
  });
});

describe("presentDiff", () => {
  it("asks for a disposition for every departed slug", () => {
    expect(view.dispositions.map((d) => d.slug).sort()).toEqual([
      "goblet-squat",
      "hammer-curl",
      "rear-delt-reverse-fly",
    ]);
  });

  it("pre-selects the heuristic match and leaves the others unsuggested", () => {
    const goblet = view.dispositions.find((d) => d.slug === "goblet-squat");
    expect(goblet?.suggested).toBe("goblet_squat");
    expect(goblet?.reason).toBeTruthy();

    const reworded = view.dispositions.find((d) => d.slug === "rear-delt-reverse-fly");
    expect(reworded?.suggested).toBeNull();
  });

  it("offers every added slug as a mapping target, however it was detected", () => {
    const reworded = view.dispositions.find((d) => d.slug === "rear-delt-reverse-fly");
    expect(reworded?.options.map((o) => o.slug)).toContain("prone-reverse-fly");
    expect(reworded?.options.map((o) => o.slug)).toContain("single-leg-glute-bridge");
  });

  it("uses display names, not slugs, in a disposition row", () => {
    const goblet = view.dispositions.find((d) => d.slug === "goblet-squat");
    expect(goblet?.name).not.toContain("-");
  });

  it("carries the changelog through", () => {
    expect(view.changelog.length).toBeGreaterThan(0);
  });

  it("groups the changed targets and names them in plain language", () => {
    const targets = view.groups.find((g) => g.key === "targets");
    expect(targets).toBeDefined();
    const headlines = targets?.entries.map((e) => e.headline) ?? [];
    expect(headlines.some((h) => h.includes("Dumbbell floor press"))).toBe(true);
    const detail = targets?.entries.flatMap((e) => e.details).join(" ") ?? "";
    expect(detail).not.toContain("8,12");
  });

  it("emits no empty groups", () => {
    for (const group of view.groups) expect(group.entries.length).toBeGreaterThan(0);
  });

  it("warns that a removed metric orphans its history", () => {
    expect(view.warnings.join(" ")).toContain("technique");
  });

  it("does not repeat the departed slugs as warnings — they are dispositions", () => {
    expect(view.warnings.join(" ")).not.toContain("hammer-curl");
  });

  it("reports nothing blocking for a clean revision", () => {
    expect(view.blocking).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/diff/present.test.ts`
Expected: FAIL — cannot resolve `src/lib/diff/present`.

- [ ] **Step 3: Write `formatValue` and the types**

Create `src/lib/diff/present.ts`:

```ts
/**
 * The diff, arranged for a phone screen.
 *
 * `diffContracts` answers "what is different" in the contract's own vocabulary:
 * slugs, field names, and values typed `unknown`. This turns that into something
 * readable at arm's length — display names, formatted values, and one group per
 * kind of change — and derives the disposition every departed slug needs before
 * the import may be committed.
 *
 * Pure, like the engine it decorates. It is also the one place ranges are turned
 * into strings: a contract range is a tuple, and `[8, 12]` interpolates as `8,12`,
 * which is not a typo the reader would notice on a screen full of numbers.
 */

import type { GainContract, MetricScope } from "../contract/schema";
import { deriveExerciseName } from "../contract/schema";
import type { ContractDiff, FieldChange } from "./diff";

export type ChangeEntry = { headline: string; details: readonly string[] };
export type ChangeGroup = { key: string; title: string; entries: readonly ChangeEntry[] };
export type RenameOption = { slug: string; name: string };

export type Disposition = {
  slug: string;
  name: string;
  /** Pre-selected mapping target, when the engine found a convincing one. */
  suggested: string | null;
  /** Why it was suggested, in the engine's words. Null when nothing was suggested. */
  reason: string | null;
  /** Every added slug, so a rename the heuristics missed is still expressible. */
  options: readonly RenameOption[];
};

export type DiffPresentation = {
  planSlug: string;
  fromVersion: number;
  toVersion: number;
  blocking: readonly string[];
  warnings: readonly string[];
  changelog: readonly string[];
  dispositions: readonly Disposition[];
  groups: readonly ChangeGroup[];
};

const FIELD_LABELS: Readonly<Record<string, string>> = {
  sets: "Sets",
  reps: "Reps",
  duration_sec: "Duration",
  rest_sec: "Rest",
  load: "Load",
  note: "Note",
  conditional: "Conditional",
  condition: "Condition",
  substitutes: "Substitutes",
  name: "Name",
  type: "Type",
  per_side: "Per side",
  rounds: "Rounds",
  tracking: "Tracking",
  order: "Order",
  label: "Label",
  default_kg: "Default weight",
  is_bodyweight: "Bodyweight",
  min: "Minimum",
  max: "Maximum",
  options: "Options",
  optional: "Optional",
  prompt_when: "Asked",
};

/** A contract value as a reader should see it. Ranges are tuples — format, never interpolate. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every((v) => typeof v === "number")) {
      const [lo, hi] = value as [number, number];
      return lo === hi ? String(lo) : `${lo}–${hi}`;
    }
    return value.map((v) => formatValue(v)).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function label(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** "Reps 8–12 to 10–14" */
function describeChange(change: FieldChange): string {
  return `${label(change.field)}: ${formatValue(change.from)} to ${formatValue(change.to)}`;
}
```

The en-dash in the range and the em-dash used for an absent value are ordinary characters, not control characters; `npm run check:chars` is satisfied by them.

- [ ] **Step 4: Run the `formatValue` tests**

Run: `npx vitest run tests/diff/present.test.ts -t formatValue`
Expected: PASS. The `presentDiff` tests still fail.

- [ ] **Step 5: Write `presentDiff`**

Append to `src/lib/diff/present.ts`:

```ts
function nameLookup(contract: GainContract): (slug: string) => string {
  const names = new Map(contract.exercises.map((e) => [e.id, e.name ?? deriveExerciseName(e.id)]));
  return (slug) => names.get(slug) ?? deriveExerciseName(slug);
}

function sessionNames(contract: GainContract): Map<string, string> {
  return new Map(contract.sessions.map((s) => [s.key, s.name]));
}

function blockName(contract: GainContract, sessionKey: string, blockKey: string): string {
  const block = contract.sessions
    .find((s) => s.key === sessionKey)
    ?.blocks.find((b) => b.key === blockKey);
  return block?.name ?? blockKey;
}

const SCOPE_LABELS: Readonly<Record<MetricScope, string>> = {
  set: "per set",
  exercise: "per exercise",
  session: "per session",
};

export function presentDiff(
  diff: ContractDiff,
  before: GainContract,
  after: GainContract,
): DiffPresentation {
  const nameBefore = nameLookup(before);
  const nameAfter = nameLookup(after);
  const sessionsAfter = sessionNames(after);
  const sessionsBefore = sessionNames(before);
  const sessionName = (key: string): string =>
    sessionsAfter.get(key) ?? sessionsBefore.get(key) ?? key;

  // -- Dispositions: one per departed slug, every added slug offered as a target.
  const options: RenameOption[] = diff.exercises.added
    .map((e) => ({ slug: e.id, name: nameAfter(e.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const dispositions: Disposition[] = diff.exercises.removed.map((removed) => {
    const candidate = diff.exercises.possible_renames.find((r) => r.from === removed.id);
    return {
      slug: removed.id,
      name: nameBefore(removed.id),
      suggested: candidate?.to ?? null,
      reason: candidate?.reason ?? null,
      options,
    };
  });

  // -- Warnings, rebuilt from structure. The engine's strings restate the
  //    dispositions above, and matching them by prefix to strip them would break
  //    the first time a message is reworded.
  const warnings: string[] = [];
  if (after.plan.based_on_version !== before.plan.version) {
    warnings.push(
      `This revision says it is based on version ${after.plan.based_on_version ?? "nothing"}, but the version it replaces is ${before.plan.version}.`,
    );
  }
  for (const id of diff.exercises.unreferenced) {
    warnings.push(`${nameAfter(id)} is in the catalogue but no session prescribes it.`);
  }
  for (const { scope, def } of diff.metrics.removed) {
    warnings.push(
      `The ${SCOPE_LABELS[scope]} metric "${def.label}" (${def.key}) is gone. Everything already logged against it stays, but nothing new will be.`,
    );
  }

  // -- Change groups. Empty ones are dropped rather than rendered as "0 changes".
  const groups: ChangeGroup[] = [];
  const add = (key: string, title: string, entries: ChangeEntry[]): void => {
    if (entries.length > 0) groups.push({ key, title, entries });
  };

  add("sessions", "Sessions", [
    ...diff.sessions.added.map((key) => ({ headline: sessionName(key), details: ["Added"] })),
    ...diff.sessions.removed.map((key) => ({ headline: sessionName(key), details: ["Removed"] })),
    ...diff.sessions.changed.map((c) => ({
      headline: sessionName(c.key),
      details: c.changes.map(describeChange),
    })),
  ]);

  add(
    "blocks",
    "Blocks",
    diff.sessions.blocks.flatMap((b) => [
      ...b.added.map((key) => ({
        headline: `${sessionName(b.session)} · ${blockName(after, b.session, key)}`,
        details: ["Added"],
      })),
      ...b.removed.map((key) => ({
        headline: `${sessionName(b.session)} · ${blockName(before, b.session, key)}`,
        details: ["Removed"],
      })),
      ...b.changed.map((c) => ({
        headline: `${sessionName(b.session)} · ${blockName(after, b.session, c.key)}`,
        details: c.changes.map(describeChange),
      })),
    ]),
  );

  add(
    "exercises-added",
    "Exercises added",
    diff.exercises.added.map((e) => ({
      headline: nameAfter(e.id),
      details: [e.note ?? `Added to the catalogue as ${e.id}.`],
    })),
  );

  add(
    "exercises-changed",
    "Exercises changed",
    diff.exercises.changed.map((c) => ({
      headline: nameAfter(c.id),
      details: c.changes.map(describeChange),
    })),
  );

  add(
    "targets",
    "Targets changed",
    diff.prescriptions.map((p) => ({
      headline: `${sessionName(p.session)} · ${blockName(after, p.session, p.block)} · ${nameAfter(p.id)}`,
      details:
        p.status === "changed"
          ? p.changes.map(describeChange)
          : [p.status === "added" ? "Added to this block" : "Removed from this block"],
    })),
  );

  add("metrics", "Metrics", [
    ...diff.metrics.added.map((m) => ({
      headline: `${m.def.label} (${SCOPE_LABELS[m.scope]})`,
      details: ["Added"],
    })),
    ...diff.metrics.removed.map((m) => ({
      headline: `${m.def.label} (${SCOPE_LABELS[m.scope]})`,
      details: ["Removed"],
    })),
    ...diff.metrics.changed.map((m) => ({
      headline: `${m.key} (${SCOPE_LABELS[m.scope]})`,
      details: m.changes.map(describeChange),
    })),
  ]);

  add("loads", "Loads", [
    ...diff.loads.added.map((l) => ({ headline: l.label, details: ["Added"] })),
    ...diff.loads.removed.map((l) => ({ headline: l.label, details: ["Removed"] })),
    ...diff.loads.changed.map((l) => ({ headline: l.ref, details: l.changes.map(describeChange) })),
  ]);

  const flags: ChangeEntry[] = [];
  if (diff.scheduling_changed) flags.push({ headline: "Scheduling", details: ["Changed"] });
  if (diff.progression_changed) flags.push({ headline: "Progression", details: ["Changed"] });
  if (diff.safety_changed) flags.push({ headline: "Safety rules", details: ["Changed"] });
  add("rules", "Plan rules", flags);

  return {
    planSlug: diff.after.slug,
    fromVersion: diff.before.version,
    toVersion: diff.after.version,
    blocking: diff.blocking,
    warnings,
    changelog: diff.plan.changelog,
    dispositions,
    groups,
  };
}
```

- [ ] **Step 6: Run the whole file**

Run: `npx vitest run tests/diff/present.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify and commit**

Run: `npm run verify`

```bash
git add -A
git commit -m "feat(diff): arrange a contract diff for a phone screen

diffContracts answers what changed in the contract's own vocabulary — slugs,
field names, values typed unknown. presentDiff turns that into something
readable at arm's length and derives the disposition every departed slug needs
before an import may be committed.

It rebuilds the warning list from the diff's structured fields rather than
passing diff.warnings through, because those strings restate what the
dispositions already ask about and stripping them by prefix would break the
first time a message was reworded.

It is also the one place a range becomes a string. A contract range is a tuple,
[8, 12] interpolates as 8,12, and on a screen full of numbers that is not a
typo anyone would catch.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Batch 5 — The `/import` route

Spec §3 and §5. Depends on Batches 2 and 4.

## Task 6: Move the import flow to `/import`

No review UI yet — this task moves what exists and leaves the tree green. Splitting it from Task 7 means the move can be reviewed on its own, without the new screen's markup obscuring it.

**Files:**
- Create: `src/routes/import/+page.server.ts`, `src/routes/import/+page.svelte`
- Move: `src/routes/ImportPlanForm.svelte` to `src/routes/import/ImportPlanForm.svelte`
- Modify: `src/routes/+page.server.ts` (delete the `import` and `confirmImport` actions and their now-unused imports)
- Modify: `src/routes/+page.svelte` (three embedded forms become links)
- Test: `tests/server/import-route.test.ts` (create)

**Interfaces:**
- Consumes: `prepareImportReview` (`$lib/db/review`), `importPlan` and `ExerciseRename` (`$lib/db/import-plan`), `parsePlanDocument` (`$lib/parse/parser`), `presentDiff` (`$lib/diff/present`), `contractOfVersion`/`getCurrentVersion`/`getPlanBySlug` (`$lib/db/read`).
- Produces: a route at `/import` with two actions, `?/check` and `?/commit`.

- [ ] **Step 1: Move the form component**

```bash
mkdir -p src/routes/import
git mv src/routes/ImportPlanForm.svelte src/routes/import/ImportPlanForm.svelte
```

Change its form's action from `?/import` to `?/check` — it now posts to the route it lives in.

- [ ] **Step 2: Write the server route**

Create `src/routes/import/+page.server.ts`. Lift the bodies of the `import` and `confirmImport` actions out of `src/routes/+page.server.ts` rather than rewriting them; they are correct, they only need a new home and the review turned into a presentation.

```ts
/**
 * The import screen — every crossing back from an AI lands here.
 *
 * Paste box, parse-error report and diff review are one route because
 * UI-DECISIONS §11 requires a failed import to keep the pasted text in place with
 * the copy-the-error action beside it, so the textarea has to live wherever errors
 * render. And ARCHITECTURE §8 insists the first import is not a special case in
 * the pipeline; routing revisions to their own screen would have made it one.
 *
 * Nothing is stashed between the two actions. The document and the rename
 * dispositions ride hidden fields, and `commit` re-parses and re-derives the diff,
 * so a document edited between review and commit gets its mappings rejected
 * rather than silently applied to something else.
 */

import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { parsePlanDocument } from "$lib/parse/parser";
import { prepareImportReview } from "$lib/db/review";
import { importPlan, type ExerciseRename } from "$lib/db/import-plan";
import { presentDiff } from "$lib/diff/present";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import type { UserDb } from "$lib/db/user-db";
import type { GainContract } from "$lib/contract/schema";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, "/login");
  return {};
};

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** The stored current contract for a plan slug, or undefined if it cannot be read. */
function currentContract(userDb: UserDb, planSlug: string): GainContract | undefined {
  const plan = getPlanBySlug(userDb, planSlug);
  const current = plan ? getCurrentVersion(userDb, plan.id) : undefined;
  return current ? contractOfVersion(current) : undefined;
}

export const actions: Actions = {
  check: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const source = formText(await request.formData(), "source_md");

    if (!source.trim()) {
      return fail(400, { importError: "Paste a plan document first.", source });
    }

    const parsed = parsePlanDocument(source);
    if (!parsed.ok) {
      return fail(400, { importFailure: { kind: parsed.kind, report: parsed.report }, source });
    }

    const userDb = getUserDbFor(locals.user.id);
    const review = prepareImportReview(userDb, parsed);

    if (review.kind === "first_import") {
      return { firstImport: review, source };
    }

    const before = currentContract(userDb, review.plan_slug);
    if (!before) {
      return fail(500, { importError: "The stored plan could not be read.", source });
    }

    return { revision: presentDiff(review.diff, before, parsed.contract), source };
  },

  commit: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const form = await request.formData();
    const source = formText(form, "source_md");

    const parsed = parsePlanDocument(source);
    if (!parsed.ok) {
      return fail(400, { importFailure: { kind: parsed.kind, report: parsed.report }, source });
    }

    const userDb = getUserDbFor(locals.user.id);
    const review = prepareImportReview(userDb, parsed);

    const renames: ExerciseRename[] = [];
    if (review.kind === "revision") {
      const before = currentContract(userDb, review.plan_slug);
      if (!before) {
        return fail(500, { importError: "The stored plan could not be read.", source });
      }
      const view = presentDiff(review.diff, before, parsed.contract);

      if (view.blocking.length > 0) {
        return fail(400, { importError: view.blocking.join(" "), source });
      }

      for (const disposition of view.dispositions) {
        const choice = formText(form, `disposition:${disposition.slug}`);
        if (choice === "") {
          return fail(400, {
            importError: `Say what happened to ${disposition.name} before committing.`,
            source,
          });
        }
        if (choice === "removed") continue;
        if (!choice.startsWith("rename:")) {
          return fail(400, { importError: `Unrecognised choice for ${disposition.name}.`, source });
        }
        renames.push({ from: disposition.slug, to: choice.slice("rename:".length) });
      }
    }

    const result = importPlan(userDb, { parsed, now: new Date(), renames });
    if (!result.ok) {
      return fail(409, { importError: result.message, source });
    }

    throw redirect(303, "/");
  },
};
```

- [ ] **Step 3: Write the page, review section stubbed**

Create `src/routes/import/+page.svelte`. Move the parse-failure and first-import markup out of `src/routes/+page.svelte` verbatim — including the export-bundle special case, which UI-DECISIONS §11 requires to name the mistake rather than show field paths. Leave the revision branch as a single placeholder line; Task 7 replaces it.

The page's shape:

```svelte
<script lang="ts">
  import { enhance } from "$app/forms";
  import IconCircleCheck from "~icons/lucide/circle-check";
  import ImportPlanForm from "./ImportPlanForm.svelte";
  import type { ActionData } from "./$types";

  let { form }: { form: ActionData } = $props();
  let pasted = $state(form?.source ?? "");
</script>
```

then, in order: an `<h1>`, the `ImportPlanForm`, the `importError` card, the `importFailure` cards (bundle case and parse-report case), the `firstImport` summary card with its commit form, and the revision placeholder. Each commit form carries the source forward:

```svelte
<form method="POST" action="?/commit" use:enhance>
  <input type="hidden" name="source_md" value={form?.source ?? ""} />
  <button type="submit" class="primary"><IconCircleCheck />Commit import</button>
</form>
```

**`use:enhance` on every form.** Without it a failed import is a full navigation, the component remounts, and the pasted document is gone — the exact wall §11 says a failed import must not be.

- [ ] **Step 4: Point Home at the route**

In `src/routes/+page.svelte`, replace all three `<ImportPlanForm bind:pasted />` usages with a link, and delete the `pasted` state and the `ImportPlanForm` import. The empty-state one carries the most weight — first run gains a tap here, so it is a primary button, not a text link:

```svelte
<a class="primary-link" href="/import"><IconUpload />Paste the plan your AI gave you</a>
```

The two plan-card variants get the same link with wording suited to a revision ("Import a revised plan"). Delete the `data.plans.length > 1` standalone card and the `import-inline` block's explanatory copy — one route means the "which plan is this import for" comment no longer applies, since the document's own `plan.slug` decides.

In `src/routes/+page.server.ts`, delete the `import` and `confirmImport` actions and any import statement they alone used (`parsePlanDocument`, `prepareImportReview`, `importPlan`, and `fail` if nothing else uses it). Leave the `bootstrapPrompt` action alone.

- [ ] **Step 5: Write the route test**

**Read `tests/server/export-route.test.ts` first** and mirror its harness exactly — how it points `DATA_DIR` at a temp directory, how it builds the `locals.user` and `FormData` stubs, and how it calls an action directly rather than over HTTP. Do not invent a second harness shape; if that file's helpers are not exported, lift them rather than re-deriving them.

Seven cases, each calling the real action:

| Case | Arrange | Assert |
|---|---|---|
| First import | `?/check` with v1 into an empty db | result has `firstImport`, and its `counts.sessions` is 4 |
| Malformed YAML | `?/check` with v1 whose block has a broken line | `fail(400)`, `importFailure.report` is non-empty, `source` echoes the input back verbatim |
| Pasted bundle | `?/check` with a string starting `# GAIN Export` | `importFailure.kind` is `export_bundle` — never a field-path report |
| Revision review | import v1, then `?/check` with v2 | result has `revision`, and `revision.dispositions` has length 3 |
| Undispositioned commit | import v1, then `?/commit` with v2 and **no** `disposition:` fields | `fail(400)`, and `plan_version` still has exactly one row |
| Clean commit | import v1, then `?/commit` with v2 and all three dispositions | throws `redirect` to `/`, and `plan_version` has two rows |
| Rename applied | as above, with `disposition:goblet-squat` = `rename:goblet_squat` | `SELECT slug FROM exercise_def WHERE slug = 'goblet_squat'` returns a row and `'goblet-squat'` returns none |

The last two matter most: one proves the happy path, the other proves the disposition actually reached `importPlan` rather than being parsed and dropped. Assert on `exercise_def` directly, the way `tests/db/rename.test.ts` does — a green action result proves nothing about what was written.

A committing action throws `redirect(303, "/")`, which is a SvelteKit control-flow throw rather than an error. Catch it and assert on its `status` and `location`; `expect(...).rejects` on the action call is the usual shape.

- [ ] **Step 6: Run everything**

Run: `npx vitest run` then `npm run check`
Expected: PASS. `svelte-check` is what catches a prop removed from Home but still referenced.

- [ ] **Step 7: Look at it in a browser**

Per CLAUDE.md, write a throwaway spec under `e2e/`, screenshot `/import` at the `iphone` project, and read the file with the Read tool. Check the paste box, an error report and the first-import summary all render without horizontal overflow. Delete the spec before committing — it is scaffolding, not coverage.

- [ ] **Step 8: Verify and commit**

Run: `npm run verify`

```bash
git add -A
git commit -m "feat(import): give the import flow its own screen

ImportPlanForm rendered in three places on Home while the failure report and the
review rendered at the bottom of the document — already the phase-4 'an error
the user cannot see' problem in miniature, and a diff with dozens of changed
targets would have made the home screen unusable.

Paste box, parse-error report and review are now one route. UI-DECISIONS §11
requires a failed import to keep the pasted text in place with the copy-the-error
action beside it, so the textarea has to live wherever errors render; and
ARCHITECTURE §8 insists the first import is not a special case in the pipeline,
which routing only revisions elsewhere would have undone.

The cost is honest: first run gains a tap, so the empty state's link is a
primary button rather than an aside.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

## Task 7: The review screen

**Files:**
- Create: `src/routes/import/DispositionList.svelte`, `src/routes/import/DiffGroups.svelte`
- Modify: `src/routes/import/+page.svelte`

**Interfaces:**
- Consumes: `DiffPresentation`, `Disposition`, `ChangeGroup` from `$lib/diff/present`.
- Produces:
  - `DispositionList.svelte` — props `{ dispositions: readonly Disposition[]; choices: Record<string, string> }`, with `choices` bindable. Renders one `<input type="hidden" name="disposition:<slug>">` per row so the values post with the commit form.
  - `DiffGroups.svelte` — props `{ groups: readonly ChangeGroup[] }`. Presentational only.

- [ ] **Step 1: Write `DispositionList.svelte`**

One card per departed slug. Each row: the movement's name, a `<select>` offering *Removed on purpose* plus every added slug, and the engine's reason as help text when there is one.

```svelte
<script lang="ts">
  import type { Disposition } from "$lib/diff/present";

  let {
    dispositions,
    choices = $bindable(),
  }: { dispositions: readonly Disposition[]; choices: Record<string, string> } = $props();
</script>

{#each dispositions as d (d.slug)}
  <div class="row">
    <p class="name">{d.name}</p>
    {#if d.reason}<p class="reason">{d.reason}</p>{/if}
    <select bind:value={choices[d.slug]} aria-label={`What happened to ${d.name}?`}>
      <option value="">Choose…</option>
      <option value="removed">Removed on purpose</option>
      {#each d.options as option (option.slug)}
        <option value={`rename:${option.slug}`}>Renamed to {option.name}</option>
      {/each}
    </select>
    <input type="hidden" name={`disposition:${d.slug}`} value={choices[d.slug] ?? ""} />
  </div>
{/each}
```

Both the select and the hidden input must sit inside the commit `<form>`, or the values never post — so the commit form wraps `DispositionList`.

Seed `choices` from the suggestions once in the parent, not in an `$effect` that could re-run and stamp over the user's edit:

```ts
let choices = $state(
  Object.fromEntries(
    (form?.revision?.dispositions ?? []).map((d) => [d.slug, d.suggested ? `rename:${d.suggested}` : ""]),
  ),
);
```

- [ ] **Step 2: Write `DiffGroups.svelte`**

One `<details>` per group, closed by default, with the count in the `<summary>`:

```svelte
<script lang="ts">
  import type { ChangeGroup } from "$lib/diff/present";

  let { groups }: { groups: readonly ChangeGroup[] } = $props();
</script>

{#each groups as group (group.key)}
  <details>
    <summary>{group.title} <span class="count">{group.entries.length}</span></summary>
    <ul>
      {#each group.entries as entry, i (i)}
        <li>
          <p class="headline">{entry.headline}</p>
          {#each entry.details as detail, j (j)}<p class="detail">{detail}</p>{/each}
        </li>
      {/each}
    </ul>
  </details>
{/each}
```

Keyed on the index deliberately: `entry.headline` is not unique, because one block can prescribe the same movement twice.

- [ ] **Step 3: Assemble the review in `+page.svelte`**

Replace Task 6's placeholder. Order, per spec §5:

1. Blocking problems, when `form.revision.blocking.length > 0`. Commit disabled. `var(--red)` is correct here — `/import` is outside the session runner (spec §6). Offer a copy-for-the-AI button reusing the same `copyText`/`downloadText` helpers the bootstrap prompt uses on Home.
2. `DispositionList`, inside the commit form.
3. The changelog, always visible, never in a `<details>`.
4. `DiffGroups`.
5. The warnings list.
6. The commit button.

The commit button is disabled unless every disposition has a value and nothing is blocking:

```svelte
let ready = $derived(
  form?.revision !== undefined &&
    form.revision.blocking.length === 0 &&
    form.revision.dispositions.every((d) => (choices[d.slug] ?? "") !== ""),
);
```

- [ ] **Step 4: Warn when the outbox is not empty**

A rename quarantines any queued op naming the old slug (spec §2). Read `syncStatus` from `$lib/sync/client.svelte.ts` — the same store `+layout.svelte`'s banner uses — and when `syncStatus.pending > 0` and at least one rename is chosen, show a note above the commit button saying entries are still waiting to sync and may need discarding afterwards. Do not block the commit on it; the user is the only one who can judge whether those ops matter.

- [ ] **Step 5: Correct CLAUDE.md's colour rule (spec §6)**

CLAUDE.md currently forbids `var(--red)` for errors and forbids green success states, attributing both to UI-DECISIONS §5's symptom triad. Read literally that is app-wide, and it is neither what the codebase does nor what §5 means — `--red` and `--amber` already appear in `src/routes/admin/+page.svelte`, `src/routes/plan/[slug]/export/+page.svelte`, `src/routes/+layout.svelte` and `src/routes/+page.svelte`.

Reword it to state the real boundary: **inside the session runner**, green/amber/red mean symptom severity and nothing else; outside it they carry their ordinary meanings. Keep the rule's force where it applies — the runner's completion mark and its error styling are unchanged — and say that this screen is outside it. A rule that overclaims gets ignored wholesale by the next agent who notices it does not match the code.

- [ ] **Step 6: Check it at 360 px**

Write a throwaway `e2e/tmp-import-review.spec.ts` that seeds v1, pastes v2, and screenshots the review at the `small-android` project. Confirm: no horizontal overflow, the selects are tappable, and the group summaries read as a scannable list. Read the screenshot, fix what is wrong, then delete the spec.

- [ ] **Step 7: Verify and commit**

Run: `npm run verify`

```bash
git add -A
git commit -m "feat(import): review a revision before committing it

The diff engine has been finished since phase 1 and the home screen rendered its
output as one sentence saying the detailed review arrived in a later phase. This
is that review: blocking problems first, then a required disposition for every
departed slug, then the AI's own changelog, then the changes as collapsed groups
with their counts in the headings.

An untouched disposition is not implicit acceptance and the commit stays
disabled until every one is answered. The whole justification for this screen is
that a silently split history is unrecoverable, and letting a removal pass
unexamined would reintroduce exactly that.

The groups are closed by default because the counts do the reviewing and the
detail verifies it — several dozen open rows do not fit a phone, and a screen
nobody reads is ceremony rather than review.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Batch 6 — Proof, and closing the phase

## Task 8: `e2e/revision-walkthrough.spec.ts`

**Files:**
- Create: `e2e/revision-walkthrough.spec.ts`
- Modify: `e2e/env.ts` (add `revisionDevUserFor`)

**Interfaces:**
- Consumes: `seedFixturePlan`, `openSeededUserDb` (`e2e/seed.ts`); `homeDevUserFor` (`e2e/env.ts`) as the pattern for the new helper; the gestures in `e2e/helpers.ts`.
- Produces: `export function revisionDevUserFor(projectName: string): string;` in `e2e/env.ts`.

**This spec needs its own isolated user.** Importing a revision changes whole-account state — the plan's current version — which is exactly the hazard recorded in ROADMAP's Loose Ends: a spec asserting on account-wide state sees other specs' and other viewport projects' concurrent work. `home-walkthrough.spec.ts` solved it with `homeDevUserFor(testInfo.project.name)` plus the dev-only `x-gain-e2e-user` header. Do the same here with a distinct prefix; do not reuse `E2E_DEV_USER` or the home spec's users.

- [ ] **Step 1: Add the helper**

In `e2e/env.ts`, beside `homeDevUserFor`:

```ts
/**
 * A per-project dev user for the revision walkthrough. Importing a revision changes
 * the account's current plan version, so this spec cannot share a seeded account with
 * anything else — see `homeDevUserFor` for the same reasoning and the header that
 * makes it work.
 */
export function revisionDevUserFor(projectName: string): string {
  return `e2e-revision-${projectName}`;
}
```

- [ ] **Step 2: Write the spec**

The walkthrough, in order:

1. Seed v1 for `revisionDevUserFor(testInfo.project.name)` and set the `x-gain-e2e-user` header before the first navigation.
2. Run a session A workout far enough to log at least one `goblet-squat` set. Reuse `e2e/helpers.ts`'s gestures rather than re-deriving them.
3. Go to `/plan/home-training/progress/exercises/A/goblet-squat` and assert the logged set's value is on the page — this is the baseline the rename must preserve.
4. Go to `/import`, paste the contents of `fixtures/plans/home-training-v2.md`, submit.
5. Assert the review renders: the changelog, a *Targets changed* group with a count, and three disposition rows.
6. Assert the commit button is disabled before any disposition is chosen. (`goblet-squat` arrives pre-selected, so clear it first, or assert on one of the two that arrive empty.)
7. Choose *Renamed to Goblet squat* (value `rename:goblet_squat`) for `goblet-squat`, *Renamed to Prone reverse fly* for `rear-delt-reverse-fly`, and *Removed on purpose* for `hammer-curl`.
8. Commit, and wait for the redirect to `/`.
9. **The assertion the whole phase exists for:** navigate to `/plan/home-training/progress/exercises/A/goblet_squat` and assert the set logged in step 2 — under the *old* slug — is visible there, by its value.
10. Assert `/plan/home-training/progress/exercises/A/goblet-squat` no longer shows a second, separate series.

Step 9 is the phase-7 lesson applied: prove the data path fired, not that a chart's shell rendered. Every chart component in this app renders its container unconditionally, so asserting on the container proves nothing. Assert on a value from the logged set.

- [ ] **Step 3: Run it at one project first**

Run: `npx playwright test --project=iphone e2e/revision-walkthrough.spec.ts`
Expected: PASS. Narrow to one project while iterating — a full run pays for the production build four times over.

- [ ] **Step 4: Run all three viewport projects**

Run: `npx playwright test e2e/revision-walkthrough.spec.ts`
Expected: PASS at `small-android`, `iphone` and `tablet-portrait`.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify`

```bash
git add -A
git commit -m "test(e2e): walk a revision from paste to committed

Logs a goblet squat under the old slug, imports v2, maps the two renames and
marks the removal, commits, then asserts the logged set is visible on the new
slug's progress detail. That last assertion is the only one in the suite that
would catch a split history end to end, which is the failure this phase exists
to prevent.

It runs against its own per-project dev user. Importing a revision changes the
account's current plan version, so sharing a seeded account with another spec
or another viewport project would make it flake — the hazard already recorded
against home-walkthrough.spec.ts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

## Task 9: Close the phase

Four files state where the build has got to, and a stale one costs the next agent a wasted rebuild.

**Files:**
- Modify: `README.md`, `docs/ROADMAP.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`

- [ ] **Step 1: `docs/ROADMAP.md`**

Tick both remaining phase-8 items with their commit SHAs (the template-editor item was deleted in Task 1). Set the phase table's row 8 to `Done`. Rewrite the Status section: phases 1–9 are done and the loop closes. Move the "next" marker — with 8 done and 9 already done, what remains is the Loose Ends, so say that rather than pointing at a phase that does not exist.

- [ ] **Step 2: `README.md`**

Update the status banner. It is the first thing a human reads and it is the one that drifts.

- [ ] **Step 3: `docs/ARCHITECTURE.md` §12**

Fill in the phase-8 row's "Done when" column to match what ROADMAP says actually shipped.

- [ ] **Step 4: `CLAUDE.md`**

Update the "Current state" paragraph: phase 8 done, what it shipped, and the durable proof (`e2e/revision-walkthrough.spec.ts`). Add a "What the phase-8 review changed" subsection under Build order **only if** the build surfaced rules worth carrying forward — not for one-off fixes. Candidates, if they proved out: that a rename must run before the upsert, and that `presentDiff` rebuilding warnings from structure beats filtering the engine's strings.

- [ ] **Step 5: Check `todo.md`**

If the build surfaced a survival or acceptance scenario the automated suite structurally cannot cover, add it to `todo.md` as a manual step with exact commands — the way phase 6's container-restart check went in. Otherwise leave it alone.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`

```bash
git add -A
git commit -m "docs: close phase 8 and record the loop closing

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done when

A logged block exports, comes back revised from an AI, and the diff is reviewed and committed — with a renamed slug mapped back onto its history rather than silently splitting it. `e2e/revision-walkthrough.spec.ts` is the durable proof, and `npm run verify` passes.
