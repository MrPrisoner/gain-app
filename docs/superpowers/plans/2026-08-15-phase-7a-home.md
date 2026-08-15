# Phase 7a — Home, the today screen: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Home screen (`/`) suggests the right next session from `scheduling.sequence`, a user can log an activity in one tap-then-confirm, and a plan declaring a `next_morning` metric collects it exactly once, the following morning.

**Architecture:** Three new pure modules under `src/lib/home/` (suggestion, activity-kind bookkeeping, next-morning windowing) plus one read module (`src/lib/db/home.ts`) feed a reworked `+page.server.ts` load and four new components. Activity logging becomes the sync outbox's sixth op kind, reusing the exact idempotent-on-`client_id` write layer every other log table already has. Nothing about the existing session runner, sync transport, or export changes.

**Tech Stack:** TypeScript 6 (strict), SvelteKit 2 (Svelte 5 runes), better-sqlite3 13, Zod 4, Vitest 4, Playwright 1.62 (`page.clock`), `ulidx`.

**Spec:** [`docs/superpowers/specs/2026-08-15-phase-7a-home-design.md`](../specs/2026-08-15-phase-7a-home-design.md). Where this plan and that spec disagree, the spec is right and this plan is a bug — flag it rather than silently following the plan.

## Global Constraints

- **Read `CLAUDE.md` first**, then `docs/ARCHITECTURE.md` §9–10, then the spec above.
- **Node 24 LTS. Every dependency is on a current major** — Zod 4, TypeScript 6, Svelte 5. This repo uses `z.strictObject`, `z.looseObject` and `error:` — never `z.object().strict()` or `message:`. Every `.svelte` file is runes mode (`$state`, `$derived`, `$props`, `$effect`) — never `export let`.
- **`npm run verify` is the definition of done.** It short-circuits (lint failure ⇒ tests never run). Run it before claiming any task complete. Run `npx prettier --write <file>` after every TypeScript/Svelte edit.
- **Never write a literal control character — write the escape** (`\u0000`).
- **Icons come from `~icons/lucide/*`**, imported per call site (`import IconX from "~icons/lucide/x"`), never `@iconify/svelte`. A class passed to an icon needs `:global()` to style it.
- **A form action / write path must never throw** an uncaught error into the user's face. Sheet components catch and surface `err instanceof Error ? err.message : "Something went wrong."` next to the control that failed.
- **Ops carry slugs and client ULIDs, never server ids.** The server resolves them at replay.
- **Metric values key on `(scope, key)`, never the bare key.**
- **`weight_kg` is always total kilograms** — irrelevant to this phase, but do not touch anything that computes it.
- **Green/amber/red is reserved for the plan's symptom framework** (UI-DECISIONS §5) and the celebration screen's confetti (§8). Nothing built in this plan uses `--green`, `--amber` or `--red` — new UI uses `--accent`/`--accent-soft`/`--surface`/`--raised`/`--line`/`--muted` only.
- **360 × 800 is the layout floor.** New cards must not introduce horizontal overflow at that width.
- **Do not commit real health data.** The fixture is fictional and stays that way.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/home/next-session.ts` | `suggestNextSession` — pure | 1 |
| `tests/home/next-session.test.ts` | Sequence walk, wrap, fallback, override, empty history | 1 |
| `src/lib/home/activity-kinds.ts` | `slugifyActivityKind`, `suggestActivityKinds` — pure | 2 |
| `tests/home/activity-kinds.test.ts` | Recency, dedup, cap, `rest`, slugify edge cases | 2 |
| `src/lib/home/activity-when.ts` | `occurredAtMsFor` — pure | 3 |
| `tests/home/activity-when.test.ts` | Now / earlier-today clamp / yesterday | 3 |
| `src/lib/home/next-morning.ts` | `dueNextMorningPrompts` — pure | 4 |
| `tests/home/next-morning.test.ts` | Day boundary, answered filtering, dismissal | 4 |
| `src/lib/db/workout.ts` | `logActivity` (modify) | 5 |
| `src/lib/sync/ops.ts` | `activityOpSchema`, sixth union member (modify) | 5 |
| `src/lib/sync/replay.ts` | `case "activity"` (modify) | 5 |
| `tests/db/workout.test.ts` | `logActivity` idempotency (modify) | 5 |
| `tests/sync/ops.test.ts` | Activity op accept/reject (modify) | 5 |
| `tests/sync/replay.test.ts` | Replay twice writes once (modify) | 5 |
| `src/lib/db/home.ts` | `recentWorkoutsForPlan`, `recentActivities`, `nextMorningCandidates` | 6 |
| `tests/db/home.test.ts` | Against a seeded db | 6 |
| `src/lib/components/MetricRow.svelte` | Relocated from the session route (move) | 7 |
| `src/routes/plan/[slug]/session/[key]/+page.svelte`, `WrapUpSheet.svelte` | Import path update (modify) | 7 |
| `src/routes/NextSessionCard.svelte` | The primary "start this" card | 8 |
| `src/routes/SessionOverrideList.svelte` | Collapsed picker + scheduling notes | 9 |
| `src/routes/ActivityStrip.svelte`, `ActivitySheet.svelte` | Chips + the log-with-detail sheet | 10 |
| `src/routes/NextMorningPrompt.svelte` | The due-prompt card | 11 |
| `src/routes/+page.server.ts` | Wire suggestion/activity-kinds/next-morning into `load` (modify) | 12 |
| `tests/server/first-run.test.ts` | Extend with a home-suggestion assertion (modify) | 12 |
| `src/routes/+page.svelte` | Rework into the today screen (modify) | 13 |
| `e2e/helpers.ts` | `activitiesOf` (modify) | 14 |
| `e2e/home-walkthrough.spec.ts` | End-to-end proof | 14 |
| `docs/ROADMAP.md` | Tick the three phase-7 items this closes (modify) | 15 |

**What already exists — do not rebuild it:**

- `src/lib/sync/client.svelte.ts` — `logWrite(planSlug, op)`, `startSyncLoop(planSlug)`, `syncStatus`. Note from reading it closely: `planSlug` is threaded through every function here but **never actually used to filter or address anything** — the batch endpoint has no `?plan=` and resolves each op's plan from the op itself. It is safe to pass a literal `"home"` for the two write paths this plan adds that have no owning plan (activity, and the sync-loop registration on `+page.svelte`); pass the real plan slug for `NextMorningPrompt`'s metric op, since a real one is available there and there is no reason not to use it.
- `src/lib/sync/idb.ts` — the object store is keyed on `op.id` with a secondary index on `op.workoutClientId`. An op object with no `workoutClientId` property (the new `activity` op) is automatically absent from that index — **no change needed here.**
- `src/lib/sync/queue.ts` (`planBatch`, `applyAck`) — op-kind-agnostic. No change needed.
- `src/routes/api/sync/+server.ts` — calls `replayOps` generically. No change needed.
- `src/routes/plan/[slug]/session/[key]/MetricRow.svelte` — renders `scale`/`number` (as a scale) and `enum` metric types, writes a session-scope metric op via `logWrite`. Task 7 relocates it; task 11 reuses it verbatim for the next-morning prompt rather than re-implementing metric rendering.
- `src/routes/plan/[slug]/session/[key]/DeviationSheet.svelte` — the sheet-before-write pattern (backdrop, `role="dialog"`, `use:trapFocus`, Cancel/primary actions) this plan's two new sheets follow.

---

### Task 1: `suggestNextSession`

**Files:**
- Create: `src/lib/home/next-session.ts`
- Create: `tests/home/next-session.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SessionOrderRef`, `RecentWorkoutRef`, `SessionOverrideRef`, `NextSessionSuggestion`, `suggestNextSession(sessions, sequence, recentWorkouts): NextSessionSuggestion`. Task 12 calls this directly; tasks 8–9's components consume its output shape.

- [ ] **Step 1: Write the failing test**

Create `tests/home/next-session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { suggestNextSession } from "../../src/lib/home/next-session";

const SESSIONS = [
  { key: "A", order: 1 },
  { key: "B", order: 2 },
  { key: "C", order: 3 },
  { key: "D", order: 4 },
];
const SEQUENCE = ["A", "B", "C", "D"];

describe("suggestNextSession", () => {
  it("suggests the sequence's first entry with no history at all", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, []);
    expect(result.suggestedKey).toBe("A");
    expect(result.lastSession).toBeUndefined();
  });

  it("suggests the entry after the most recent in-sequence workout", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "B", startedAt: "2026-08-12T08:00:00.000Z" },
      { sessionKey: "A", startedAt: "2026-08-05T08:00:00.000Z" },
    ]);
    expect(result.suggestedKey).toBe("C");
  });

  it("wraps from the sequence's last entry back to its first", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "D", startedAt: "2026-08-12T08:00:00.000Z" },
    ]);
    expect(result.suggestedKey).toBe("A");
  });

  it("advances the cursor on any workout status — a stop is still an attempt", () => {
    // suggestNextSession never sees status at all: the caller (`recentWorkoutsForPlan`,
    // task 6) includes every workout regardless of status, which is what makes this true.
    // This test documents that by construction rather than by a status field this
    // function does not accept.
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "A", startedAt: "2026-08-12T08:00:00.000Z" },
    ]);
    expect(result.suggestedKey).toBe("B");
  });

  it("falls back to declared order when the plan has no sequence", () => {
    const result = suggestNextSession(SESSIONS, undefined, [
      { sessionKey: "B", startedAt: "2026-08-12T08:00:00.000Z" },
    ]);
    expect(result.suggestedKey).toBe("C");
  });

  it("falls back to declared order when the sequence is empty", () => {
    const result = suggestNextSession(SESSIONS, [], []);
    expect(result.suggestedKey).toBe("A");
  });

  it("ignores a workout on a session the sequence omits when finding the cursor", () => {
    // E is not in SEQUENCE. The most recent *in-sequence* workout is still A, so the
    // suggestion advances from A, not from E.
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "E", startedAt: "2026-08-13T08:00:00.000Z" },
      { sessionKey: "A", startedAt: "2026-08-12T08:00:00.000Z" },
    ]);
    expect(result.suggestedKey).toBe("B");
  });

  it("reports the very last workout as `lastSession` even when it is unsequenced", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "E", startedAt: "2026-08-13T08:00:00.000Z" },
      { sessionKey: "A", startedAt: "2026-08-12T08:00:00.000Z" },
    ]);
    expect(result.lastSession).toEqual({ key: "E", startedAtDate: "2026-08-13" });
  });

  it("builds one override entry per declared session, in order, with its own last-done date", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "B", startedAt: "2026-08-12T08:00:00.000Z" },
      { sessionKey: "A", startedAt: "2026-08-05T08:00:00.000Z" },
    ]);
    expect(result.overrides).toEqual([
      { key: "A", lastDoneDate: "2026-08-05" },
      { key: "B", lastDoneDate: "2026-08-12" },
      { key: "C", lastDoneDate: undefined },
      { key: "D", lastDoneDate: undefined },
    ]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/home/next-session.test.ts`
Expected: fails with a module-not-found error for `../../src/lib/home/next-session`.

- [ ] **Step 3: Implement**

Create `src/lib/home/next-session.ts`:

```ts
/**
 * The Home screen's suggested next session (ARCHITECTURE §9, "Home"; design spec §4).
 *
 * Pure: no clock, no I/O. `recentWorkouts` must already be most-recent-first — the
 * caller (`recentWorkoutsForPlan`, `src/lib/db/home.ts`) orders by `started_at DESC`.
 */

export type SessionOrderRef = { key: string; order: number };
export type RecentWorkoutRef = { sessionKey: string; startedAt: string };

export type SessionOverrideRef = {
  key: string;
  /** ISO date (YYYY-MM-DD) of the most recent workout on this session, if any. */
  lastDoneDate: string | undefined;
};

export type NextSessionSuggestion = {
  suggestedKey: string;
  /** The very last workout done, on any session — undefined with no history at all. */
  lastSession: { key: string; startedAtDate: string } | undefined;
  /** One entry per declared session, in declaration order. */
  overrides: SessionOverrideRef[];
};

/**
 * The rotation order: `scheduling.sequence` when the plan declares one (or a non-empty
 * one), else declared session order. `sequence` is pre-validated by the contract parser
 * to reference only declared session keys (`checkSessionRefs`, `src/lib/contract/schema.ts`).
 */
function rotationOrder(sessions: readonly SessionOrderRef[], sequence: readonly string[] | undefined): string[] {
  if (sequence !== undefined && sequence.length > 0) return [...sequence];
  return [...sessions].sort((a, b) => a.order - b.order).map((s) => s.key);
}

export function suggestNextSession(
  sessions: readonly SessionOrderRef[],
  sequence: readonly string[] | undefined,
  recentWorkouts: readonly RecentWorkoutRef[],
): NextSessionSuggestion {
  const order = rotationOrder(sessions, sequence);
  const firstKey = order[0] ?? sessions[0]?.key ?? "";

  // The cursor is the most recent workout whose session is actually part of the
  // rotation — a workout on a session the sequence omits (an "extra") must not derail
  // it. Any status counts: a red-flag stop was still an attempt, and this function
  // never sees status at all (see the "advances on any status" test above).
  const cursor = recentWorkouts.find((w) => order.includes(w.sessionKey));
  const suggestedKey =
    cursor === undefined
      ? firstKey
      : (order[(order.indexOf(cursor.sessionKey) + 1) % order.length] ?? firstKey);

  const overrides: SessionOverrideRef[] = [...sessions]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      key: s.key,
      lastDoneDate: recentWorkouts.find((w) => w.sessionKey === s.key)?.startedAt.slice(0, 10),
    }));

  const last = recentWorkouts[0];
  return {
    suggestedKey,
    lastSession: last === undefined ? undefined : { key: last.sessionKey, startedAtDate: last.startedAt.slice(0, 10) },
    overrides,
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/home/next-session.test.ts`
Expected: all `it` blocks pass.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src/lib/home/next-session.ts tests/home/next-session.test.ts
git add src/lib/home/next-session.ts tests/home/next-session.test.ts
git commit -m "feat(home): add the suggested-next-session module"
```

---

### Task 2: Activity kind suggestion and slugification

**Files:**
- Create: `src/lib/home/activity-kinds.ts`
- Create: `tests/home/activity-kinds.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `slugifyActivityKind(input: string): string`, `suggestActivityKinds(activities: readonly { kind: string }[], limit?: number): string[]`. Task 10's `ActivitySheet.svelte` calls `slugifyActivityKind`; task 12's `+page.server.ts` calls `suggestActivityKinds`.

- [ ] **Step 1: Write the failing test**

Create `tests/home/activity-kinds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { slugifyActivityKind, suggestActivityKinds } from "../../src/lib/home/activity-kinds";

describe("slugifyActivityKind", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyActivityKind("Squash")).toBe("squash");
    expect(slugifyActivityKind("Trail Run")).toBe("trail-run");
  });

  it("collapses runs of non-alphanumerics into one hyphen", () => {
    expect(slugifyActivityKind("Yoga / Pilates!!")).toBe("yoga-pilates");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugifyActivityKind("  -Surfing- ")).toBe("surfing");
  });

  it("returns an empty string for input with nothing sluggable", () => {
    expect(slugifyActivityKind("   ///  ")).toBe("");
  });
});

describe("suggestActivityKinds", () => {
  it("returns the kinds already used, most-recent-first, deduplicated", () => {
    const kinds = suggestActivityKinds([
      { kind: "squash" },
      { kind: "yoga" },
      { kind: "squash" },
    ]);
    expect(kinds.slice(0, 2)).toEqual(["squash", "yoga"]);
  });

  it("always includes rest, even with no activity history at all", () => {
    expect(suggestActivityKinds([])).toEqual(["rest"]);
  });

  it("never lists rest twice, whatever order history logged it in", () => {
    const kinds = suggestActivityKinds([{ kind: "rest" }, { kind: "squash" }]);
    expect(kinds.filter((k) => k === "rest")).toHaveLength(1);
  });

  it("caps the total at the given limit, rest always present within it", () => {
    const activities = ["a", "b", "c", "d", "e", "f", "g"].map((kind) => ({ kind }));
    const kinds = suggestActivityKinds(activities, 4);
    expect(kinds).toHaveLength(4);
    expect(kinds[3]).toBe("rest");
    expect(kinds.slice(0, 3)).toEqual(["a", "b", "c"]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/home/activity-kinds.test.ts`
Expected: module-not-found failure.

- [ ] **Step 3: Implement**

Create `src/lib/home/activity-kinds.ts`:

```ts
/**
 * Activity kind bookkeeping (design spec §5). `activity.kind` is a free-form slug in
 * the user's own vocabulary — GAIN ships no list of sports (ARCHITECTURE §9), so this
 * module only ever reflects kinds the user has already used, plus `rest`.
 */

/**
 * The boring kind of slugify: lowercase, non-alphanumerics collapsed to single hyphens,
 * leading/trailing hyphens trimmed. This mints identifiers the export CSV carries to an
 * AI, so it must be predictable rather than clever.
 */
export function slugifyActivityKind(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The kinds already used, most-recent-first, deduplicated, capped at `limit` with
 * `rest` always present — six chips plus a "new" control fit a 360px screen without
 * wrapping into a grid that has to be scanned.
 */
export function suggestActivityKinds(activities: readonly { kind: string }[], limit = 6): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const a of activities) {
    if (a.kind === "rest" || seen.has(a.kind)) continue;
    seen.add(a.kind);
    ordered.push(a.kind);
    if (ordered.length >= limit - 1) break;
  }
  ordered.push("rest");
  return ordered;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/home/activity-kinds.test.ts`
Expected: all pass.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src/lib/home/activity-kinds.ts tests/home/activity-kinds.test.ts
git add src/lib/home/activity-kinds.ts tests/home/activity-kinds.test.ts
git commit -m "feat(home): add activity kind suggestion and slugification"
```

---

### Task 3: The activity sheet's "when" bucket

**Files:**
- Create: `src/lib/home/activity-when.ts`
- Create: `tests/home/activity-when.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ActivityWhen` (`"now" | "earlier_today" | "yesterday"`), `occurredAtMsFor(choice: ActivityWhen, nowMs: number): number`. Task 10's `ActivitySheet.svelte` calls this.

- [ ] **Step 1: Write the failing test**

Create `tests/home/activity-when.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { occurredAtMsFor } from "../../src/lib/home/activity-when";

describe("occurredAtMsFor", () => {
  it("returns now unchanged for \"now\"", () => {
    const now = Date.parse("2026-08-15T18:00:00.000Z");
    expect(occurredAtMsFor("now", now)).toBe(now);
  });

  it("returns today at noon for \"earlier_today\" when now is in the afternoon", () => {
    const now = Date.parse("2026-08-15T18:00:00.000Z");
    expect(occurredAtMsFor("earlier_today", now)).toBe(Date.parse("2026-08-15T12:00:00.000Z"));
  });

  it("clamps \"earlier_today\" to now when now is before noon", () => {
    const now = Date.parse("2026-08-15T08:00:00.000Z");
    expect(occurredAtMsFor("earlier_today", now)).toBe(now);
  });

  it("returns yesterday at noon for \"yesterday\", regardless of the time of day now", () => {
    const now = Date.parse("2026-08-15T08:00:00.000Z");
    expect(occurredAtMsFor("yesterday", now)).toBe(Date.parse("2026-08-14T12:00:00.000Z"));
  });
});
```

Note: this test asserts UTC wall-clock instants via `Date.parse`, so `setHours` in the implementation must use the UTC variant (`setUTCHours`) or the test becomes timezone-dependent. Use `setUTCDate`/`setUTCHours` throughout.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/home/activity-when.test.ts`
Expected: module-not-found failure.

- [ ] **Step 3: Implement**

Create `src/lib/home/activity-when.ts`:

```ts
/**
 * Maps the activity sheet's coarse "when" choice to a timestamp (design spec §5). Exact
 * clock precision does not matter anywhere downstream — nothing in the export reads
 * activity timestamps more finely than a date — so this only has to land on the right
 * day, at a stable hour.
 */

export type ActivityWhen = "now" | "earlier_today" | "yesterday";

/**
 * "earlier_today" clamps to `nowMs` rather than landing in the future — a user
 * logging at 8am who picks "earlier today" should not get a timestamp seven hours
 * from now.
 */
export function occurredAtMsFor(choice: ActivityWhen, nowMs: number): number {
  if (choice === "now") return nowMs;

  const d = new Date(nowMs);
  if (choice === "yesterday") d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(12, 0, 0, 0);
  return Math.min(d.getTime(), nowMs);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/home/activity-when.test.ts`
Expected: all pass.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src/lib/home/activity-when.ts tests/home/activity-when.test.ts
git add src/lib/home/activity-when.ts tests/home/activity-when.test.ts
git commit -m "feat(home): add the activity sheet's when-bucket mapping"
```

---

### Task 4: `dueNextMorningPrompts`

**Files:**
- Create: `src/lib/home/next-morning.ts`
- Create: `tests/home/next-morning.test.ts`

**Interfaces:**
- Consumes: `MetricDef` from `../contract/schema` (already exists: `{ key, label, type, min?, max?, options?, optional?, prompt_when? }`).
- Produces: `NextMorningCandidate` (`{ workoutClientId, planSlug, sessionKey, finishedAt, metrics: MetricDef[], answeredKeys: string[] }`), `dueNextMorningPrompts(candidates, nowMs, dismissedWorkoutClientIds): NextMorningCandidate[]`. Task 6's `nextMorningCandidates` (db read) produces `NextMorningCandidate[]`; task 13's `+page.svelte` calls `dueNextMorningPrompts` client-side.

- [ ] **Step 1: Write the failing test**

Create `tests/home/next-morning.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { MetricDef } from "../../src/lib/contract/schema";
import { dueNextMorningPrompts, type NextMorningCandidate } from "../../src/lib/home/next-morning";

const METRIC: MetricDef = {
  key: "symptoms_next_morning",
  label: "Hip / lower-back symptoms this morning",
  type: "scale",
  min: 0,
  max: 10,
  optional: true,
  prompt_when: "next_morning",
};

function candidate(overrides: Partial<NextMorningCandidate> = {}): NextMorningCandidate {
  return {
    workoutClientId: "wk-1",
    planSlug: "home-training",
    sessionKey: "A",
    finishedAt: "2026-08-14T20:00:00.000Z",
    metrics: [METRIC],
    answeredKeys: [],
    ...overrides,
  };
}

// "Now" fixed at 2026-08-15T09:00:00Z — the candidate's finishedAt (Aug 14, evening) is
// the previous UTC calendar day.
const NOW = Date.parse("2026-08-15T09:00:00.000Z");

describe("dueNextMorningPrompts", () => {
  it("surfaces a candidate finished the previous calendar day", () => {
    expect(dueNextMorningPrompts([candidate()], NOW, [])).toHaveLength(1);
  });

  it("excludes a candidate finished two days ago", () => {
    const old = candidate({ finishedAt: "2026-08-13T20:00:00.000Z" });
    expect(dueNextMorningPrompts([old], NOW, [])).toHaveLength(0);
  });

  it("excludes a candidate finished today", () => {
    const today = candidate({ finishedAt: "2026-08-15T02:00:00.000Z" });
    expect(dueNextMorningPrompts([today], NOW, [])).toHaveLength(0);
  });

  it("respects the UTC day boundary right at midnight", () => {
    const justBefore = candidate({ finishedAt: "2026-08-13T23:59:59.999Z" });
    const justAfter = candidate({ workoutClientId: "wk-2", finishedAt: "2026-08-14T00:00:00.000Z" });
    expect(dueNextMorningPrompts([justBefore], NOW, [])).toHaveLength(0);
    expect(dueNextMorningPrompts([justAfter], NOW, [])).toHaveLength(1);
  });

  it("drops an already-answered metric rather than the whole candidate", () => {
    const partiallyAnswered = candidate({
      metrics: [METRIC, { ...METRIC, key: "other_metric", label: "Other" }],
      answeredKeys: ["symptoms_next_morning"],
    });
    const due = dueNextMorningPrompts([partiallyAnswered], NOW, []);
    expect(due).toHaveLength(1);
    expect(due[0]?.metrics.map((m) => m.key)).toEqual(["other_metric"]);
  });

  it("drops the whole candidate once every one of its metrics is answered", () => {
    const fullyAnswered = candidate({ answeredKeys: ["symptoms_next_morning"] });
    expect(dueNextMorningPrompts([fullyAnswered], NOW, [])).toHaveLength(0);
  });

  it("excludes a dismissed workout", () => {
    expect(dueNextMorningPrompts([candidate()], NOW, ["wk-1"])).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/home/next-morning.test.ts`
Expected: module-not-found failure.

- [ ] **Step 3: Implement**

Create `src/lib/home/next-morning.ts`:

```ts
/**
 * The next-morning metric prompt (design spec §6). A `next_morning` metric is
 * worthless collected three days later, so this is a strict one-day window rather
 * than a generous one — "previous calendar day", computed against the caller's clock.
 *
 * The server (`src/lib/db/home.ts`, `nextMorningCandidates`) returns candidates within
 * a generous real-time window; this function, called client-side with the browser's
 * own `Date.now()`, narrows to exactly "yesterday" in the viewer's own timezone. The
 * split matters because the container's timezone is not the user's.
 */

import type { MetricDef } from "../contract/schema";

export type NextMorningCandidate = {
  workoutClientId: string;
  planSlug: string;
  sessionKey: string;
  /** ISO timestamp — the workout's `completed_at`. */
  finishedAt: string;
  /** This workout's plan version's session-scope metrics with `prompt_when: "next_morning"`. */
  metrics: MetricDef[];
  /** Metric keys already answered (scope `session`) for this workout. */
  answeredKeys: string[];
};

function localDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dueNextMorningPrompts(
  candidates: readonly NextMorningCandidate[],
  nowMs: number,
  dismissedWorkoutClientIds: readonly string[],
): NextMorningCandidate[] {
  const yesterday = localDateKey(nowMs - 24 * 60 * 60 * 1000);
  const dismissed = new Set(dismissedWorkoutClientIds);
  const due: NextMorningCandidate[] = [];

  for (const c of candidates) {
    if (dismissed.has(c.workoutClientId)) continue;
    if (localDateKey(Date.parse(c.finishedAt)) !== yesterday) continue;

    const unanswered = c.metrics.filter((m) => !c.answeredKeys.includes(m.key));
    if (unanswered.length === 0) continue;

    due.push({ ...c, metrics: unanswered });
  }

  return due;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/home/next-morning.test.ts`
Expected: all pass.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src/lib/home/next-morning.ts tests/home/next-morning.test.ts
git add src/lib/home/next-morning.ts tests/home/next-morning.test.ts
git commit -m "feat(home): add the next-morning prompt windowing"
```

---

### Task 5: The activity write path — `logActivity`, the sixth op, replay

**Files:**
- Modify: `src/lib/db/workout.ts`
- Modify: `src/lib/sync/ops.ts`
- Modify: `src/lib/sync/replay.ts`
- Modify: `tests/db/workout.test.ts`
- Modify: `tests/sync/ops.test.ts`
- Modify: `tests/sync/replay.test.ts`

**Interfaces:**
- Consumes: `newId` (`./ulid`, already imported in `workout.ts`).
- Produces: `logActivity(userDb, input): { id: string }` from `workout.ts`; `ActivityOp` type and the `"activity"` member of `SyncOp`/`syncOpSchema` from `ops.ts`. Task 6 does not depend on this (it only reads); tasks 10 and 13 depend on the `activity` op shape to write one via `logWrite`.

- [ ] **Step 1: Write the failing tests**

In `tests/db/workout.test.ts`, add (near the other `logX` tests — the file already imports `openUserDb`, `importPlan`, `parsePlanDocument` and sets up `userDb`/`planId`/`planVersionId` in `beforeEach`, so this only needs the import list and the new `it` blocks):

```ts
// Add `logActivity` to the existing import from "../../src/lib/db/workout".

it("logs an activity once, idempotently on client_id", () => {
  const first = logActivity(userDb, {
    kind: "squash",
    occurredAt: NOW,
    durationMin: 60,
    intensity: "hard",
    clientId: "act-client-1",
  });
  const second = logActivity(userDb, {
    kind: "squash",
    occurredAt: NOW,
    durationMin: 60,
    intensity: "hard",
    clientId: "act-client-1",
  });
  expect(second.id).toBe(first.id);

  const row = userDb.db.prepare("SELECT * FROM activity WHERE id = ?").get(first.id) as {
    kind: string;
    duration_min: number;
    intensity: string;
    note: string | null;
  };
  expect(row.kind).toBe("squash");
  expect(row.duration_min).toBe(60);
  expect(row.intensity).toBe("hard");
  expect(row.note).toBeNull();

  const count = userDb.db.prepare("SELECT COUNT(*) AS n FROM activity").get() as { n: number };
  expect(count.n).toBe(1);
});

it("logs an activity with only the required fields", () => {
  const { id } = logActivity(userDb, { kind: "rest", occurredAt: NOW, clientId: "act-client-2" });
  const row = userDb.db.prepare("SELECT duration_min, intensity, note FROM activity WHERE id = ?").get(id) as {
    duration_min: number | null;
    intensity: string | null;
    note: string | null;
  };
  expect(row).toEqual({ duration_min: null, intensity: null, note: null });
});
```

In `tests/sync/ops.test.ts`, add:

```ts
describe("the activity op", () => {
  const ACTIVITY = {
    kind: "activity",
    id: "01JZ0000000000000000000005",
    activityKind: "squash",
    occurredAt: "2026-09-08T08:00:00.000Z",
  };

  it("accepts the minimal shape", () => {
    expect(syncOpSchema.parse(ACTIVITY)).toEqual(ACTIVITY);
  });

  it("accepts the optional fields", () => {
    const op = { ...ACTIVITY, durationMin: 60, intensity: "hard", note: "felt great" };
    expect(syncOpSchema.parse(op)).toEqual(op);
  });

  it("carries no workoutClientId — an activity hangs off no workout", () => {
    const parsed = syncOpSchema.parse(ACTIVITY) as Record<string, unknown>;
    expect("workoutClientId" in parsed).toBe(false);
  });

  it("rejects a non-ISO occurredAt", () => {
    expect(() => syncOpSchema.parse({ ...ACTIVITY, occurredAt: "yesterday" })).toThrow();
  });

  it("rejects an empty activityKind", () => {
    expect(() => syncOpSchema.parse({ ...ACTIVITY, activityKind: "" })).toThrow();
  });
});
```

In `tests/sync/replay.test.ts`, add (the file already has `userDb`/`planVersionId`/`W` set up in `beforeEach`; this op needs none of that, so it is the simplest case in the file):

```ts
describe("the activity op", () => {
  it("writes once, replayed twice", () => {
    const op: SyncOp = {
      kind: "activity",
      id: "01ACT0000000000000000000001",
      activityKind: "squash",
      occurredAt: "2026-09-08T08:00:00.000Z",
    };

    const first = replayOps(userDb, [op]);
    expect(first.applied).toEqual([op.id]);
    const second = replayOps(userDb, [op]);
    expect(second.applied).toEqual([op.id]);

    const count = userDb.db.prepare("SELECT COUNT(*) AS n FROM activity").get() as { n: number };
    expect(count.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/db/workout.test.ts tests/sync/ops.test.ts tests/sync/replay.test.ts`
Expected: `logActivity` is not exported, `"activity"` is rejected by `syncOpSchema`, `case "activity"` does not exist.

- [ ] **Step 3: Implement**

In `src/lib/db/workout.ts`, widen `selectByClientId`'s table union and add `logActivity`:

```ts
// Change the existing selectByClientId signature's table union to include "activity":
function selectByClientId(
  userDb: UserDb,
  table: "workout" | "set_log" | "metric_value" | "deviation" | "activity",
  clientId: string,
): string | undefined {
  const row = userDb.db.prepare(`SELECT id FROM ${table} WHERE client_id = ?`).get(clientId) as
    { id: string } | undefined;
  return row?.id;
}
```

Add near the other `LogXInput` types:

```ts
export type LogActivityInput = {
  kind: string;
  occurredAt: Date;
  durationMin?: number;
  intensity?: string;
  note?: string;
  clientId: string;
};
```

Add near the other `logX` functions:

```ts
/** `activity` is the one log table with no workout to hang off — the whole reason it
 * needs its own idempotency check rather than piggybacking on a workout's. */
export function logActivity(userDb: UserDb, input: LogActivityInput): { id: string } {
  const existing = selectByClientId(userDb, "activity", input.clientId);
  if (existing) return { id: existing };

  const id = newId();
  userDb.db
    .prepare(
      `INSERT INTO activity (id, kind, occurred_at, duration_min, intensity, note, client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.kind,
      input.occurredAt.toISOString(),
      input.durationMin ?? null,
      input.intensity ?? null,
      input.note ?? null,
      input.clientId,
    );
  return { id };
}
```

In `src/lib/sync/ops.ts`, add the schema (after `finishOpSchema`, before the union) and thread it through the union/exports:

```ts
const activityOpSchema = z.strictObject({
  kind: z.literal("activity"),
  id: opId,
  activityKind: z.string().min(1),
  occurredAt: isoTimestamp,
  durationMin: z.number().int().nonnegative().optional(),
  intensity: z.string().min(1).optional(),
  note: z.string().optional(),
});
```

```ts
// Change:
export const syncOpSchema = z.discriminatedUnion("kind", [
  startOpSchema,
  setOpSchema,
  metricOpSchema,
  deviationOpSchema,
  finishOpSchema,
]);
// To:
export const syncOpSchema = z.discriminatedUnion("kind", [
  startOpSchema,
  setOpSchema,
  metricOpSchema,
  deviationOpSchema,
  finishOpSchema,
  activityOpSchema,
]);
```

```ts
// Add alongside the other exported op types:
export type ActivityOp = z.infer<typeof activityOpSchema>;
```

In `src/lib/sync/replay.ts`, import `logActivity` and add the case (before the `default:` exhaustiveness guard):

```ts
// Add to the existing import from "../db/workout":
import {
  finishWorkout,
  logActivity,
  logDeviation,
  logMetric,
  logSet,
  resolvePlanVersionIdForWorkout,
  resolveSetLogIdByClientId,
  resolveWorkoutIdByClientId,
  startWorkout,
} from "../db/workout";
```

```ts
    case "activity":
      // No workout to resolve and nothing that can arrive out of order relative to —
      // unlike every other op kind, this one can never be NotYet.
      logActivity(userDb, {
        kind: op.activityKind,
        occurredAt: new Date(op.occurredAt),
        durationMin: op.durationMin,
        intensity: op.intensity,
        note: op.note,
        clientId: op.id,
      });
      return;
```

Place it directly above the existing `default:` block inside `applyOp`'s `switch`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/db/workout.test.ts tests/sync/ops.test.ts tests/sync/replay.test.ts`
Expected: all pass, including every pre-existing test in these three files (the `never` exhaustiveness guard in `replay.ts` means a missing case is a compile error, so `npm run typecheck` — run it here too — is part of confirming this step).

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src/lib/db/workout.ts src/lib/sync/ops.ts src/lib/sync/replay.ts tests/db/workout.test.ts tests/sync/ops.test.ts tests/sync/replay.test.ts
git add src/lib/db/workout.ts src/lib/sync/ops.ts src/lib/sync/replay.ts tests/db/workout.test.ts tests/sync/ops.test.ts tests/sync/replay.test.ts
git commit -m "feat(sync): add the activity op, the outbox's sixth kind"
```

---

### Task 6: `src/lib/db/home.ts` — the read module

**Files:**
- Create: `src/lib/db/home.ts`
- Create: `tests/db/home.test.ts`

**Interfaces:**
- Consumes: `RecentWorkoutRef` shape (task 1, structurally — not imported, just matched), `NextMorningCandidate` (task 4, imported), `GainContract`/`MetricDef` (`../contract/schema`), `UserDb` (`./user-db`), `logActivity`/`startWorkout`/`finishWorkout`/`logMetric` (task 5, test-only).
- Produces: `HomeWorkoutRef`, `recentWorkoutsForPlan(userDb, planId, limit?): HomeWorkoutRef[]`; `ActivityKindRef`, `recentActivities(userDb, limit?): ActivityKindRef[]`; `nextMorningCandidates(userDb, now): NextMorningCandidate[]`. Task 12's `+page.server.ts` calls all three.

- [ ] **Step 1: Write the failing test**

Create `tests/db/home.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { finishWorkout, logActivity, logMetric, startWorkout } from "../../src/lib/db/workout";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { recentActivities, recentWorkoutsForPlan, nextMorningCandidates } from "../../src/lib/db/home";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");
const NOW = new Date("2026-09-08T08:00:00Z");

describe("src/lib/db/home", () => {
  let dataDir: string;
  let userDb: UserDb;
  let planId: string;
  let planVersionId: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-home-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });

    const parsed = parsePlanDocument(fixtureMd);
    if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error(result.message);
    planId = result.plan_id;
    planVersionId = result.plan_version_id;
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  describe("recentWorkoutsForPlan", () => {
    it("returns workouts most-recent-first, limited", () => {
      startWorkout(userDb, {
        planVersionId,
        sessionKey: "A",
        clientId: "wk-1",
        now: new Date("2026-09-01T08:00:00Z"),
      });
      startWorkout(userDb, {
        planVersionId,
        sessionKey: "B",
        clientId: "wk-2",
        now: new Date("2026-09-05T08:00:00Z"),
      });

      const rows = recentWorkoutsForPlan(userDb, planId);
      expect(rows.map((r) => r.sessionKey)).toEqual(["B", "A"]);

      expect(recentWorkoutsForPlan(userDb, planId, 1)).toHaveLength(1);
    });
  });

  describe("recentActivities", () => {
    it("returns activities most-recent-first, limited", () => {
      logActivity(userDb, { kind: "squash", occurredAt: new Date("2026-09-01T08:00:00Z"), clientId: "act-1" });
      logActivity(userDb, { kind: "yoga", occurredAt: new Date("2026-09-05T08:00:00Z"), clientId: "act-2" });

      const rows = recentActivities(userDb);
      expect(rows.map((r) => r.kind)).toEqual(["yoga", "squash"]);

      expect(recentActivities(userDb, 1)).toHaveLength(1);
    });
  });

  describe("nextMorningCandidates", () => {
    it("surfaces a completed workout's next_morning session metrics, unanswered", () => {
      const { id } = startWorkout(userDb, {
        planVersionId,
        sessionKey: "A",
        clientId: "wk-nm-1",
        now: NOW,
      });
      finishWorkout(userDb, { workoutId: id, status: "completed", now: NOW });

      const rows = nextMorningCandidates(userDb, NOW);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.workoutClientId).toBe("wk-nm-1");
      expect(rows[0]?.metrics.map((m) => m.key)).toContain("symptoms_next_morning");
      expect(rows[0]?.answeredKeys).toEqual([]);
    });

    it("excludes an already-answered metric key from answeredKeys' complement", () => {
      const { id } = startWorkout(userDb, {
        planVersionId,
        sessionKey: "A",
        clientId: "wk-nm-2",
        now: NOW,
      });
      finishWorkout(userDb, { workoutId: id, status: "completed", now: NOW });
      logMetric(userDb, {
        scope: "session",
        workoutId: id,
        metricKey: "symptoms_next_morning",
        valueNum: 3,
        clientId: "mv-1",
      });

      const [row] = nextMorningCandidates(userDb, NOW);
      expect(row?.answeredKeys).toEqual(["symptoms_next_morning"]);
    });

    it("excludes a workout completed outside the read window", () => {
      const { id } = startWorkout(userDb, {
        planVersionId,
        sessionKey: "A",
        clientId: "wk-nm-old",
        now: new Date("2026-09-01T08:00:00Z"),
      });
      finishWorkout(userDb, {
        workoutId: id,
        status: "completed",
        now: new Date("2026-09-01T08:00:00Z"),
      });

      expect(nextMorningCandidates(userDb, NOW)).toHaveLength(0);
    });

    it("excludes a workout with no client_id — there is no offline-addressable way to answer it", () => {
      const { id } = startWorkout(userDb, {
        planVersionId,
        sessionKey: "A",
        clientId: "wk-nm-legacy",
        now: NOW,
      });
      finishWorkout(userDb, { workoutId: id, status: "completed", now: NOW });
      userDb.db.prepare("UPDATE workout SET client_id = NULL WHERE id = ?").run(id);

      expect(nextMorningCandidates(userDb, NOW)).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/db/home.test.ts`
Expected: module-not-found failure.

- [ ] **Step 3: Implement**

Create `src/lib/db/home.ts`:

```ts
/**
 * Home-screen reads (design spec §7): what `src/lib/home/*` needs beyond what
 * `src/lib/db/read.ts` and `src/lib/db/logs.ts` already provide. Read-only, scoped to
 * one user's own database — physical isolation means there is no cross-user row to
 * leak here in the first place (ARCHITECTURE decision 4).
 */

import type { GainContract, MetricDef } from "../contract/schema";
import type { NextMorningCandidate } from "../home/next-morning";
import type { UserDb } from "./user-db";

export type HomeWorkoutRef = { sessionKey: string; startedAt: string };

/** Most-recent-first, for `suggestNextSession` (`src/lib/home/next-session.ts`). */
export function recentWorkoutsForPlan(userDb: UserDb, planId: string, limit = 10): HomeWorkoutRef[] {
  return userDb.db
    .prepare(
      `SELECT w.session_key AS sessionKey, w.started_at AS startedAt
       FROM workout w
       JOIN plan_version pv ON pv.id = w.plan_version_id
       WHERE pv.plan_id = ?
       ORDER BY w.started_at DESC
       LIMIT ?`,
    )
    .all(planId, limit) as HomeWorkoutRef[];
}

export type ActivityKindRef = { kind: string; occurredAt: string };

/** Every activity, not one plan's — `activity` carries no plan reference (design spec
 * §5, mirroring `src/lib/db/logs.ts`'s `activitiesOf`). Most-recent-first, for
 * `suggestActivityKinds` (`src/lib/home/activity-kinds.ts`). */
export function recentActivities(userDb: UserDb, limit = 20): ActivityKindRef[] {
  return userDb.db
    .prepare("SELECT kind, occurred_at AS occurredAt FROM activity ORDER BY occurred_at DESC LIMIT ?")
    .all(limit) as ActivityKindRef[];
}

type NextMorningRow = {
  id: string;
  clientId: string;
  planSlug: string;
  sessionKey: string;
  completedAt: string;
  contractJson: string;
};

/**
 * Workouts finished in the last 72 hours, with their plan version's
 * `prompt_when: "next_morning"` session metrics and which of those are already
 * answered. Generous on purpose: the exact "yesterday" narrowing happens client-side
 * in `dueNextMorningPrompts` (`src/lib/home/next-morning.ts`), against the viewer's own
 * clock rather than the server's timezone.
 *
 * `contract_json` (not the normalized `metric_def` table) is the source here, for the
 * same reason `contractOfVersion` (`src/lib/db/read.ts`) always reads it: a workout is
 * bound to the plan version it ran under (ARCHITECTURE §8), and this reads that
 * version's own contract rather than the plan's current one.
 */
export function nextMorningCandidates(userDb: UserDb, now: Date): NextMorningCandidate[] {
  const since = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();

  const rows = userDb.db
    .prepare(
      `SELECT w.id AS id, w.client_id AS clientId, p.slug AS planSlug, w.session_key AS sessionKey,
              w.completed_at AS completedAt, pv.contract_json AS contractJson
       FROM workout w
       JOIN plan_version pv ON pv.id = w.plan_version_id
       JOIN plan p ON p.id = pv.plan_id
       WHERE w.client_id IS NOT NULL AND w.completed_at IS NOT NULL AND w.completed_at >= ?
       ORDER BY w.completed_at DESC`,
    )
    .all(since) as NextMorningRow[];

  const candidates: NextMorningCandidate[] = [];
  for (const row of rows) {
    const contract = JSON.parse(row.contractJson) as GainContract;
    const metrics: MetricDef[] = (contract.metrics?.session ?? []).filter(
      (m) => m.prompt_when === "next_morning",
    );
    if (metrics.length === 0) continue;

    const answered = userDb.db
      .prepare("SELECT metric_key AS metricKey FROM metric_value WHERE workout_id = ? AND scope = 'session'")
      .all(row.id) as { metricKey: string }[];

    candidates.push({
      workoutClientId: row.clientId,
      planSlug: row.planSlug,
      sessionKey: row.sessionKey,
      finishedAt: row.completedAt,
      metrics,
      answeredKeys: answered.map((a) => a.metricKey),
    });
  }
  return candidates;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/db/home.test.ts`
Expected: all pass.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src/lib/db/home.ts tests/db/home.test.ts
git add src/lib/db/home.ts tests/db/home.test.ts
git commit -m "feat(db): add the Home screen's read module"
```

---

### Task 7: Relocate `MetricRow.svelte`

**Files:**
- Move: `src/routes/plan/[slug]/session/[key]/MetricRow.svelte` → `src/lib/components/MetricRow.svelte`
- Modify: `src/routes/plan/[slug]/session/[key]/+page.svelte`
- Modify: `src/routes/plan/[slug]/session/[key]/WrapUpSheet.svelte`

**Interfaces:**
- Consumes: nothing new — same content, same props (`metric`, `planSlug`, `workoutClientId`, `selected`, `onSelected`, `onError`), moved verbatim.
- Produces: an importable `$lib/components/MetricRow.svelte`. Task 11's `NextMorningPrompt.svelte` imports it from there.

Pure move, no behavior change — a manual pass rather than a TDD cycle. `MetricRow.svelte` currently renders `scale`/`number`/`enum` metric types; leave its contents untouched.

- [ ] **Step 1: Move the file**

```bash
mkdir -p src/lib/components
git mv "src/routes/plan/[slug]/session/[key]/MetricRow.svelte" src/lib/components/MetricRow.svelte
```

- [ ] **Step 2: Update the two import sites**

In `src/routes/plan/[slug]/session/[key]/+page.svelte`, change:

```ts
import MetricRow from "./MetricRow.svelte";
```

to:

```ts
import MetricRow from "$lib/components/MetricRow.svelte";
```

In `src/routes/plan/[slug]/session/[key]/WrapUpSheet.svelte`, make the identical change.

- [ ] **Step 3: Verify nothing else references the old path**

Run: `grep -rn 'session/\[key\]/MetricRow' src`
Expected: no output.

- [ ] **Step 4: Typecheck and check**

Run: `npx tsc --noEmit -p tsconfig.json && npm run check`
Expected: no errors.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write "src/routes/plan/[slug]/session/[key]/+page.svelte" "src/routes/plan/[slug]/session/[key]/WrapUpSheet.svelte" src/lib/components/MetricRow.svelte
git add -A src/lib/components/MetricRow.svelte "src/routes/plan/[slug]/session/[key]/MetricRow.svelte" "src/routes/plan/[slug]/session/[key]/+page.svelte" "src/routes/plan/[slug]/session/[key]/WrapUpSheet.svelte"
git commit -m "refactor(session): relocate MetricRow to \$lib/components for the Home screen to reuse"
```

---

### Task 8: `NextSessionCard.svelte`

**Files:**
- Create: `src/routes/NextSessionCard.svelte`

**Interfaces:**
- Consumes: `suggestedKey: string`, `lastSession: { key: string; startedAtDate: string } | undefined` (task 1's `NextSessionSuggestion` shape), `sessions: readonly { key: string; name: string }[]`, `planSlug`, `planName`.
- Produces: a card with a `.next-session` root, `.key` span holding the suggested key, and a `.start-link` anchor to `/plan/{planSlug}/session/{suggestedKey}`. Task 13 renders one per plan; the e2e spec in task 14 locates it by these classes.

No pure logic here — a manual implementation-and-eyeball task, verified by `npm run dev` and the e2e spec in task 14.

- [ ] **Step 1: Implement**

Create `src/routes/NextSessionCard.svelte`:

```svelte
<script lang="ts">
  import IconPlay from "~icons/lucide/play";

  /**
   * The Home screen's primary action (ARCHITECTURE §9, "Home"; design spec §4): the
   * session `suggestNextSession` (`$lib/home/next-session.ts`) picked, with the
   * factual reason for it — never more than GAIN actually knows.
   */
  let {
    planSlug,
    planName,
    suggestedKey,
    lastSession,
    sessions,
  }: {
    planSlug: string;
    planName: string;
    suggestedKey: string;
    lastSession: { key: string; startedAtDate: string } | undefined;
    sessions: readonly { key: string; name: string }[];
  } = $props();

  const suggestedName = $derived(sessions.find((s) => s.key === suggestedKey)?.name ?? suggestedKey);
</script>

<section class="card next-session">
  <p class="plan-name">{planName}</p>
  <h2><span class="key">{suggestedKey}</span>{suggestedName}</h2>
  <p class="reason">
    {#if lastSession}
      Last session: {lastSession.key}, {lastSession.startedAtDate}
    {:else}
      First session on this plan.
    {/if}
  </p>
  <a class="start-link" href={`/plan/${planSlug}/session/${suggestedKey}`}>
    <IconPlay />Start {suggestedKey}
  </a>
</section>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1.25rem;
    margin-top: 1.25rem;
  }
  .plan-name {
    margin: 0 0 0.15rem;
    font-size: 0.8rem;
    color: var(--muted);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  h2 {
    margin: 0 0 0.35rem;
    font-size: 1.3rem;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.8rem;
    padding: 0.1rem 0.4rem;
    border-radius: var(--r-xs);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 1rem;
    font-weight: 800;
  }
  .reason {
    margin: 0 0 0.9rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .start-link {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.8rem 1.25rem;
    border-radius: var(--r-sm);
    background: var(--accent);
    color: var(--accent-in);
    font-weight: 700;
  }
  .start-link:hover {
    text-decoration: none;
  }
</style>
```

- [ ] **Step 2: Typecheck and check**

Run: `npx tsc --noEmit -p tsconfig.json && npm run check`
Expected: no errors (the component is not yet wired into `+page.svelte` — task 13 does that — so this only checks the file compiles standalone).

- [ ] **Step 3: Format and commit**

```bash
npx prettier --write src/routes/NextSessionCard.svelte
git add src/routes/NextSessionCard.svelte
git commit -m "feat(home): add NextSessionCard"
```

---

### Task 9: `SessionOverrideList.svelte`

**Files:**
- Create: `src/routes/SessionOverrideList.svelte`

**Interfaces:**
- Consumes: `planSlug`, `suggestedKey: string`, `sessions: readonly { key, name, note, lastDoneDate, blocks: readonly { key, name, exercises: readonly string[] }[] }[]`, `schedulingRules: readonly string[] | undefined`, `dropOrder: readonly string[] | undefined`.
- Produces: a collapsed `.override` card; opening it reveals `.sessions` list items, each independently expandable to the existing block-detail markup (relocated from `+page.svelte`, task 13 removes it there). The e2e spec (task 14) drives this by role/class.

This relocates the accordion markup and styles from the current `src/routes/+page.svelte` (`.sessions`, `.session-toggle`, `.session-summary`, `.block-summary`, `.session-link`, `.chevron`) rather than inventing new markup, adding an outer list-level toggle, a "suggested" badge, a last-done date, and the scheduling rules/drop-order footer.

- [ ] **Step 1: Implement**

Create `src/routes/SessionOverrideList.svelte`:

```svelte
<script lang="ts">
  import IconChevronDown from "~icons/lucide/chevron-down";
  import IconPlay from "~icons/lucide/play";

  /**
   * The Home screen's secondary picker (design spec §4): every declared session,
   * collapsed behind one toggle, each further expandable to the block detail the plan
   * overview used to show above the fold. `scheduling.rules`/`drop_order` render
   * verbatim underneath as the plan's own words, never automated (design spec §2,
   * decision 7).
   */
  let {
    planSlug,
    suggestedKey,
    sessions,
    schedulingRules,
    dropOrder,
  }: {
    planSlug: string;
    suggestedKey: string;
    sessions: readonly {
      key: string;
      name: string;
      note: string | undefined;
      lastDoneDate: string | undefined;
      blocks: readonly { key: string; name: string; exercises: readonly string[] }[];
    }[];
    schedulingRules: readonly string[] | undefined;
    dropOrder: readonly string[] | undefined;
  } = $props();

  let listOpen = $state(false);
  let openSession = $state<string | null>(null);

  function toggleSession(key: string): void {
    openSession = openSession === key ? null : key;
  }
</script>

<section class="card override">
  <button
    type="button"
    class="secondary list-toggle"
    aria-expanded={listOpen}
    onclick={() => (listOpen = !listOpen)}
  >
    <span>Choose a different session</span>
    <IconChevronDown class="chevron {listOpen ? 'open' : ''}" />
  </button>

  {#if listOpen}
    <ul class="sessions">
      {#each sessions as session (session.key)}
        {@const isOpen = openSession === session.key}
        <li>
          <button
            type="button"
            class="secondary session-toggle"
            aria-expanded={isOpen}
            aria-controls={`override-summary-${planSlug}-${session.key}`}
            onclick={() => toggleSession(session.key)}
          >
            <span class="session-name">
              <span class="key">{session.key}</span>
              {session.name}
              {#if session.key === suggestedKey}<span class="badge">suggested</span>{/if}
            </span>
            {#if session.lastDoneDate}<span class="last">last {session.lastDoneDate}</span>{/if}
            <IconChevronDown class="chevron {isOpen ? 'open' : ''}" />
          </button>
          {#if isOpen}
            <div class="session-summary" id={`override-summary-${planSlug}-${session.key}`}>
              {#if session.note}
                <p class="muted">{session.note}</p>
              {/if}
              {#each session.blocks as block (block.key)}
                <div class="block-summary">
                  <h3>{block.name}</h3>
                  <p>{block.exercises.join(", ")}</p>
                </div>
              {/each}
              <a class="session-link" href={`/plan/${planSlug}/session/${session.key}`}>
                <IconPlay />Start session
              </a>
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    {#if dropOrder && dropOrder.length > 0}
      <p class="rule">If a session has to be dropped, in this order: {dropOrder.join(", ")}.</p>
    {/if}
    {#if schedulingRules && schedulingRules.length > 0}
      <p class="muted rules-label">The plan's own scheduling notes:</p>
      <ul class="rules">
        {#each schedulingRules as rule (rule)}<li>{rule}</li>{/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1.25rem;
    margin-top: 1.25rem;
  }
  .list-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
    border-radius: var(--r-sm);
    padding: 0.7rem 1.25rem;
    font-weight: 700;
  }
  .list-toggle :global(.chevron) {
    flex-shrink: 0;
    transition: transform 0.15s ease;
  }
  .list-toggle :global(.chevron.open) {
    transform: rotate(180deg);
  }
  .sessions {
    list-style: none;
    margin: 0.9rem 0 0.75rem;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }
  .sessions .key {
    display: inline-block;
    min-width: 1.6em;
    font-weight: 800;
  }
  .session-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
    border-radius: var(--r-sm);
    padding: 0.7rem 1.25rem;
  }
  .session-name {
    flex: 1;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .badge {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--accent);
    background: var(--accent-soft);
    border-radius: var(--r-xs);
    padding: 0.1rem 0.35rem;
  }
  .last {
    font-size: 0.8rem;
    color: var(--muted);
    white-space: nowrap;
  }
  .session-toggle :global(.chevron) {
    flex-shrink: 0;
    transition: transform 0.15s ease;
  }
  .session-toggle :global(.chevron.open) {
    transform: rotate(180deg);
  }
  .session-summary {
    padding: 0.85rem 1rem 0.25rem;
    display: grid;
    gap: 0.6rem;
  }
  .block-summary h3 {
    margin: 0 0 0.15rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .block-summary p {
    margin: 0;
    font-size: 0.9rem;
  }
  .session-link {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.7rem 1.25rem;
    border-radius: var(--r-sm);
    background: var(--accent);
    color: var(--accent-in);
    font-weight: 700;
  }
  .session-link:hover {
    text-decoration: none;
  }
  .muted {
    color: var(--muted);
    font-size: 0.9rem;
    margin: 0 0 0.5rem;
  }
  .rule {
    margin: 0.5rem 0 0;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .rules-label {
    margin-top: 0.75rem;
  }
  .rules {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.85rem;
    color: var(--muted);
    display: grid;
    gap: 0.3rem;
  }
</style>
```

- [ ] **Step 2: Typecheck and check**

Run: `npx tsc --noEmit -p tsconfig.json && npm run check`
Expected: no errors.

- [ ] **Step 3: Format and commit**

```bash
npx prettier --write src/routes/SessionOverrideList.svelte
git add src/routes/SessionOverrideList.svelte
git commit -m "feat(home): add SessionOverrideList"
```

---

### Task 10: `ActivityStrip.svelte` and `ActivitySheet.svelte`

**Files:**
- Create: `src/routes/ActivitySheet.svelte`
- Create: `src/routes/ActivityStrip.svelte`

**Interfaces:**
- Consumes: `slugifyActivityKind` (task 2), `occurredAtMsFor`/`ActivityWhen` (task 3), `newOpId` (`$lib/sync/ops`, exists), `logWrite` (`$lib/sync/client.svelte`, exists), `trapFocus` (`$lib/actions/focus-trap`, exists).
- Produces: `ActivityStrip` takes `kinds: readonly string[]` and renders chips + an "New" control; tapping either opens `ActivitySheet`, which takes `initialKind: string | undefined`, `onClose`, `onLogged`.

- [ ] **Step 1: Implement `ActivitySheet.svelte`**

Create `src/routes/ActivitySheet.svelte`:

```svelte
<script lang="ts">
  import { trapFocus } from "$lib/actions/focus-trap";
  import { slugifyActivityKind } from "$lib/home/activity-kinds";
  import { occurredAtMsFor, type ActivityWhen } from "$lib/home/activity-when";
  import { newOpId } from "$lib/sync/ops";
  import { logWrite } from "$lib/sync/client.svelte";

  /**
   * The activity log sheet (design spec §5, decision 4): asks duration/intensity/note
   * and *when* before writing, rather than one tap that writes immediately and is
   * edited afterwards — the op carries its full payload at write time, so there is no
   * edit window to explain and no undo to build.
   *
   * `logWrite`'s first argument is a plan slug used only to thread retry state
   * (`$lib/sync/client.svelte.ts` never uses it to address or filter anything) — an
   * activity has no owning plan, so this passes the literal string "home" rather than
   * any real plan's slug.
   */
  let {
    initialKind,
    onClose,
    onLogged,
  }: {
    initialKind: string | undefined;
    onClose: () => void;
    onLogged: (kind: string) => void;
  } = $props();

  let kindInput = $state(initialKind ?? "");
  let when = $state<ActivityWhen>("now");
  let durationMin = $state("");
  let intensity = $state("");
  let note = $state("");
  let submitting = $state(false);
  let error = $state<string | undefined>();

  const slug = $derived(slugifyActivityKind(kindInput));

  async function save(): Promise<void> {
    if (submitting || slug.length === 0) return;
    submitting = true;
    try {
      const occurredAt = new Date(occurredAtMsFor(when, Date.now())).toISOString();
      const minutes = durationMin.trim() === "" ? undefined : Number(durationMin);

      await logWrite("home", {
        kind: "activity",
        id: newOpId(),
        activityKind: slug,
        occurredAt,
        durationMin: minutes !== undefined && Number.isFinite(minutes) ? minutes : undefined,
        intensity: intensity.trim() || undefined,
        note: note.trim() || undefined,
      });

      onLogged(slug);
    } catch (err) {
      error = err instanceof Error ? err.message : "Something went wrong.";
    } finally {
      submitting = false;
    }
  }
</script>

<div class="sheet-backdrop" onclick={onClose} role="presentation">
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-labelledby="activity-heading"
    onclick={(e) => e.stopPropagation()}
    use:trapFocus={{ onEscape: onClose }}
  >
    <h3 id="activity-heading" tabindex="-1" data-trap-focus-heading>Log activity</h3>

    {#if initialKind === undefined}
      <label>
        What did you do?
        <input type="text" bind:value={kindInput} placeholder="e.g. squash" />
      </label>
    {:else}
      <p class="kind-label">{initialKind}</p>
    {/if}

    <div class="when-row">
      <label><input type="radio" name="when" value="now" bind:group={when} /> Now</label>
      <label
        ><input type="radio" name="when" value="earlier_today" bind:group={when} /> Earlier today</label
      >
      <label><input type="radio" name="when" value="yesterday" bind:group={when} /> Yesterday</label>
    </div>

    <div class="row2">
      <label>
        Duration (min)
        <input type="text" inputmode="numeric" bind:value={durationMin} placeholder="Optional" />
      </label>
      <label>
        Intensity
        <input type="text" bind:value={intensity} placeholder="e.g. hard" />
      </label>
    </div>

    <label>
      Note
      <textarea bind:value={note} placeholder="Optional"></textarea>
    </label>

    {#if error}<p class="error">{error}</p>{/if}

    <div class="sheet-actions">
      <button type="button" class="secondary" onclick={onClose}>Cancel</button>
      <button type="button" class="primary" disabled={submitting || slug.length === 0} onclick={save}>
        Log it
      </button>
    </div>
  </div>
</div>

<style>
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-end;
    z-index: 60;
  }
  .sheet {
    width: 100%;
    max-height: 90dvh;
    overflow-y: auto;
    background: var(--surface);
    border-top-left-radius: var(--r-lg);
    border-top-right-radius: var(--r-lg);
    padding: 1.25rem;
    padding-bottom: calc(1.25rem + env(safe-area-inset-bottom));
    display: grid;
    gap: 0.75rem;
  }
  label {
    display: grid;
    gap: 0.25rem;
    font-size: 0.9rem;
    color: var(--muted);
    min-width: 0;
  }
  .kind-label {
    margin: 0;
    font-weight: 700;
    color: var(--text);
    text-transform: capitalize;
  }
  .when-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    font-size: 0.85rem;
  }
  .when-row label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 2.75rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--line);
    border-radius: var(--r-xs);
    background: var(--raised);
    color: var(--text);
  }
  .row2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    min-width: 0;
  }
  input,
  textarea {
    width: 100%;
    min-height: 2.75rem;
    padding: 0.6rem;
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
  }
  .error {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0;
  }
  .sheet-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
  }
  .sheet-actions button {
    border: none;
    border-radius: var(--r-sm);
    padding: 0.7rem 1.25rem;
    font-weight: 700;
  }
  .primary {
    background: var(--accent);
    color: var(--accent-in);
  }
  .primary:disabled {
    opacity: 0.45;
  }
  .secondary {
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
  }
</style>
```

- [ ] **Step 2: Implement `ActivityStrip.svelte`**

Create `src/routes/ActivityStrip.svelte`:

```svelte
<script lang="ts">
  import IconActivity from "~icons/lucide/activity";
  import IconPlus from "~icons/lucide/plus";
  import ActivitySheet from "./ActivitySheet.svelte";

  /**
   * Log activity that is not part of the plan (ARCHITECTURE §9, "Home"): one-tap
   * buttons for kinds already used, plus rest, plus a way to type a new one. GAIN
   * ships no list of sports.
   */
  let { kinds }: { kinds: readonly string[] } = $props();

  // `""` (not null) opens the sheet in "new kind" mode — distinct from "closed".
  let openKind = $state<string | null>(null);

  function log(kind: string): void {
    // No local reordering: the next full page load re-derives `kinds` from fresh data
    // via `suggestActivityKinds` — same as the rest of this route's writes, which don't
    // re-run `load` after a write either.
    openKind = null;
    void kind;
  }
</script>

<section class="card activity-strip">
  <h2><IconActivity />Log activity</h2>
  <div class="chips">
    {#each kinds as kind (kind)}
      <button type="button" class="chip" onclick={() => (openKind = kind)}>{kind}</button>
    {/each}
    <button type="button" class="chip chip-add" onclick={() => (openKind = "")}>
      <IconPlus />New
    </button>
  </div>
</section>

{#if openKind !== null}
  <ActivitySheet
    initialKind={openKind === "" ? undefined : openKind}
    onClose={() => (openKind = null)}
    onLogged={log}
  />
{/if}

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1.25rem;
    margin-top: 1.25rem;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.05rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 2.75rem;
    padding: 0.5rem 0.9rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font-weight: 600;
    text-transform: capitalize;
  }
  .chip-add {
    color: var(--accent);
    border-color: var(--accent-soft);
    text-transform: none;
  }
</style>
```

Note the deliberately empty `log(kind)` body beyond closing the sheet: `onLogged` exists so a future confirmation toast has somewhere to hook in, but nothing in this phase's spec asks for one (the sheet closing is the confirmation), so do not add one — YAGNI.

- [ ] **Step 3: Typecheck and check**

Run: `npx tsc --noEmit -p tsconfig.json && npm run check`
Expected: no errors. `ActivitySheet`'s `logWrite` call constructs an object literal for the `activity` op — if `npm run typecheck` reports a type error here, it means task 5's `ActivityOp` union member is not yet visible to this file; re-run `npx tsc --noEmit -p tsconfig.json` after confirming task 5 is committed.

- [ ] **Step 4: Format and commit**

```bash
npx prettier --write src/routes/ActivitySheet.svelte src/routes/ActivityStrip.svelte
git add src/routes/ActivitySheet.svelte src/routes/ActivityStrip.svelte
git commit -m "feat(home): add activity logging — chips, sheet, and the write"
```

---

### Task 11: `NextMorningPrompt.svelte`

**Files:**
- Create: `src/routes/NextMorningPrompt.svelte`

**Interfaces:**
- Consumes: `MetricRow` (`$lib/components/MetricRow.svelte`, task 7), `MetricDef` (`$lib/contract/schema`).
- Produces: a `.next-morning` card taking `planSlug`, `sessionKey`, `workoutClientId`, `metrics: readonly MetricDef[]`, `onDismiss: (workoutClientId: string) => void`. Task 13 renders one per due candidate and supplies `onDismiss`.

- [ ] **Step 1: Implement**

Create `src/routes/NextMorningPrompt.svelte`:

```svelte
<script lang="ts">
  import type { MetricDef } from "$lib/contract/schema";
  import MetricRow from "$lib/components/MetricRow.svelte";
  import IconSunrise from "~icons/lucide/sunrise";
  import IconX from "~icons/lucide/x";

  /**
   * The next_morning metric prompt (ARCHITECTURE §9, "Post-session"; design spec §6).
   * Reuses `MetricRow` verbatim rather than re-implementing metric rendering — every
   * metric here is session-scope, exactly what `MetricRow` already expects.
   */
  let {
    planSlug,
    sessionKey,
    workoutClientId,
    metrics,
    onDismiss,
  }: {
    planSlug: string;
    sessionKey: string;
    workoutClientId: string;
    metrics: readonly MetricDef[];
    onDismiss: (workoutClientId: string) => void;
  } = $props();

  let selected = $state<Record<string, number | string>>({});
  let error = $state<string | undefined>();

  function onSelected(key: string, value: number | string): void {
    selected = { ...selected, [key]: value };
    if (metrics.every((m) => selected[m.key] !== undefined)) onDismiss(workoutClientId);
  }
</script>

<section class="card next-morning">
  <div class="head">
    <h2><IconSunrise />How did yesterday's {sessionKey} feel this morning?</h2>
    <button
      type="button"
      class="dismiss-btn"
      aria-label="Dismiss"
      onclick={() => onDismiss(workoutClientId)}
    >
      <IconX />
    </button>
  </div>
  {#each metrics as metric (metric.key)}
    <MetricRow
      {metric}
      {planSlug}
      {workoutClientId}
      selected={selected[metric.key]}
      onSelected={(value) => onSelected(metric.key, value)}
      onError={(message) => (error = message)}
    />
  {/each}
  {#if error}<p class="error">{error}</p>{/if}
</section>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1.25rem;
    margin-top: 1.25rem;
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .dismiss-btn {
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: var(--muted);
    padding: 0.3rem;
    min-width: 2.75rem;
    min-height: 2.75rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .error {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0.5rem 0 0;
  }
</style>
```

- [ ] **Step 2: Typecheck and check**

Run: `npx tsc --noEmit -p tsconfig.json && npm run check`
Expected: no errors.

- [ ] **Step 3: Format and commit**

```bash
npx prettier --write src/routes/NextMorningPrompt.svelte
git add src/routes/NextMorningPrompt.svelte
git commit -m "feat(home): add NextMorningPrompt"
```

---

### Task 12: Wire `+page.server.ts`

**Files:**
- Modify: `src/routes/+page.server.ts`
- Modify: `tests/server/first-run.test.ts`

**Interfaces:**
- Consumes: `suggestNextSession` (task 1), `suggestActivityKinds` (task 2), `recentWorkoutsForPlan`/`recentActivities`/`nextMorningCandidates` (task 6).
- Produces: `load`'s `"plan"` view now returns, per plan, `suggestion: NextSessionSuggestion`, `sessions[].lastDoneDate`, `schedulingRules`, `dropOrder`; and top-level `activityKinds: string[]`, `nextMorningCandidates: NextMorningCandidate[]`. Task 13's `+page.svelte` consumes all of it via `PageData`.

- [ ] **Step 1: Write the failing test**

In `tests/server/first-run.test.ts`, add inside `describe("importing the reference plan", ...)`, after the existing `"shows the plan once committed"` test:

```ts
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/server/first-run.test.ts`
Expected: fails — `data.plans[0].suggestion` is `undefined`, `data.activityKinds` is `undefined`.

- [ ] **Step 3: Implement**

In `src/routes/+page.server.ts`, add imports:

```ts
import { recentActivities, recentWorkoutsForPlan, nextMorningCandidates } from "$lib/db/home";
import { suggestActivityKinds } from "$lib/home/activity-kinds";
import { suggestNextSession } from "$lib/home/next-session";
```

Replace the `load` function's `"plan"`-view branch (everything from `const overviews = plans.flatMap(...)` through the `return { view: "plan" as const, ... }`) with:

```ts
  const overviews = plans.flatMap((plan) => {
    const current = getCurrentVersion(userDb, plan.id);
    if (!current) return [];
    const contract = contractOfVersion(current);

    const recentWorkouts = recentWorkoutsForPlan(userDb, plan.id);
    const suggestion = suggestNextSession(
      contract.sessions.map((s) => ({ key: s.key, order: s.order })),
      contract.scheduling?.sequence,
      recentWorkouts,
    );
    const lastDoneByKey = new Map(suggestion.overrides.map((o) => [o.key, o.lastDoneDate]));

    return [
      {
        slug: plan.slug,
        name: plan.name,
        version_no: current.version_no,
        imported_at: current.imported_at.slice(0, 10),
        suggestion,
        schedulingRules: contract.scheduling?.rules,
        dropOrder: contract.scheduling?.drop_order,
        sessions: contract.sessions
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((session) => ({
            key: session.key,
            name: session.name,
            note: session.note,
            lastDoneDate: lastDoneByKey.get(session.key),
            blocks: session.blocks.map((block) => ({
              key: block.key,
              name: block.name,
              exercises: block.exercises.map((rx) => exerciseName(contract, rx.id)),
            })),
          })),
        counts: {
          sessions: contract.sessions.length,
          exercises: contract.exercises.length,
          prescriptions: countPrescriptions(contract),
        },
      },
    ];
  });

  return {
    view: "plan" as const,
    plans: overviews,
    displayName: user.displayName,
    activityKinds: suggestActivityKinds(recentActivities(userDb)),
    nextMorningCandidates: nextMorningCandidates(userDb, new Date()),
  };
};
```

(This replaces the loop body and the final `return` of the existing `load` function — everything above it, including the `if (plans.length === 0)` early return and the `getUserDbFor`/`listPlans` setup, is unchanged.)

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/server/first-run.test.ts`
Expected: all pass, including every pre-existing test in the file (the existing `"shows the plan once committed"` test asserts `data.plans[0].counts` — confirm that assertion still passes unchanged, since `counts` is untouched).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. `+page.svelte` (not yet updated — task 13) will now fail `npm run check` because it destructures `data.plans[].sessions[].blocks` in a shape that still matches (this task adds fields, it does not remove or rename any the current template reads), so `npm run check` should still pass at this point too; if it does not, the mismatch is between this task's output shape and the current template, not a bug in this task.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write src/routes/+page.server.ts tests/server/first-run.test.ts
git add src/routes/+page.server.ts tests/server/first-run.test.ts
git commit -m "feat(home): wire the suggestion, activity kinds and next-morning candidates into load"
```

---

### Task 13: Rework `+page.svelte`

**Files:**
- Modify: `src/routes/+page.svelte`

**Interfaces:**
- Consumes: `NextSessionCard` (8), `SessionOverrideList` (9), `ActivityStrip` (10), `NextMorningPrompt` (11), `dueNextMorningPrompts` (4), `startSyncLoop` (`$lib/sync/client.svelte`, exists), the new `PageData` shape (12).
- Produces: the reworked today screen. This is the last piece task 14's e2e spec drives.

- [ ] **Step 1: Update the script block**

In `src/routes/+page.svelte`, add to the top of the `<script>` block's imports:

```ts
import NextSessionCard from "./NextSessionCard.svelte";
import SessionOverrideList from "./SessionOverrideList.svelte";
import ActivityStrip from "./ActivityStrip.svelte";
import NextMorningPrompt from "./NextMorningPrompt.svelte";
import { dueNextMorningPrompts } from "$lib/home/next-morning";
import { startSyncLoop } from "$lib/sync/client.svelte";
```

Remove the now-unused `IconChevronDown` and `IconPlay` imports (their only uses — the session accordion — moved into `SessionOverrideList.svelte` in task 9). Keep `IconCheck`, `IconCircleCheck`, `IconCopy`, `IconDownload`, `IconExternalLink`, `IconSparkles` — all still used by the first-run and import flows below.

Remove the `openSession`/`toggleSession` state and function (moved into `SessionOverrideList.svelte`).

Add, near the other `$state` declarations:

```ts
// The next-morning prompt's dismissal is local and permanent for that workout (design
// spec §6) — not synced, and not re-derived from server data, so a dismissal survives
// even if the answer op never syncs.
const DISMISS_KEY = "gain:next-morning-dismissed";

function readDismissed(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

let dismissed = $state<string[]>(untrack(() => readDismissed()));

function dismissNextMorning(workoutClientId: string): void {
  if (dismissed.includes(workoutClientId)) return;
  dismissed = [...dismissed, workoutClientId];
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(dismissed));
  }
}

// `nowMs` is read only after mount (never at module/SSR eval time), so the server-
// rendered markup never has to agree with a client-only clock — the next-morning
// card simply does not render until this effect has run once.
let nowMs = $state<number | undefined>(undefined);

$effect(() => {
  nowMs = Date.now();
  const onVisible = () => {
    if (document.visibilityState === "visible") nowMs = Date.now();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => document.removeEventListener("visibilitychange", onVisible);
});

const dueNextMorning = $derived(
  nowMs === undefined || data.view !== "plan"
    ? []
    : dueNextMorningPrompts(data.nextMorningCandidates, nowMs, dismissed),
);

// Activities have no owning plan (design spec §5) and this route otherwise never
// registers the reconnect/visibility listeners `startSyncLoop` provides (only the
// session runner does today) — without this, an activity op queued while offline
// would only retry via its own internal backoff timer, never immediately on
// reconnect. "home" is inert here for the same reason ActivitySheet's logWrite call
// is: `$lib/sync/client.svelte.ts` never uses this argument to address or filter
// anything.
$effect(() => startSyncLoop("home"));
```

- [ ] **Step 2: Rework the `{:else}` (plan view) markup**

Replace the entire `{:else} ... {/if}` block that currently renders `data.plans` (the block containing `{#each data.plans as plan (plan.slug)} <section class="card"> ... {/each}` and the accordion) with:

```svelte
{:else}
  {#each dueNextMorning as candidate (candidate.workoutClientId)}
    <NextMorningPrompt
      planSlug={candidate.planSlug}
      sessionKey={candidate.sessionKey}
      workoutClientId={candidate.workoutClientId}
      metrics={candidate.metrics}
      onDismiss={dismissNextMorning}
    />
  {/each}

  {#each data.plans as plan (plan.slug)}
    <NextSessionCard
      planSlug={plan.slug}
      planName={plan.name}
      suggestedKey={plan.suggestion.suggestedKey}
      lastSession={plan.suggestion.lastSession}
      sessions={plan.sessions}
    />
  {/each}

  <ActivityStrip kinds={data.activityKinds} />

  {#each data.plans as plan (plan.slug)}
    <SessionOverrideList
      planSlug={plan.slug}
      suggestedKey={plan.suggestion.suggestedKey}
      sessions={plan.sessions}
      schedulingRules={plan.schedulingRules}
      dropOrder={plan.dropOrder}
    />
    <section class="card plan-admin">
      <h2>{plan.name}</h2>
      <p class="muted">
        version {plan.version_no} · imported {plan.imported_at} ·
        {plan.counts.sessions} sessions, {plan.counts.exercises} exercises,
        {plan.counts.prescriptions} prescriptions
      </p>
      <a class="export-link" href={`/plan/${plan.slug}/export`}>
        <IconExternalLink />Export for review
      </a>
    </section>
  {/each}

  <section class="card">
    <h2>Import a plan</h2>
    <p class="muted">
      Paste a new plan or a revised version. GAIN checks it and shows what would change before
      writing anything.
    </p>
    <form method="POST" action="?/import" use:enhance>
      <textarea
        class="doc"
        name="source_md"
        rows="10"
        placeholder="Paste the plan document here…"
        bind:value={pasted}></textarea>
      <div class="actions">
        <button type="submit" class="primary" disabled={!pasted.trim()}>
          <IconCheck />Check the plan
        </button>
      </div>
    </form>
  </section>
{/if}
```

The `$effect` that calls `precacheSessions` (reads `data.plans`) stays as it is — it does not reference the removed accordion state.

- [ ] **Step 3: Remove the relocated styles**

From the `<style>` block, remove the rules that only ever styled the removed accordion markup: `.sessions`, `.sessions .key`, `.session-toggle`, `.session-name`, `.session-toggle :global(.chevron)`, `.session-toggle :global(.chevron.open)`, `.session-summary`, `.block-summary h3`, `.block-summary p`, `.session-link`, `.session-link:hover`. Keep `.card`, `.hero`, `.muted`, `.questions`, `.row2`, `input`, `.doc`, `.actions`, `button`/`.primary`/`.primary:disabled`/`.secondary`, `.export-link`, `.export-link:hover`, `.report-card`, `.report` — all still used by the first-run flow, the import forms, and the new `.plan-admin` section reusing `.card`/`.muted`/`.export-link`.

- [ ] **Step 4: Manual check in the browser**

Run: `GAIN_DEV_USER=you npm run dev`, sign in via the bypass, and visually confirm: with no plan, first-run is unchanged; after importing the fixture (paste `fixtures/plans/home-training-v1.md`), Home shows a suggested-session card reading "A" (no history yet), an activity strip with at least a "rest" chip and a "New" chip, a collapsed "Choose a different session" list, and the plan admin block with the export link.

- [ ] **Step 5: Typecheck and check**

Run: `npx tsc --noEmit -p tsconfig.json && npm run check`
Expected: no errors.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write src/routes/+page.svelte
git add src/routes/+page.svelte
git commit -m "feat(home): rework the front door into the today screen"
```

---

### Task 14: End-to-end proof

**Files:**
- Modify: `e2e/helpers.ts`
- Create: `e2e/home-walkthrough.spec.ts`

**Interfaces:**
- Consumes: `E2E_PLAN_SLUG`, `dismissPreSessionPrompt`, `finishSession`, `seededDataDir`, `openSeededUserDb` (all exist), `assertNoHorizontalOverflow` (exists).
- Produces: `activitiesOf(): { kind: string; occurred_at: string }[]` in `e2e/helpers.ts`.

The next-morning scenario needs a workout whose `completed_at` lands on a real "yesterday" relative to when the assertion runs — read-only DB access (`openSeededUserDb`) is deliberately not writable (see its own doc comment: "a test that can write to the app's database can make its own assertions come true"), so the correct tool is Playwright's `page.clock`, which fakes the *browser's* `Date` (and therefore `finishedAt`, which the client stamps — `src/lib/sync/ops.ts`'s doc comment: "the client's clock") without touching the server process or the database directly.

- [ ] **Step 1: Add the `activitiesOf` helper**

In `e2e/helpers.ts`, add near `setLogsOf`:

```ts
export type ActivityRow = { kind: string; occurred_at: string };

/** Every logged activity, most-recent-first — mirrors `setLogsOf`'s direct-read shape. */
export function activitiesOf(): ActivityRow[] {
  const db = openSeededUserDb(seededDataDir());
  try {
    return db.prepare("SELECT kind, occurred_at FROM activity ORDER BY occurred_at DESC").all() as ActivityRow[];
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: Write the spec**

Create `e2e/home-walkthrough.spec.ts`:

```ts
/**
 * Phase 7a's "done when" (docs/superpowers/specs/2026-08-15-phase-7a-home-design.md):
 * Home suggests the right next session, an activity can be logged, and a finished
 * workout gets exactly one next-morning prompt, the following day, never again once
 * answered.
 *
 * `test.use({ timezoneId: "UTC" })` makes the fake-clock arithmetic below exact: both
 * the workout's `completed_at` and the "yesterday" it is compared against are pinned to
 * noon UTC, so no local offset can push either across a date boundary.
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth setup here.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import {
  activitiesOf,
  assertNoHorizontalOverflow,
  dismissPreSessionPrompt,
  finishSession,
} from "./helpers";

test.use({ timezoneId: "UTC" });

test("home suggests the next session, logs an activity, and asks the next-morning prompt once", async ({
  page,
}) => {
  test.setTimeout(60_000);

  const realNow = new Date();
  const yesterdayNoon = new Date(realNow);
  yesterdayNoon.setUTCDate(realNow.getUTCDate() - 1);
  yesterdayNoon.setUTCHours(12, 0, 0, 0);

  // Finish session A under a clock fixed to yesterday, so the workout's completed_at
  // (the client's own clock, ops.ts) lands on a date the next-morning prompt can
  // recognise as "yesterday" once the clock is restored below. Ending immediately
  // (rather than logging every set) is enough — nothing here is testing the runner.
  await page.clock.setFixedTime(yesterdayNoon);
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();
  await page.getByRole("button", { name: "End session" }).click();
  await finishSession(page);
  await expect(page).toHaveURL(/\/$/);

  // Restore the real clock — "yesterday" only means anything relative to today — and
  // reload so both the server load and the client's next-morning windowing see it.
  await page.clock.setFixedTime(new Date());
  await page.reload();

  // --- Suggested next session: A was just done, B is next in [A, B, C, D]. ---
  await expect(page.locator(".next-session .key")).toHaveText("B");

  // --- Next-morning prompt: due, answerable once, then gone for good. ---
  await expect(page.locator(".next-morning")).toBeVisible();
  await page.locator(".next-morning .scale-cell").first().click();
  await expect(page.locator(".next-morning")).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".next-morning")).toHaveCount(0);

  // --- Activity logging: a new kind, submitted through the sheet. ---
  await page.locator(".activity-strip .chip-add").click();
  await page.getByPlaceholder("e.g. squash").fill("Squash");
  await page.getByRole("button", { name: "Log it" }).click();
  await expect(page.locator(".sheet-backdrop")).toHaveCount(0);

  const activities = activitiesOf();
  expect(activities.some((a) => a.kind === "squash")).toBe(true);

  await page.reload();
  await expect(page.locator(".activity-strip .chip", { hasText: "squash" })).toBeVisible();

  await assertNoHorizontalOverflow(page);
});
```

- [ ] **Step 3: Run the spec**

Run: `npx playwright test --project=iphone e2e/home-walkthrough.spec.ts`
Expected: passes. If `.next-session .key` never reaches "B", check task 12's `suggestNextSession` call passed `contract.scheduling?.sequence` (not `undefined`) — the fixture's sequence is `[A, B, C, D]`. If `.next-morning` never appears, check the workout actually wrote a `completed_at` under the faked clock (`SELECT completed_at FROM workout` via a throwaway script against `seededDataDir()`) rather than the real one — a common mistake is calling `page.clock.setFixedTime` after `page.goto` instead of before, which misses the module-load-time `Date` some code paths might cache (none do here, but set it before `goto` regardless, as written above).

Run: `npx playwright test --project=small-android --project=tablet-portrait e2e/home-walkthrough.spec.ts`
Expected: passes at all three viewports (UI-DECISIONS §12).

- [ ] **Step 4: Format and commit**

```bash
npx prettier --write e2e/helpers.ts e2e/home-walkthrough.spec.ts
git add e2e/helpers.ts e2e/home-walkthrough.spec.ts
git commit -m "test(e2e): add the home walkthrough — suggestion, activity, next-morning"
```

---

### Task 15: Documentation close-out

**Files:**
- Modify: `docs/ROADMAP.md`

**Interfaces:** none — a documentation-only task.

Phase 7a is half of ROADMAP's phase 7 (the other half — progress, charts, history — is a separate plan). Do **not** update README's status banner or CLAUDE.md's "Current state" paragraph: both describe whole-phase completion, and phase 7 is not done until the second half lands. This task only ticks the three items 7a actually closes.

- [ ] **Step 1: Gather the commit SHAs**

Run: `git log --oneline -20`
Note the short SHAs of the commits from tasks 1–14 (each task's commit message starts with `feat(home)`, `feat(sync)`, `refactor(session)`, or `test(e2e)`).

- [ ] **Step 2: Edit `docs/ROADMAP.md`**

In the "Phase 7 — Progress, history & the Home screen" section, change these three lines from `- [ ]` to `- [x]` and append the gathered SHAs, following the exact citation style already used elsewhere in this file (see the "Phase 5 — Export" section above it for the pattern: one or more `` `shortsha` `` right after the file(s) that closed the item):

```markdown
- [x] **Home: the suggested next session**, from `scheduling.sequence`, with any session
      selectable as an override. `src/lib/home/next-session.ts`, `src/routes/+page.server.ts`
      (`<sha1>`, `<sha2>`).
- [x] **Home: one-tap activity logging.** `src/lib/db/workout.ts`'s `logActivity`, the
      sync outbox's sixth op kind, `src/routes/ActivityStrip.svelte` and
      `ActivitySheet.svelte` (`<sha3>`, `<sha4>`).
- [x] **The `next_morning` metric prompt on next app open.**
      `src/lib/home/next-morning.ts`, `src/routes/NextMorningPrompt.svelte` (`<sha5>`).
```

Replace `<sha1>`…`<sha5>` with the real short SHAs from Step 1 — do not leave placeholders in the committed file.

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): tick phase 7a's three items"
```

---

## Final verification

- [ ] Run `npm run verify` from the repo root. Expected: passes clean (typecheck, `svelte-check`, lint, format check, `npm test`, build).
- [ ] Run `npx playwright test --project=iphone` (the full suite at one viewport) to confirm task 14's new spec did not regress any existing session-runner or export spec.
- [ ] Confirm `git log --oneline` shows one commit per task, in order, nothing squashed and nothing left uncommitted (`git status` clean).
