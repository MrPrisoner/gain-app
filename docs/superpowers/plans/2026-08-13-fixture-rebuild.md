# Fixture Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: shipped — this is an archived plan, kept for its reasoning.** Its
> checkboxes were never ticked as the batches landed;
> [`docs/ROADMAP.md`](../../ROADMAP.md) is the record of what shipped, with commit
> SHAs. Do not restart it from its first unticked box.

**Goal:** Replace `fixtures/plans/home-dumbbell-v1.md` with a fictionalised, current-generation plan that exercises every contract primitive, then migrate every referencing file and delete the old fixture.

**Architecture:** Two small contract corrections land first, because the new fixture would fail both. Then the document itself, guarded by a new durable coverage test that asserts every primitive is present — that test is the reason this rebuild cannot silently lose coverage later. Then the migration, in dependency order: the synthetic-logs helper and the golden test together (golden is the test for the helper's output), then the unit tests, then e2e, then docs and deletion.

**Tech Stack:** TypeScript 6 (strict), SvelteKit (Svelte 5 runes), better-sqlite3 13, Vitest 4, Playwright, Zod 4.

**Spec:** [`docs/superpowers/specs/2026-08-13-fixture-rebuild-design.md`](../specs/2026-08-13-fixture-rebuild-design.md)

## Preconditions

The source document for the new fixture is at **`/home/andrie/Downloads/andrie-home-training-plan.md`**. It contains real health data and must never be copied into the repository, even transiently — work on it under the scratchpad directory and move only the fictionalised result into `fixtures/`.

If that file is missing, stop and ask rather than inventing a substitute. The whole point of this rebuild is that the document is a real artefact of the loop.

## Global Constraints

- **Read `AGENTS.md` first**, then `docs/CONTRACT.md`. They are the contract; this plan implements against them.
- **Node 24 LTS.** Every dependency is on a current major — Zod 4, TypeScript 6, ESLint 10, Vitest 4, better-sqlite3 13. This repo uses `z.strictObject`, `z.looseObject` and `error:`. Do **not** write Zod 3 idioms (`z.object().strict()`, `message:`) from memory.
- **`npm run verify` is the definition of done** for every task. It short-circuits, so a lint failure means the tests never ran.
- **`npm run test:e2e` is never run by `verify`.** Tasks 6 and 7 must run it explicitly. It needs `npx playwright install chromium` once first.
- **Never write a literal control character — write the escape** (`\u0000`). Two checks enforce this: the `gain/no-control-characters` ESLint rule and `npm run check:chars`.
- **Run `npx prettier --write <file>` after editing any TypeScript or Svelte file.** `docs/`, `fixtures/`, `templates/` and `design/` are byte-sensitive and excluded from formatting — never remove them from `.prettierignore`, and never run Prettier over them.
- **Do not commit real health data.** The fixture is fictional and stays that way. No real name, no real clinical history, no real referral.
- **Metric values key on `(scope, key)`, never the bare key.** This rebuild is the first time a fixture declares one key at two scopes; every assertion about metrics must respect the pair.
- **`weight_kg` is always total kilograms.** No `paired` field, no per-side doubling.
- **Commit messages:** `type(scope): imperative summary`, lowercase, no trailing period, prose body. Close with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `docs/CONTRACT.md` | Name all three `*_load_when` keys in shipped output (modify) | 1 |
| `src/lib/contract/schema.ts` | Reject `*_load_when` synonyms; reject `version > 1` with null `based_on_version` (modify) | 1, 2 |
| `tests/schema.test.ts` | Unit tests for both new refinements (modify) | 1, 2 |
| `fixtures/plans/home-training-v1.md` | The new fixture — fictionalised, merged, full coverage (create) | 3 |
| `tests/fixture-coverage.test.ts` | Durable proof the fixture exercises every primitive (create) | 3 |
| `tests/helpers/synthetic-logs.ts` | Retarget the scripted logs onto the new plan (modify) | 4 |
| `tests/golden.test.ts` | The round-trip spine, against the new fixture (modify) | 4 |
| `tests/db/{import,logs,second-import,workout}.test.ts` | Slug and metric-key migration (modify) | 5 |
| `tests/session/{ledger,resume,session-view}.test.ts` | Slug and metric-key migration (modify) | 5 |
| `tests/sync/{replay,replay.property}.test.ts`, `tests/server/*.test.ts` | Slug migration (modify) | 5 |
| `e2e/env.ts`, `e2e/seed.ts` | Fixture path and `E2E_PLAN_SLUG` (modify) | 6 |
| `e2e/session-runner*.spec.ts`, `e2e/offline-*.spec.ts`, `e2e/export-walkthrough.spec.ts` | Slug migration (modify) | 6 |
| `e2e/session-runner-walkthrough-a.spec.ts`, `-d.spec.ts` | Rewritten against the new sessions | 7 |
| `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/UI-DECISIONS.md`, `src/lib/db/review.ts`, `design/session-runner-mockup.html` | Counts and references (modify) | 8 |
| `fixtures/plans/home-dumbbell-v1.md` | Deleted | 8 |

**Do not touch:** `docs/superpowers/plans/2026-08-12-*.md` are records of work already done. Historical documents are not rewritten to match a later state of the tree. `docs/CONTRACT.md`'s `set_symptom` and `lying-triceps-extension` mentions are illustrative examples in shipped output, not fixture references — leave them.

---

### Task 1: Name the progression keys, and reject their synonyms

The new plan wrote `progression.keep_load_when` where the schema declares `hold_load_when`. It parsed clean and was silently swallowed, because `progression` is a `z.looseObject`. The root cause is that `docs/CONTRACT.md` — the only thing an authoring AI reads — shows `increase_load_when` and never names the other two.

`progression` **stays** a `looseObject`: the source plan also carries `notes` and `future_progressions`, which are legitimate free-text extras that CONTRACT §3 explicitly permits. The fix is to name the real keys in the shipped spec and to reject the specific known synonyms loudly, exactly as `PLAN_SYNONYMS` already does for `program`/`routine`/`workout`.

**Files:**
- Modify: `docs/CONTRACT.md:288-296` (the `progression:` example block)
- Modify: `src/lib/contract/schema.ts` — add `PROGRESSION_SYNONYMS` near `PLAN_SYNONYMS:369`, and a check inside `contractSchema`'s `superRefine`
- Modify: `tests/schema.test.ts`

**Interfaces:**
- Produces: `PROGRESSION_SYNONYMS: Record<string, string>` — module-private, mirroring `PLAN_SYNONYMS`'s shape. No export.

- [ ] **Step 1: Write the failing test**

Add to `tests/schema.test.ts`. Use whatever helper that file already uses to build a minimal valid contract — read it first and follow the existing pattern rather than inventing a new builder.

```ts
it("rejects `keep_load_when` as a synonym of `hold_load_when`", () => {
  const result = contractSchema.safeParse({
    ...minimalContract(),
    progression: { model: "double_progression", keep_load_when: ["Reps still climbing"] },
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message).join("\n");
    expect(messages).toContain("hold_load_when");
    expect(messages).toContain("keep_load_when");
  }
});

it("still accepts free-text extras alongside the declared progression keys", () => {
  const result = contractSchema.safeParse({
    ...minimalContract(),
    progression: {
      model: "double_progression",
      hold_load_when: ["Reps still climbing"],
      notes: ["Smallest increment is 1 kg per dumbbell"],
      future_progressions: ["Load the split squat once bodyweight is comfortable"],
    },
  });
  expect(result.success).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify the first fails**

Run: `npx vitest run tests/schema.test.ts`
Expected: the synonym test FAILS (the contract parses clean); the free-text test PASSES already.

- [ ] **Step 3: Add the synonym map and the check**

In `src/lib/contract/schema.ts`, directly below `PLAN_SYNONYMS`:

```ts
/**
 * The same discipline as `PLAN_SYNONYMS`, for the progression block. `progression` is a
 * `looseObject` on purpose — CONTRACT §3 calls these fields "largely free-text" and real
 * plans carry extras like `notes` and `future_progressions` — but that tolerance is
 * exactly what let a plan write `keep_load_when` and have it silently swallowed. Reject
 * the known synonyms by name; let genuinely new keys through.
 */
const PROGRESSION_SYNONYMS: Record<string, string> = {
  keep_load_when: "hold_load_when",
  maintain_load_when: "hold_load_when",
  add_load_when: "increase_load_when",
  raise_load_when: "increase_load_when",
  decrease_load_when: "reduce_load_when",
  lower_load_when: "reduce_load_when",
};
```

Inside `contractSchema`'s `superRefine`, alongside the existing metric and scheduling checks:

```ts
// -- progression: known synonyms rejected by name (see PROGRESSION_SYNONYMS).
for (const [wrong, right] of Object.entries(PROGRESSION_SYNONYMS)) {
  if (c.progression !== undefined && wrong in c.progression) {
    ctx.addIssue({
      code: "custom",
      path: ["progression", wrong],
      message: `\`${wrong}\` is not a contract key — use \`${right}\`. The two mean the same thing, and only \`${right}\` is read.`,
    });
  }
}
```

- [ ] **Step 4: Run the tests to verify both pass**

Run: `npx vitest run tests/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Name all three keys in the shipped spec**

In `docs/CONTRACT.md`, extend the `progression:` example so every key the schema reads is visible to an authoring AI. It is byte-sensitive — hand-edit, no Prettier.

```yaml
progression:
  model: double_progression         # double_progression | linear | none
  effort_target: "Approximately 1–3 RIR"
  effort_by_week:
    - week: 1
      rir: [3, 3]
      focus: "Establish — learn technique, identify starting loads"
  increase_load_when:               # these three key names are exact — synonyms are rejected
    - "Top of rep range achieved across all sets"
  hold_load_when:
    - "Reps are still climbing within the range"
  reduce_load_when:
    - "Bottom of the range is not reachable with good technique"
```

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`
Expected: PASS. The golden test asserts `docs/CONTRACT.md` embeds byte-for-byte in both templates, so a spec edit rides along automatically — if that test fails, the embedding is broken, not the edit.

```bash
git add docs/CONTRACT.md src/lib/contract/schema.ts tests/schema.test.ts
git commit -m "fix(contract): name every progression key and reject their synonyms

A plan authored against the shipped spec wrote \`keep_load_when\` where
the schema declares \`hold_load_when\`. It parsed clean and the key was
silently swallowed, because \`progression\` is a looseObject and
CONTRACT.md never named the key at all — only \`increase_load_when\`
appeared in the example, so an authoring AI had no way to get it right.

The block stays loose, because CONTRACT §3 calls these fields largely
free-text and real plans carry useful extras like \`notes\` and
\`future_progressions\`. What changes is that the three keys GAIN
actually reads are now visible in the spec, and the known synonyms are
rejected by name the way plan synonyms already are.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: A version above 1 must name its ancestor

The source plan declares `version: 2` with `based_on_version: null` while its own prose says it has never been trained. The parser accepts it. That combination corrupts version lineage silently, and the new fixture must be version 1 anyway.

The rule belongs in `plan`'s existing `superRefine`, directly beside the `changelog` rule that already guards `version > 1`.

**Files:**
- Modify: `src/lib/contract/schema.ts:338-348` (the `plan` superRefine)
- Modify: `tests/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("rejects a version above 1 with no `based_on_version`", () => {
  const result = contractSchema.safeParse({
    ...minimalContract(),
    plan: {
      slug: "home-training",
      name: "Home Training Plan",
      version: 2,
      based_on_version: null,
      changelog: ["Second version"],
    },
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues.map((i) => i.message).join("\n")).toContain("based_on_version");
  }
});

it("accepts a first version with a null `based_on_version`", () => {
  const result = contractSchema.safeParse({
    ...minimalContract(),
    plan: {
      slug: "home-training",
      name: "Home Training Plan",
      version: 1,
      based_on_version: null,
    },
  });
  expect(result.success).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify the first fails**

Run: `npx vitest run tests/schema.test.ts`
Expected: the `version: 2` test FAILS (it parses clean today).

- [ ] **Step 3: Add the refinement**

In `src/lib/contract/schema.ts`, inside `plan`'s existing `.superRefine((p, ctx) => { … })`, after the `changelog` check:

```ts
if (p.version > 1 && p.based_on_version === null) {
  ctx.addIssue({
    code: "custom",
    path: ["based_on_version"],
    message:
      "`based_on_version` cannot be null when `version` is above 1 — a revision must name the version it was built from, so logs stay bound to a real lineage. Use `1` for a first plan and leave `based_on_version: null` there.",
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify`
Expected: PASS. The existing fixture is version 1, so nothing else moves.

```bash
git add src/lib/contract/schema.ts tests/schema.test.ts
git commit -m "fix(contract): reject a version above 1 with no based_on_version

A plan that declares itself version 2 and names no ancestor corrupts the
version lineage silently: logs are bound to the version they ran under,
and a chain with a hole in it cannot be walked back. The parser accepted
it until now, and a real AI-authored plan produced exactly that
combination while its own prose said it had never been trained.

The rule sits beside the changelog rule that already guards version > 1,
because they are the same guarantee seen from two sides.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The new fixture, and a test that keeps it honest

This is the document itself. It is derived from the real plan at the path named in **Preconditions**, fictionalised, with nine primitives folded in from the outgoing fixture and one primitive neither document ever had.

Write the coverage test **first**. It is not scaffolding — it stays in the suite permanently, because the failure mode this whole rebuild guards against is a future edit quietly dropping a primitive, and no other test would notice.

**Files:**
- Create: `tests/fixture-coverage.test.ts`
- Create: `fixtures/plans/home-training-v1.md`

**Interfaces:**
- Produces: `fixtures/plans/home-training-v1.md` with `plan.slug: home-training`, `plan.name: Home Training Plan`, `plan.version: 1`, four sessions keyed `A`/`B`/`C`/`D`.

- [ ] **Step 1: Write the coverage test**

```ts
/**
 * The fixture's job is to exercise every contract primitive in one document
 * (AGENTS.md, "The fixture"). That job is invisible: dropping a primitive breaks
 * no test, it just quietly stops proving something. This asserts the coverage
 * directly, so the next edit to the fixture cannot lose it silently.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePlanDocument } from "../src/lib/parse/parser";

const fixtureMd = readFileSync(
  new URL("../fixtures/plans/home-training-v1.md", import.meta.url),
  "utf8",
);
const parsed = parsePlanDocument(fixtureMd);
if (!parsed.ok) throw new Error(`fixture failed to parse:\n${parsed.report}`);
const c = parsed.contract;

const prescriptions = c.sessions.flatMap((s) => s.blocks.flatMap((b) => b.exercises));
const byId = new Map(c.exercises.map((e) => [e.id, e]));
const loadById = new Map(c.loads.map((l) => [l.ref, l]));
const isBodyweight = (id: string): boolean => {
  const ref = byId.get(id)?.load;
  return ref === undefined ? true : (loadById.get(ref)?.is_bodyweight ?? false);
};
const metricDefs = (["set", "exercise", "session"] as const).flatMap((scope) =>
  (c.metrics?.[scope] ?? []).map((def) => ({ scope, def })),
);

describe("fixture coverage", () => {
  it("declares one metric key at two scopes — the (scope, key) invariant", () => {
    const scopesByKey = new Map<string, string[]>();
    for (const { scope, def } of metricDefs) {
      scopesByKey.set(def.key, [...(scopesByKey.get(def.key) ?? []), scope]);
    }
    const shared = [...scopesByKey.entries()].filter(([, scopes]) => scopes.length > 1);
    expect(shared.length).toBeGreaterThan(0);
  });

  it("declares metrics at all three scopes", () => {
    for (const scope of ["set", "exercise", "session"] as const) {
      expect(metricDefs.some((m) => m.scope === scope)).toBe(true);
    }
  });

  it("declares every metric type, including enum", () => {
    for (const type of ["number", "scale", "enum"]) {
      expect(metricDefs.some((m) => m.def.type === type)).toBe(true);
    }
  });

  it("declares at least one required and one optional metric", () => {
    expect(metricDefs.some((m) => m.def.optional !== true)).toBe(true);
    expect(metricDefs.some((m) => m.def.optional === true)).toBe(true);
  });

  it("declares every prompt_when value", () => {
    for (const when of ["start", "end", "next_morning"]) {
      expect(metricDefs.some((m) => m.def.prompt_when === when)).toBe(true);
    }
  });

  it("prescribes reps and duration in both scalar and ranged form", () => {
    expect(prescriptions.some((p) => typeof p.reps === "number")).toBe(true);
    expect(prescriptions.some((p) => Array.isArray(p.reps))).toBe(true);
    expect(prescriptions.some((p) => typeof p.duration_sec === "number")).toBe(true);
    expect(prescriptions.some((p) => Array.isArray(p.duration_sec))).toBe(true);
  });

  it("prescribes a ranged set count", () => {
    expect(prescriptions.some((p) => Array.isArray(p.sets))).toBe(true);
  });

  it("declares rest as both a scalar and a range, and overrides it per occurrence", () => {
    expect(c.exercises.some((e) => typeof e.rest_sec === "number")).toBe(true);
    expect(c.exercises.some((e) => Array.isArray(e.rest_sec))).toBe(true);
    expect(prescriptions.some((p) => p.rest_sec !== undefined)).toBe(true);
  });

  it("overrides load and substitutes at the prescription level", () => {
    expect(prescriptions.some((p) => p.load !== undefined)).toBe(true);
    expect(prescriptions.some((p) => (p.substitutes ?? []).length > 0)).toBe(true);
  });

  it("pairs per_side with reps, with duration, and with an external load", () => {
    const perSide = prescriptions.filter((p) => byId.get(p.id)?.per_side === true);
    expect(perSide.some((p) => p.reps !== undefined)).toBe(true);
    expect(perSide.some((p) => p.duration_sec !== undefined)).toBe(true);
    expect(perSide.some((p) => !isBodyweight(p.id) || p.load !== undefined)).toBe(true);
  });

  it("declares conditionals both with and without substitutes", () => {
    expect(
      c.exercises.some((e) => e.conditional === true && (e.substitutes ?? []).length > 0),
    ).toBe(true);
    expect(
      c.exercises.some((e) => e.conditional === true && (e.substitutes ?? []).length === 0),
    ).toBe(true);
    expect(c.exercises.some((e) => (e.substitutes ?? []).length > 1)).toBe(true);
  });

  it("catalogues at least one movement that is only ever a substitute", () => {
    const prescribed = new Set(prescriptions.map((p) => p.id));
    expect(c.exercises.some((e) => !prescribed.has(e.id))).toBe(true);
  });

  it("uses blocks with explicit tracking and type, and blocks that rely on the defaults", () => {
    const blocks = c.sessions.flatMap((s) => s.blocks);
    expect(blocks.some((b) => b.tracking === "checkoff")).toBe(true);
    expect(blocks.some((b) => b.tracking === "full")).toBe(true);
    expect(blocks.some((b) => b.tracking === undefined)).toBe(true);
    expect(blocks.some((b) => b.type === "sequence")).toBe(true);
    expect(blocks.some((b) => b.type === "rounds")).toBe(true);
    expect(blocks.some((b) => b.type === undefined)).toBe(true);
  });

  it("declares scheduling, progression and safety in full", () => {
    expect((c.scheduling?.sequence ?? []).length).toBeGreaterThan(0);
    expect((c.scheduling?.drop_order ?? []).length).toBeGreaterThan(0);
    expect((c.progression?.effort_by_week ?? []).length).toBeGreaterThan(0);
    expect(c.progression?.hold_load_when).toBeDefined();
    expect((c.safety?.symptom_framework ?? []).length).toBeGreaterThan(0);
  });

  it("is a first version and carries no real identity", () => {
    expect(c.plan.version).toBe(1);
    expect(c.plan.based_on_version).toBeNull();
    expect(c.plan.slug).toBe("home-training");
    expect(fixtureMd.toLowerCase()).not.toContain("andrie");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/fixture-coverage.test.ts`
Expected: FAIL — `ENOENT`, the fixture does not exist yet.

- [ ] **Step 3: Copy the source to scratch and fictionalise the prose**

```bash
cp /home/andrie/Downloads/andrie-home-training-plan.md "$SCRATCH/home-training-v1.md"
```

Apply these rules to the prose. Keep the document's **structure** — its section order, its level of detail, its "what I estimated" honesty — because that structure is what makes it a realistic artefact of the loop.

- Replace every occurrence of the real first name with second-person address. The document already says "you" in most places; convert the remaining third-person passages ("Andrie plays squash…" → "You play squash…").
- Retain the symptom picture in shape — a hip and lower-back complaint reproduced by side bending, forward bending, lifting from in front, and figure-4 plus forward bend — because that is what drives the exercise selection, the exclusions, the conditionals and the substitutes.
- Cut the specific clinical history: the physiotherapist referral, the SI-joint hypothesis, the never-confirmed age, and the "an earlier undated draft plan" provenance passages. Replace the escalation text with a general, non-specific safety statement.
- Retain the "What I have estimated, and what to correct after week one" section. It exercises nothing and is one of the most realistic things in the document, which is exactly why an AI-authored plan has one.
- Update the prose that describes unilateral work so it says session C's split squat carries the light pair as a bridge to loading, rather than that all unilateral work starts at bodyweight (see the contract edit below).

- [ ] **Step 4: Apply the contract-block edits**

Fifteen edits inside the ` ```gain-plan ` block. Each is listed with the primitive it closes.

**Plan header:**
1. `slug: andrie-home-training` → `slug: home-training`.
2. `version: 2` → `version: 1`; `based_on_version: null` stays. Reword `changelog` as a first-plan entry.

**Progression (Task 1's correction):**
3. `keep_load_when:` → `hold_load_when:`. Leave `notes` and `future_progressions` — they are legitimate free-text extras and the coverage test does not require removing them.

**Metrics** — replace the whole `metrics:` block:
4. Add a **set-scope** `symptoms_during` (scale 0–10, `optional: true`, label "Symptoms on this set"). Together with the existing session-scope `symptoms_during` this is the **same key at two scopes** — the primitive no fixture has ever had, and the one AGENTS.md's `(scope, key)` invariant exists to protect.
5. Add an exercise-scope `technique` metric, `type: enum`, options `[Good, Acceptable, Broke down]`, `optional: true`. The plan's own `increase_load_when` lists "Technique held together on the final set" and currently provides no way to record it — this makes the plan more coherent, not less.
6. Remove `optional: true` from the **session-scope** `symptoms_during`, making it the required metric. The plan's progression rules depend on it.

```yaml
metrics:
  set:
    - key: symptoms_during
      label: Symptoms on this set
      type: scale
      min: 0
      max: 10
      optional: true

  exercise:
    - key: rir
      label: Reps left in the tank
      type: number
      min: 0
      max: 5
      optional: true
    - key: technique
      label: Technique on the last set
      type: enum
      options:
        - Good
        - Acceptable
        - Broke down
      optional: true

  session:
    - key: squash_since_last
      label: Squash sessions since your last workout
      type: number
      min: 0
      max: 3
      optional: true
      prompt_when: start

    - key: symptoms_during
      label: Hip / lower-back symptoms during this session
      type: scale
      min: 0
      max: 10
      prompt_when: end

    - key: symptoms_next_morning
      label: Hip / lower-back symptoms this morning
      type: scale
      min: 0
      max: 10
      optional: true
      prompt_when: next_morning
```

**Exercise catalogue:**
7. Give `floor-pullover` `conditional: true` and a `condition` worded as omit-rather-than-swap, with **no** `substitutes` — e.g. `"Omit this one if the lower back lifts off the mat and shortening the range does not fix it."` This is the conditional-without-substitutes primitive.

**Sessions — warm-ups (all four):**
8. `{id: march-in-place, reps: 40}` → `{id: march-in-place, duration_sec: 60}`. This is the scalar `duration_sec` primitive; marching for a minute is also the more natural prescription.

**Session C:**
9. Remove `tracking: full` from the `main` block and `tracking: full` + `type: sequence` from the `core` block, so the defaulting path stays covered. Sessions A, B and D keep theirs explicit.
10. `{id: split-squat, sets: 2, reps: [10, 12]}` → add `load: light-pair`. This is the prescription-level `load` override **and** per-side-with-external-load in one edit, and `future_progressions` already anticipates loading this exact movement.

**Session D:**
11. `{id: goblet-squat, sets: 2, …}` → `sets: [2, 3]`. Ranged sets, in the session the plan already calls the one to drop when the week is short.
12. `{id: db-floor-press, sets: 2, …}` → `sets: [2, 3]`.
13. The same `goblet-squat` prescription gains `substitutes: [bodyweight-squat]` — a prescription-level substitute the catalogue does not declare.

**Sanity:**
14. Every `substitutes` entry must name a catalogued `id`. `bodyweight-squat` is already in the catalogue as a warm-up movement.
15. Confirm the three substitute-only movements survive: `seated-floor-shoulder-press`, `overhead-triceps-extension`, `side-plank-knees`.

- [ ] **Step 5: Move it in and run the coverage test**

```bash
mv "$SCRATCH/home-training-v1.md" fixtures/plans/home-training-v1.md
npx vitest run tests/fixture-coverage.test.ts
```

Expected: PASS, all sixteen assertions. If the parse itself fails, the report is pasteable and names the field — fix the block, not the test.

- [ ] **Step 6: Record the document's shape**

Later tasks and three documents assert these numbers, so establish them once, from the file, rather than estimating:

```bash
npx vitest run tests/fixture-coverage.test.ts --reporter=verbose 2>&1 | head -5
```

Then print the counts by adding a temporary `console.log` — or read them off the golden test failure in Task 4, which asserts all three. **Do not guess them.** Write the three numbers (sessions, exercises, prescriptions) into the commit message body so Task 8 can copy them into the docs.

- [ ] **Step 7: Verify and commit**

Run: `npm run check:chars && npm run verify`

`verify` will still be green here: the old fixture is untouched and every existing test still points at it. Only `tests/fixture-coverage.test.ts` is new.

```bash
git add fixtures/plans/home-training-v1.md tests/fixture-coverage.test.ts
git commit -m "test(fixture): add a current-generation plan and assert its coverage

The outgoing fixture predates the app and is the only plan the build has
ever seen. This one is derived from a plan a current AI actually wrote
against the shipped CONTRACT.md, fictionalised, with the nine primitives
it did not exercise folded in from the old one.

It also closes a gap neither document ever had: one metric key declared
at two scopes. That is exactly what the (scope, key) invariant exists to
protect, and until now it was proven by nothing.

The coverage test is not scaffolding. Dropping a primitive from a fixture
breaks no test — it quietly stops proving something — so the coverage is
asserted directly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Retarget the synthetic logs and the golden round-trip

`buildSyntheticLogs` is mostly generic — it walks the contract. What is hardcoded is a handful of slugs and metric keys. The golden test is the test for its output, so both move together or neither does.

The important new behaviour: the helper must emit `symptoms_during` at **both** set and session scope, so the two-scope case travels all the way through the export summary and the CSV writer. That is the first end-to-end proof of the `(scope, key)` invariant.

**Files:**
- Modify: `tests/helpers/synthetic-logs.ts:33-44` (the hardcoded constants), `:136-143` (the set-scope metric), `:147-160` (the exercise metrics), `:164-179` (the session metrics)
- Modify: `tests/golden.test.ts:34` (fixture path), `:51-55` (counts), `:109` (substitute-only slug), `:155` (plan name), `:176-184` (log assertions)

**Interfaces:**
- Consumes: `fixtures/plans/home-training-v1.md` from Task 3.
- Produces: `buildSyntheticLogs(contract: GainContract): Logs` — signature unchanged.

- [ ] **Step 1: Point the golden test at the new fixture and run it**

Change `tests/golden.test.ts:34`:

```ts
const fixtureMd = read("fixtures/plans/home-training-v1.md");
```

Run: `npx vitest run tests/golden.test.ts`
Expected: FAIL, with the count assertion at line 51 reporting the real numbers. **Record them** — they are what Task 8 writes into the docs.

- [ ] **Step 2: Retarget the helper's constants**

In `tests/helpers/synthetic-logs.ts`, replace lines 33–44:

```ts
const MAIN_LIFTS = new Set([
  "goblet-squat",
  "db-floor-press",
  "prone-row",
  "db-shoulder-press",
  "split-squat",
]);

/** `${workoutId}:${exerciseId}` keys for the scripted deviations. */
const SKIPPED = new Set(["wk-1-D:reverse-crunch"]);
const SUBSTITUTED = new Map([["wk-1-B:db-shoulder-press", "seated-floor-shoulder-press"]]);
const DROPPED_SET = new Set(["wk-2-C:split-squat"]);
```

`prone-row` replaces `supported-one-arm-row` (the new plan's rowing movement). The substitution moves onto `db-shoulder-press` → `seated-floor-shoulder-press`, which the new plan declares as a real conditional pair — and `seated-floor-shoulder-press` is one of the three substitute-only movements, so the substitution still exercises "a movement no session prescribes".

- [ ] **Step 3: Retarget the set-scope metric to the two-scope key**

Replace lines 135–143 (`// The optional set-scope symptom metric, where it matters.`):

```ts
// The set-scope half of `symptoms_during`, which the plan also declares at
// session scope. Emitting both is the point: anything indexing metric values
// on the bare key merges these two unrelated series into a wrong number.
if (slug === "reverse-crunch" && week === 0 && setNo === 1 && side === undefined) {
  metric_values.push({
    id: nextMetricId(),
    key: "symptoms_during",
    ref: { scope: "set", set_log_id: id },
    value_num: 3,
  });
}
```

The value is deliberately `3` while the session-scope values are `0` or `2` — if a consumer merges the scopes, the min/avg/max in the export summary shift visibly rather than staying plausible.

- [ ] **Step 4: Retarget the session metrics**

The new plan declares three session metrics, not six. Replace lines 173–179:

```ts
const symptomLevel = session.key === "D" && week === 1 ? 2 : 0;
sessionMetric("squash_since_last", sessionIndex === 0 ? 2 : 1);
sessionMetric("symptoms_during", symptomLevel);
sessionMetric("symptoms_next_morning", symptomLevel > 0 ? 1 : 0);
```

Leave the exercise-scope `rir` and `technique` block at lines 147–160 as it is — both keys survive into the new plan. Change only the `technique` value's slug test:

```ts
value_text: slug === "prone-row" && week === 1 ? "Acceptable" : "Good",
```

- [ ] **Step 5: Retarget the deviations**

Replace the `dev-002` entry (lines 191–200):

```ts
{
  id: "dev-002",
  workout_id: "wk-1-B",
  exercise_slug: "db-shoulder-press",
  kind: "substitute",
  reason_code: "comfort",
  note: "Caught myself leaning back to finish the set; took the seated floor version the plan already names.",
  substitute_exercise_slug: "seated-floor-shoulder-press",
},
```

- [ ] **Step 6: Update the golden test's remaining fixture-specific assertions**

- `:51-55` — the three counts, from Step 1's failure output.
- `:109` — `expect(after).toContain("seated-floor-shoulder-press"); // substitute-only movement`
- `:155` — `expect(bundle.startsWith("# GAIN Export — Home Training Plan — weeks 1–4\n")).toBe(true);`
- `:171` — `expect(section0).toContain("4 weeks of Home Training Plan v1");`
- `:183` — `expect(bundle).toContain("goblet-squat");` stays; the new plan prescribes it.

Add one assertion proving the two-scope metric survives the round trip into the summary:

```ts
it("keeps a metric declared at two scopes as two series in the summary", () => {
  // `symptoms_during` is declared at set AND session scope. The summary's metric
  // table keys on the pair, so both rows must appear — one merged row would be a
  // plausible wrong number rather than a visible failure.
  const rows = bundle
    .split("\n")
    .filter((line) => line.startsWith("|") && line.includes("`symptoms_during`"));
  expect(rows).toHaveLength(2);
  expect(rows.some((r) => r.startsWith("| set |"))).toBe(true);
  expect(rows.some((r) => r.startsWith("| session |"))).toBe(true);
});
```

- [ ] **Step 7: Run the golden test**

Run: `npx vitest run tests/golden.test.ts tests/fixture-coverage.test.ts`
Expected: PASS.

- [ ] **Step 8: Verify and commit**

Run: `npm run verify`
Expected: other suites still fail — they point at the old fixture and are migrated in Task 5. If `verify` short-circuits before reaching them, run `npx vitest run` directly to see the full picture, and confirm every remaining failure is a known old-fixture reference rather than something this task broke.

```bash
git add tests/helpers/synthetic-logs.ts tests/golden.test.ts
git commit -m "test(fixture): move the golden round-trip onto the new plan

The synthetic-logs helper walks the contract, so retargeting it is a
matter of a handful of slugs and metric keys rather than a rewrite. The
substitution moves onto the shoulder press and its seated floor version,
which the new plan declares as a real conditional pair and which keeps
the substitute pointing at a movement no session prescribes.

The helper now emits \`symptoms_during\` at both set and session scope,
with deliberately different values, so the (scope, key) invariant is
proven end to end through the summary for the first time — a consumer
that merged the scopes would move the numbers visibly instead of
reporting a plausible wrong one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Migrate the unit tests

Mechanical. Every remaining Vitest file that names a v1 slug or metric key.

**Files:**
- Modify: `tests/db/import.test.ts`, `tests/db/logs.test.ts`, `tests/db/second-import.test.ts`, `tests/db/workout.test.ts`
- Modify: `tests/session/ledger.test.ts`, `tests/session/resume.test.ts`, `tests/session/session-view.test.ts`
- Modify: `tests/sync/replay.test.ts`, `tests/sync/replay.property.test.ts`
- Modify: `tests/server/export-route.test.ts`, `tests/server/first-run.test.ts`, `tests/server/gate.test.ts`, `tests/server/sync-route.test.ts`

- [ ] **Step 1: See the whole failure surface**

Run: `npx vitest run`
Expected: FAIL across the files above. Read the failures before editing — some are a fixture path, some a slug, some a metric key, and a few assert structure that genuinely changed.

- [ ] **Step 2: Apply the substitutions**

| Old | New | Note |
|---|---|---|
| `fixtures/plans/home-dumbbell-v1.md` | `fixtures/plans/home-training-v1.md` | Path |
| `home-dumbbell` | `home-training` | `plan.slug` |
| `supported-one-arm-row` | `prone-row` | The rowing movement. **Not** `per_side` in the new plan — see Step 3 |
| `set_symptom` | `symptoms_during` at `scope: "set"` | The two-scope key |
| `overhead-triceps-extension` → `lying-triceps-extension` substitution pair | `db-shoulder-press` → `seated-floor-shoulder-press` | Matches Task 4 |
| `energy_before`, `energy_after`, `symptoms_after` | *(removed)* | Not declared by the new plan |

- [ ] **Step 3: Fix the tests that assert per-side behaviour**

`tests/session/ledger.test.ts:140` and `:256-285`, `tests/session/resume.test.ts:126-134`, and `tests/session/session-view.test.ts:61-138` use `supported-one-arm-row` **specifically because it is `per_side` and loaded**. `prone-row` is neither.

Retarget those to `split-squat`, which in the new plan is `per_side: true` and carries a prescription-level `load: light-pair` in session C — the same two properties, in one movement. Note that `split-squat` appears in session C's `main` block, so any block-key assertion moves with it.

- [ ] **Step 4: Run the suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add tests/
git commit -m "test: migrate the unit suites onto the new fixture

Mostly a slug and metric-key substitution. The exception is the tests
that used the supported one-arm row specifically because it was per-side
and loaded: the new plan's rowing movement is neither, so those move to
the split squat, which is per-side and carries a prescription-level load
override in session C.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Migrate the e2e harness and the non-walkthrough specs

`E2E_PLAN_SLUG` centralises most of this. The walkthroughs are Task 7 and are deliberately left broken here.

**Files:**
- Modify: `e2e/env.ts:58-59`, `e2e/seed.ts:34`
- Modify: `e2e/session-runner.spec.ts`, `-actions`, `-exercise-state`, `-focus`, `-log-strip`, `-resume`, `-theme`, `e2e/offline-*.spec.ts`, `e2e/export-walkthrough.spec.ts`

- [ ] **Step 1: Point the harness at the new fixture**

`e2e/seed.ts:34`:

```ts
const FIXTURE_PATH = path.join(process.cwd(), "fixtures/plans/home-training-v1.md");
```

`e2e/env.ts:58-59`:

```ts
/** `plan.slug` in `fixtures/plans/home-training-v1.md` — confirmed against the fixture and `tests/server/first-run.test.ts`. */
export const E2E_PLAN_SLUG = "home-training";
```

- [ ] **Step 2: Run the e2e suite to see what breaks**

Run: `npm run test:e2e`
Expected: the two walkthroughs FAIL (Task 7); note anything else that does.

- [ ] **Step 3: Fix the remaining specs**

Apply the same substitution table as Task 5. Most specs open a session and log against whatever the plan prescribes, so the common break is a hardcoded exercise name in a locator.

- [ ] **Step 4: Run everything except the walkthroughs**

Run: `npm run test:e2e -- --grep-invert "walkthrough"`
Expected: PASS at all three viewports.

- [ ] **Step 5: Commit**

```bash
git add e2e/
git commit -m "test(e2e): point the harness at the new fixture

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Rewrite the two walkthroughs

These are phase 4's "done when" as a durable regression spec, and they are written against v1's specific session content. They are rewritten, not renamed.

Read both files in full before starting. Preserve what each one is *for* — the header comments say so explicitly, and that intent is the specification. Only the movements change.

**Files:**
- Modify: `e2e/session-runner-walkthrough-a.spec.ts`
- Modify: `e2e/session-runner-walkthrough-d.spec.ts`

**Interfaces:**
- Consumes: `E2E_PLAN_SLUG`, and the helpers in `e2e/helpers.ts` — `dismissPreSessionPrompt`, `logSet`, `logSetThroughRest`, `openExercise`, `setLogsOf`, `workoutClientId`. Signatures unchanged.

- [ ] **Step 1: Map the new sessions**

New session A (`Squat, Press & Row`): warm-up checkoff (5 movements), `main` = goblet-squat, db-floor-press, prone-row, glute-bridge; `core` = dead-bug, side-plank.

New session D (`Full Body, Arms & Abs`): warm-up checkoff; `main` = goblet-squat (`sets: [2,3]`, prescription-level `substitutes`), db-floor-press (`sets: [2,3]`), prone-row, hammer-curl, lying-triceps-extension; `ab-finisher` = a **rounds** block of 2 rounds over dead-bug, mcgill-curl-up, reverse-crunch.

- [ ] **Step 2: Rewrite walkthrough A**

Keep the covered ground identical to the header comment: warm-up checkoff pills, every `main` exercise, a rest timer that counts down and is dismissed by a deliberate tap, a mid-session reload, one `add_set` deviation, the `core` block, wrap-up through Finish.

Two things change with the plan:
- The per-side movement is gone from session A. `side-plank` in `core` is `per_side: true` and timed — use it for the per-side assertions, which also exercises per-side **duration** rather than per-side reps.
- Put the `add_set` deviation on `glute-bridge`.

The wrap-up now prompts for the **required** session-scope `symptoms_during`. Confirm the sheet cannot be finished without it, since that is new behaviour this fixture introduces.

- [ ] **Step 3: Rewrite walkthrough D**

Keep its distinct coverage: ranged sets, the rounds block logged round by round, and a substitution. Session D's `goblet-squat` now carries a prescription-level `substitutes: [bodyweight-squat]` and a ranged `sets: [2, 3]` — exercise both.

- [ ] **Step 4: Run both**

Run: `npm run test:e2e -- --grep "walkthrough"`
Expected: PASS at all three viewports, no horizontal overflow.

- [ ] **Step 5: Run the whole e2e suite and commit**

Run: `npm run test:e2e`
Expected: PASS.

```bash
git add e2e/
git commit -m "test(e2e): rewrite both walkthroughs against the new sessions

Phase 4's done-when, retargeted. Each spec keeps the ground its header
comment claims; only the movements change. Session A has no per-side
movement in its main block now, so the per-side assertions move to the
side plank in core — which exercises per-side duration rather than
per-side reps, and covers a shape the old walkthrough never did.

Both wrap-ups now have a required session metric to satisfy, which is new
behaviour the fixture introduces.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Update the docs and delete the old fixture

**Files:**
- Modify: `AGENTS.md:355-372` ("The fixture" section)
- Modify: `docs/ARCHITECTURE.md:440`, `:475`
- Modify: `docs/UI-DECISIONS.md` (wherever it names the fixture)
- Modify: `src/lib/db/review.ts:5-6` (the comment's example counts)
- Modify: `design/session-runner-mockup.html` — byte-sensitive, hand-edit
- Delete: `fixtures/plans/home-dumbbell-v1.md`

- [ ] **Step 1: Rewrite AGENTS.md's fixture section**

Keep the "it is fictional and must stay that way" paragraph verbatim — it is why this rebuild took the shape it did. Replace the primitive list and the counts with the new document's, and add a line pointing at `tests/fixture-coverage.test.ts` as the thing that keeps the list true.

Use the three counts recorded in Task 4 Step 1. **Do not estimate them.**

- [ ] **Step 2: Update ARCHITECTURE and the rest**

`docs/ARCHITECTURE.md:440` and `:475` state the counts in prose and in the worked first-run line. `src/lib/db/review.ts:5-6` uses them as an illustrative example in a comment. All three must agree with AGENTS.md and with `tests/golden.test.ts`.

- [ ] **Step 3: Delete the old fixture**

```bash
git rm fixtures/plans/home-dumbbell-v1.md
```

- [ ] **Step 4: Confirm nothing is left behind**

```bash
grep -rn "home-dumbbell" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.svelte-kit
```

Expected: matches **only** under `docs/superpowers/plans/2026-08-12-*.md`. Those are historical records of completed work and are deliberately not rewritten.

- [ ] **Step 5: Full verification**

```bash
npm run verify
npm run test:e2e
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs(fixture): retire the old fixture and restate the new one's shape

The counts in AGENTS.md, ARCHITECTURE §6 and §7, and review.ts's comment
are asserted by tests/golden.test.ts, so a stale one is a lie the suite
will eventually catch — restated together from the finished document
rather than estimated.

AGENTS.md now points at tests/fixture-coverage.test.ts, which is what
keeps the primitive list honest rather than the prose claiming it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Every section of the design doc maps to a task: the `keep_load_when` argument → Task 1; the `version: 2` correction → Task 2; the nine-primitive table and the two-scope gap → Task 3; fictionalising → Task 3 Step 3; the blast-radius table → Tasks 4–8; the six-step sequence → the task order; every "done when" bullet → Task 8 Steps 4–5, except the coverage bullet, which Task 3's test asserts permanently.

**Known soft spots**, called out rather than hidden:

- **Task 3's counts are not knowable until the document exists.** The plan deliberately routes them through Task 4 Step 1's failure output and forbids guessing, rather than inventing numbers here that would then be wrong in four places.
- **Task 5 Step 3 and Task 7 are the two places requiring real judgement.** Both name exactly which properties made the old movement the right choice (`per_side` + external load) and which new movement has them, so the substitution is checkable rather than a matter of taste.
- **Task 6 Step 3 is the least specific step in the plan.** It cannot be pinned further without running the suite, which is why Step 2 runs it first and reads the failures.
