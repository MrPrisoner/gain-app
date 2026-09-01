# Lazy Session Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the session runner from creating a `workout` row for a session someone only opened to look at — nothing about a workout is persisted until the first workout-scoped write.

**Architecture:** Opening the runner mints the workout's `client_id`, a fully-built `start` op and `startedAt` in memory, and persists none of them. It *arms* the start op with `$lib/sync/client.svelte`. The first op carrying that `workoutClientId` to reach `logWrite` drags the armed start into the outbox ahead of itself and writes the `localStorage` resume key. A one-shot migration deletes the peek rows already in users' databases.

**Tech Stack:** TypeScript, SvelteKit (Svelte 5 runes), better-sqlite3, Zod 4, Vitest 4, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-01-lazy-session-start-design.md`](../specs/2026-09-01-lazy-session-start-design.md)

## Global Constraints

- **Runes mode only.** `$state`, `$derived`, `$props`, `$effect`. There is not one `export let` or `createEventDispatcher` in `src/`. Do not write one.
- **Zod 4 spelling** if you touch a schema: `z.strictObject`, `z.looseObject`, `error:` — never `z.object().strict()` or `message:`.
- **Never write a literal control character.** Write the escape — the six characters backslash, u, 0, 0, 0, 0. Enforced by `npm run check:chars` and the `gain/no-control-characters` ESLint rule.
- **`npm run verify` is the contract.** Run it before calling any task done. It short-circuits, so a lint failure means the tests never ran.
- **Run `npx prettier --write <file>` after editing a TypeScript or Svelte file** if the Claude Code PostToolUse hook is not running for you. `docs/`, `fixtures/` and `templates/` are prettier-ignored — never format those.
- **`client.svelte.ts` cannot be unit-tested.** `vitest.config.ts` runs without the Svelte plugin (`environment: "node"`), so a module using `$state` cannot be imported by a test. Nothing in `tests/` imports it today. **Every rule worth testing therefore lives in the pure module `src/lib/sync/deferred-start.ts`**; `client.svelte.ts` gets only the thinnest possible wiring, covered by the e2e suite. This is the same split as `queue.ts` (rules) / `idb.ts` (store).
- **Commit messages:** `type(scope): imperative summary`, lowercase, no trailing period, reading as a complete sentence alone. Body is prose paragraphs, not bullets. Close with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` — the model name, then exactly one angle-bracket group.
- **Playwright reports a clip-rect-hidden element as visible** (a 1px box is still a box). Assert with `toBeAttached()` plus a `boundingBox()` check, never `not.toBeVisible()`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/sync/deferred-start.ts` | **Create.** Pure: given the armed start op and an incoming op, decide what to append and in what order. |
| `tests/sync/deferred-start.test.ts` | **Create.** Unit tests for the above. |
| `src/lib/sync/client.svelte.ts` | **Modify.** Hold the armed start in module state; `armDeferredStart`, `disarmDeferredStart`; `logWrite` consults the pure rule. |
| `src/routes/plan/[slug]/session/[key]/+page.svelte` | **Modify.** Mount arms instead of writing. Effect cleanup disarms. |
| `src/lib/db/schema.ts` | **Modify.** Add `MIGRATION_003` and its `MIGRATIONS` entry. |
| `tests/db/peek-cleanup.test.ts` | **Create.** The migration's SQL, run against real rows. |
| `e2e/env.ts` | **Modify.** Add `peekDevUserFor`. |
| `e2e/peek-session.spec.ts` | **Create.** Peeking persists nothing, and does not move Home's rotation cursor or the export's Adherence table. |
| `e2e/offline-peek.spec.ts` | **Create.** Peeking offline queues nothing, and reconnecting syncs nothing. |
| `docs/UI.md`, `docs/ARCHITECTURE.md` | **Modify.** Fold the durable half in. |
| `docs/todo-discard-session.md`, the spec, this plan | **Delete** in the final task. |

---

## Task 1: The deferred-start rule

**Files:**

- Create: `src/lib/sync/deferred-start.ts`
- Test: `tests/sync/deferred-start.test.ts`

**Interfaces:**

- Consumes: `StartOp`, `SyncOp` from `src/lib/sync/ops.ts`.
- Produces: `resolveWrite(deferred: StartOp | undefined, op: SyncOp): { ops: SyncOp[]; consumed: boolean }`. Task 2 calls this from `logWrite`.

**Why a pure module and not a few lines inside `logWrite`:** see Global Constraints — `client.svelte.ts` is unreachable from Vitest, so anything expressed there is untested by construction.

- [ ] **Step 1: Write the failing test**

Create `tests/sync/deferred-start.test.ts`:

```ts
/**
 * The rule that holds a workout's `start` op back until the workout is actually written
 * to. Pure, so it is testable without a browser — `client.svelte.ts` holds only the
 * armed op and cannot be imported by a test at all (`vitest.config.ts` runs without the
 * Svelte plugin).
 */

import { describe, expect, it } from "vitest";
import { resolveWrite } from "../../src/lib/sync/deferred-start";
import type { StartOp, SyncOp } from "../../src/lib/sync/ops";

const WORKOUT = "01JZ000000000000000000000W";
const OTHER_WORKOUT = "01JZ000000000000000000000X";

const startOp: StartOp = {
  kind: "start",
  id: "01JZ00000000000000000000AA",
  workoutClientId: WORKOUT,
  planVersionId: "pv-1",
  sessionKey: "A",
  startedAt: "2026-09-01T08:00:00.000Z",
};

function setOp(id: string, workoutClientId = WORKOUT): SyncOp {
  return {
    kind: "set",
    id,
    workoutClientId,
    exerciseSlug: "goblet-squat",
    setNo: 1,
    reps: 12,
    difficulty: "medium",
  };
}

const activityOp: SyncOp = {
  kind: "activity",
  id: "01JZ00000000000000000000ZZ",
  activityKind: "walk",
  occurredAt: "2026-09-01T09:00:00.000Z",
};

describe("resolveWrite", () => {
  it("puts the armed start ahead of the op that commits it", () => {
    const result = resolveWrite(startOp, setOp("01JZ00000000000000000000BB"));
    expect(result.ops.map((op) => op.id)).toEqual([
      "01JZ00000000000000000000AA",
      "01JZ00000000000000000000BB",
    ]);
    expect(result.consumed).toBe(true);
  });

  it("emits the start with a lower ULID than the op it precedes", () => {
    const [first, second] = resolveWrite(startOp, setOp("01JZ00000000000000000000BB")).ops;
    expect(first.id < second.id).toBe(true);
  });

  it("passes an op straight through once nothing is armed", () => {
    const result = resolveWrite(undefined, setOp("01JZ00000000000000000000BB"));
    expect(result.ops.map((op) => op.id)).toEqual(["01JZ00000000000000000000BB"]);
    expect(result.consumed).toBe(false);
  });

  it("leaves another workout's armed start alone", () => {
    const result = resolveWrite(startOp, setOp("01JZ00000000000000000000BB", OTHER_WORKOUT));
    expect(result.ops.map((op) => op.id)).toEqual(["01JZ00000000000000000000BB"]);
    expect(result.consumed).toBe(false);
  });

  it("never commits a workout on an op that belongs to no workout", () => {
    // An activity is logged from Home and carries no `workoutClientId` at all. Reading a
    // missing property as a match would start a workout nobody opened.
    const result = resolveWrite(startOp, activityOp);
    expect(result.ops).toEqual([activityOp]);
    expect(result.consumed).toBe(false);
  });

  it("commits on a finish, like every other workout-scoped op", () => {
    // Not a semantic nicety: a finish that reached the server with no workout would
    // resolve nothing, throw `NotYetError`, and retry forever with no start op left in
    // the outbox to rescue it. See the spec, section 3.
    const finish: SyncOp = {
      kind: "finish",
      id: "01JZ00000000000000000000CC",
      workoutClientId: WORKOUT,
      status: "completed",
      finishedAt: "2026-09-01T09:00:00.000Z",
    };
    expect(resolveWrite(startOp, finish).consumed).toBe(true);
  });

  it("commits on a deviation and on a metric", () => {
    const deviation: SyncOp = {
      kind: "deviation",
      id: "01JZ00000000000000000000DD",
      workoutClientId: WORKOUT,
      exerciseSlug: "goblet-squat",
      deviationKind: "skip",
      reasonCode: "time",
    };
    const metric: SyncOp = {
      kind: "metric",
      id: "01JZ00000000000000000000EE",
      workoutClientId: WORKOUT,
      scope: "session",
      metricKey: "energy_before",
      valueNum: 3,
    };
    expect(resolveWrite(startOp, deviation).consumed).toBe(true);
    expect(resolveWrite(startOp, metric).consumed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/sync/deferred-start.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/lib/sync/deferred-start"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/sync/deferred-start.ts`:

```ts
/**
 * When a workout's `start` op actually enters the outbox.
 *
 * Opening the session runner used to write a `start` op on mount, before the user had
 * touched anything, so a session someone opened to *look* at became a `workout` row with
 * `status = 'partial'` — counted as an attempt by `suggestNextSession`'s rotation cursor
 * and as a Partial in the export's Adherence table, which is a wrong claim reaching the
 * reviewing AI. The runner now arms the start op instead, and the first write against
 * that workout drags it into the outbox ahead of itself. UI §2's "effort is the commit
 * action", one level up: effort commits the workout, not only the set.
 *
 * **Every op carrying a `workoutClientId` commits, with no exceptions** — a `finish`
 * included. This is not a judgement about which ops count as real effort: an op that
 * reached the server with no workout behind it would resolve nothing, throw
 * `NotYetError`, and be retried forever with no start op left in the outbox to rescue
 * it. That is the one thing ARCHITECTURE §4 says an op must never be.
 *
 * The op's ULID ordering is the caller's job, not this module's: the start op is minted
 * whole when the runner mounts, so every op created afterwards is automatically higher
 * (ULIDs are monotonic) and `planBatch` sorts the start first however the two were
 * appended. Minting it at commit time instead would sort it *after* the set that
 * triggered it and cost a wasted round trip on every session.
 *
 * Pure, and separate from `client.svelte.ts`, because that module uses `$state` and
 * `vitest.config.ts` runs without the Svelte plugin — a rule expressed there is untested
 * by construction. Same split as `queue.ts` and `idb.ts`.
 */

import type { StartOp, SyncOp } from "./ops";

/** What to append for one write, and whether it consumed the armed start. */
export type ResolvedWrite = {
  /** In append order. The armed start first, where the write commits it. */
  ops: SyncOp[];
  /** True when the caller must now clear the armed start. */
  consumed: boolean;
};

/**
 * Resolve one write against whatever start op is currently armed.
 *
 * An op with no `workoutClientId` at all — an `activity`, logged from Home — can never
 * commit a workout. Reading a missing property as a match would start a workout nobody
 * opened, which is the exact failure this module exists to prevent, arrived at from the
 * other side.
 */
export function resolveWrite(deferred: StartOp | undefined, op: SyncOp): ResolvedWrite {
  if (deferred === undefined) return { ops: [op], consumed: false };
  if (!("workoutClientId" in op)) return { ops: [op], consumed: false };
  if (op.workoutClientId !== deferred.workoutClientId) return { ops: [op], consumed: false };
  return { ops: [deferred, op], consumed: true };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/sync/deferred-start.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full verify**

Run: `npm run verify`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sync/deferred-start.ts tests/sync/deferred-start.test.ts
git commit -m "$(cat <<'EOF'
feat(sync): add the deferred-start rule

The rule that decides when a workout's start op enters the outbox, as a pure
function over the armed op and the incoming one. It lives here rather than
inside logWrite because client.svelte.ts uses $state and vitest runs without
the Svelte plugin, so a rule expressed there could not be tested at all.

Nothing calls it yet. The no-workoutClientId case is the one worth reading
twice: an activity op is logged from Home and carries no workout, and treating
a missing property as a match would start a workout nobody opened.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Arm and consume, in the sync client

**Files:**

- Modify: `src/lib/sync/client.svelte.ts` — the `logWrite` at line 72, plus new module state and two exports.

**Interfaces:**

- Consumes: `resolveWrite` from Task 1.
- Produces: `armDeferredStart(op: StartOp, onCommit: () => void): void` and `disarmDeferredStart(workoutClientId: string): void`. Task 3 calls both.

**No unit test.** See Global Constraints. The behaviour is proved by Task 3's and Task 5's e2e specs; keep this module's share of the logic as close to zero as it can be.

- [ ] **Step 1: Add the module state and the two exports**

In `src/lib/sync/client.svelte.ts`, add the rule import and extend the existing `ops` type import so `StartOp` comes in alongside `SyncOp` — merge the specifier, do not add a second import line for the same module:

```ts
import { resolveWrite } from "./deferred-start";
import type { StartOp, SyncOp } from "./ops";
```

Then, immediately above `logWrite`:

```ts
/**
 * The workout whose `start` op is held back until something is actually written for it,
 * and what to do when that happens. See `$lib/sync/deferred-start` for why.
 *
 * Module state, so it needs an explicit way out of every state it can enter — a lesson
 * this file already paid for once, when a `needs-auth` state had no path back and a
 * queue that hit one 401 stayed stuck after the user signed back in. There are exactly
 * two ways out: `logWrite` consumes it, or the runner disarms it on leaving.
 */
let deferredStart: { op: StartOp; onCommit: () => void } | undefined;

/**
 * Hold this workout's `start` op back until the first write against it. `onCommit` runs
 * at that moment — the runner uses it to write its `localStorage` resume key, which must
 * not exist for a session that was only looked at either: a stale key would make the next
 * visit take the resume path, find nothing on the server and nothing in the outbox, and
 * arm no start at all, so the first set logged would strand forever.
 */
export function armDeferredStart(op: StartOp, onCommit: () => void): void {
  deferredStart = { op, onCommit };
}

/** Drop an armed start that was never committed — the runner was left without a write. */
export function disarmDeferredStart(workoutClientId: string): void {
  if (deferredStart?.op.workoutClientId === workoutClientId) deferredStart = undefined;
}
```

- [ ] **Step 2: Rewrite `logWrite`**

Replace the existing `logWrite` body with:

```ts
export async function logWrite(planSlug: string, op: SyncOp): Promise<void> {
  const armed = deferredStart;
  const { ops, consumed } = resolveWrite(armed?.op, op);
  // Cleared synchronously, before the first `await`: two writes racing in one tick would
  // otherwise both see the armed start and append it twice.
  if (consumed) deferredStart = undefined;

  const outbox = await store();
  for (const next of ops) await outbox.append(next);
  if (consumed) armed?.onCommit();

  await refreshCounts();
  void flushNow(planSlug);
}
```

- [ ] **Step 3: Verify**

Run: `npm run verify`
Expected: exit 0. No test changes — this task's proof arrives in Task 3.

- [ ] **Step 4: Commit**

```bash
git add src/lib/sync/client.svelte.ts
git commit -m "$(cat <<'EOF'
feat(sync): hold a workout's start op until its first write

logWrite now consults the deferred-start rule, so an armed start op enters the
outbox immediately ahead of whatever first writes against that workout. Nothing
arms one yet; the session runner does that in the next commit.

The armed start is cleared synchronously, before the first await, because two
writes racing within one tick would otherwise both see it and append it twice.
It has exactly two ways out — consumed by a write, or disarmed by the runner on
leaving — which this module owes to the 401 that once left needs-auth with no
path back.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: The runner persists nothing on mount

**Files:**

- Modify: `src/routes/plan/[slug]/session/[key]/+page.svelte` — the mount `$effect` at lines ~126-170.
- Modify: `e2e/env.ts` — add `peekDevUserFor`.
- Create: `e2e/peek-session.spec.ts`.

**Interfaces:**

- Consumes: `armDeferredStart`, `disarmDeferredStart` from Task 2.
- Produces: nothing later tasks import.

**Note on spec §4:** the spec suggested the `{#if !workoutClientId}` "Starting your session…" placeholder could be narrowed to the resume path. On reading the code that turns out to be wrong — `workoutClientId` is already assigned before the hydration await on *both* paths, and the fresh path now resolves within a microtask, before the browser paints. **Make no markup change.** Update the comment only, so it stops claiming a write happens at mount.

- [ ] **Step 1: Add the dev-user factory**

In `e2e/env.ts`, after `quarantineDevUserFor`:

```ts
/**
 * A per-project dev user for the peek spec. It asserts that opening a session and logging
 * nothing leaves Home's suggested next session where it was, which is whole-account state
 * — see `homeDevUserFor` for the same reasoning and the header that makes it work.
 */
export function peekDevUserFor(projectName: string): string {
  return `e2e-peek-${projectName}`;
}
```

- [ ] **Step 2: Write the failing e2e spec**

Create `e2e/peek-session.spec.ts`:

```ts
/**
 * Opening a session to look at it must leave nothing behind.
 *
 * The runner used to write a `start` op on mount, so a session someone opened and never
 * trained became a `workout` row with `status = 'partial'`. The History row was the least
 * of it: `suggestNextSession` counts any workout as an attempt and advances its rotation
 * cursor, and the export's Adherence table counts it as a Partial — a wrong claim about
 * the user reaching the reviewing AI, which is the harm this spec exists to hold shut.
 *
 * Its own per-project dev user, because the suggested-next-session assertion is
 * whole-account state — see `peekDevUserFor`.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG, peekDevUserFor } from "./env";
import { assertNoHorizontalOverflow } from "./helpers";

test("opening a session and logging nothing leaves no workout and does not advance the rotation", async ({
  page,
}, testInfo) => {
  await page.setExtraHTTPHeaders({ "x-gain-e2e-user": peekDevUserFor(testInfo.project.name) });

  // -- What Home suggests before anything is opened.
  await page.goto("/");
  const suggestion = page.getByRole("button", { name: /^Start / });
  await expect(suggestion).toBeVisible();
  const before = await suggestion.textContent();

  // -- Open the suggested session, look at it, and leave without logging a thing.
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await expect(page.getByRole("heading", { name: "Before you start" })).toBeVisible();
  await assertNoHorizontalOverflow(page);

  // Nothing is persisted, so there is no resume key either — the whole point is that a
  // second visit is a fresh session, not a resumed one.
  const storedKey = await page.evaluate(
    (k) => localStorage.getItem(k),
    `gain:workout:${E2E_PLAN_SLUG}:A`,
  );
  expect(storedKey, "a session that was only looked at must store no workout key").toBeNull();

  // And nothing is queued for sync.
  const queued = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const request = indexedDB.open("gain-sync", 1);
        request.onsuccess = () => {
          const db = request.result;
          const all = db.transaction("outbox").objectStore("outbox").getAll();
          all.onsuccess = () => resolve((all.result as unknown[]).length);
          all.onerror = () => resolve(-1);
        };
        request.onerror = () => resolve(-1);
      }),
  );
  expect(queued, "a session that was only looked at must queue no ops").toBe(0);

  // -- Home is where it was: same suggestion, and no history row to show for it.
  await page.goto("/");
  await expect(suggestion).toHaveText(before ?? "");

  await page.goto(`/plan/${E2E_PLAN_SLUG}/history`);
  await expect(page.getByText("Nothing logged yet")).toBeVisible();
});
```

**Before running:** confirm the two copy strings this spec asserts on — the Start button's accessible name and History's empty-state text. Grep `src/routes/NextSessionCard.svelte` and `src/routes/plan/[slug]/history/+page.svelte` for the real text and fix the locators to match, rather than changing the app's copy to match the spec.

- [ ] **Step 3: Run it and watch it fail**

Run: `npx playwright test --project=iphone e2e/peek-session.spec.ts`
Expected: FAIL on the `storedKey` assertion — the runner still writes the key and the op on mount.

- [ ] **Step 4: Change the mount effect**

In `src/routes/plan/[slug]/session/[key]/+page.svelte`, extend the sync-client import:

```ts
import {
  armDeferredStart,
  disarmDeferredStart,
  logWrite,
  opsForWorkout,
  startSyncLoop,
} from "$lib/sync/client.svelte";
```

`clientId` is currently declared inside the effect's async IIFE, but the cleanup needs it. Hoist it: declare `let clientId: string | undefined;` in the effect body above the IIFE, and assign (not redeclare) it inside.

Replace the `if (!resumed) { … }` block with:

```ts
      if (!resumed) {
        /**
         * Nothing is persisted here — not the resume key, not the `start` op. Both land
         * on the first write against this workout, via the start armed below
         * (`$lib/sync/deferred-start`). A session someone only opened to look at must
         * not be able to claim it happened: a `workout` row advances Home's rotation
         * cursor and counts as a Partial in the export's Adherence table, and the
         * reviewing AI reads a Partial as a session the user abandoned.
         *
         * The op is minted *whole* right here rather than at commit time, and that is
         * load-bearing twice over. Its ULID must sort below every op it precedes, or
         * `planBatch` sends the set first and replay costs a wasted round trip on
         * `NotYetError`; ULIDs are monotonic, so minting it now makes that free. And
         * `startedAt` is honestly the moment the session opened — warm-up and setup are
         * part of a session, and stamping it at the first set would silently narrow
         * every future duration and break comparison with everything already logged.
         */
        armDeferredStart(
          {
            kind: "start",
            id: newOpId(),
            workoutClientId: clientId,
            planVersionId: data.planVersionId,
            sessionKey: data.session.key,
            startedAt: new Date().toISOString(),
          },
          () => {
            if (typeof localStorage !== "undefined") localStorage.setItem(storageKey, clientId);
          },
        );
      }
```

Then extend the effect's cleanup:

```ts
    return () => {
      cancelled = true;
      // Module state needs a way out of every state it can enter. A start armed for a
      // session that was left without a write would otherwise sit there until the tab
      // closed.
      if (clientId) disarmDeferredStart(clientId);
    };
```

Finally, update the `{#if !workoutClientId}` comment in the markup so it no longer says a write happens at mount. The branch itself stays.

- [ ] **Step 5: Run the spec and verify it passes**

Run: `npx playwright test --project=iphone e2e/peek-session.spec.ts`
Expected: PASS.

- [ ] **Step 6: Prove the ordinary path still works**

The whole runner depends on this effect. Run the two full-session walkthroughs and the resume spec:

Run: `npx playwright test --project=iphone e2e/session-runner-walkthrough-a.spec.ts e2e/session-runner-walkthrough-d.spec.ts e2e/session-runner-resume.spec.ts`
Expected: PASS. If resume fails, the `onCommit` callback is not writing the key — that is the failure mode to look for first.

- [ ] **Step 7: Full verify**

Run: `npm run verify`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add "src/routes/plan/[slug]/session/[key]/+page.svelte" e2e/env.ts e2e/peek-session.spec.ts
git commit -m "$(cat <<'EOF'
fix(session): stop creating a workout for a session that was only opened

The runner wrote a start op on mount, before the user had touched anything, so
opening a session to see what was in it created a workout row with status
partial. It now arms the start op instead and persists nothing — neither the op
nor the localStorage resume key — until the first write against that workout.

The row was never only a stray History entry. suggestNextSession counts any
workout as an attempt and advances its rotation cursor, so peeking at session B
made Home suggest C; and the export's Adherence table counted it as a Partial,
which the reviewing AI reads as a session the user abandoned and may deload
against. That last one is the harm worth naming: nothing in the loop catches a
wrong claim once it reaches the next revision.

The start op is minted whole at mount rather than at commit, which settles two
things at once. Its ULID has to sort below every op it precedes or planBatch
sends the set first and replay pays a NotYetError round trip; ULIDs are
monotonic, so minting it early makes that free. And startedAt stays the moment
the session opened, so warm-up time keeps counting and durations stay
comparable with every workout already logged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: The cleanup migration

**Files:**

- Modify: `src/lib/db/schema.ts` — add `MIGRATION_003` before the `MIGRATIONS` array (line ~287) and a third entry in it.
- Create: `tests/db/peek-cleanup.test.ts`.

**Interfaces:**

- Consumes: `MIGRATIONS` (already exported from `schema.ts`), `openUserDb`, `importPlan`, `startWorkout`, `logSet`, `logMetric`, `logDeviation`, `getExerciseDefIdBySlug`.
- Produces: schema version 3.

**Two traps, both silent:**

1. **`NOT IN` with a nullable column deletes nothing.** `metric_value.workout_id` is nullable (a set-scope metric hangs off `set_log_id` instead). `id NOT IN (SELECT workout_id FROM metric_value)` evaluates to `NULL` for every row the moment that subquery yields one `NULL`, so the `DELETE` matches nothing while reading as correct. Use `NOT EXISTS`, which has no such behaviour.
2. **`datetime('now')` does not sort against an ISO string.** It yields `YYYY-MM-DD HH:MM:SS`; `started_at` is `toISOString()`, i.e. `YYYY-MM-DDTHH:MM:SS.sssZ`. Comparing them as strings is wrong in both directions. Use `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')`.

- [ ] **Step 1: Write the failing test**

Create `tests/db/peek-cleanup.test.ts`:

```ts
/**
 * Migration 3 deletes the `workout` rows that earlier builds created just for opening a
 * session. The assertions are as much about what it spares as about what it removes: a
 * row with a single set, metric or deviation recorded something, and the emptiness test
 * is the whole reason this deletion is provably lossless.
 *
 * The migration's SQL is re-run by hand against rows inserted afterwards, rather than
 * driven through `openUserDb`. `openUserDb` applies every migration at once on a fresh
 * database, so there is no moment at which a version-2 database with rows in it exists
 * to migrate — and re-running the real shipped string is a stricter test than
 * reimplementing its logic here would be.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { getExerciseDefIdBySlug } from "../../src/lib/db/read";
import { MIGRATIONS } from "../../src/lib/db/schema";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { logDeviation, logMetric, logSet, startWorkout } from "../../src/lib/db/workout";
import { parsePlanDocument } from "../../src/lib/parse/parser";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");

const IMPORTED = new Date("2026-09-08T08:00:00Z");
const LONG_AGO = new Date("2026-09-01T08:00:00Z");

const cleanupSql = MIGRATIONS.find((m) => m.version === 3)?.sql;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

describe("migration 3: peeked-workout cleanup", () => {
  let dataDir: string;
  let userDb: UserDb;
  let planId: string;
  let versionId: string;
  let squatId: string;

  function countWorkouts(): number {
    const { n } = userDb.db.prepare("SELECT COUNT(*) AS n FROM workout").get() as { n: number };
    return n;
  }

  function peek(clientId: string, now: Date): string {
    return startWorkout(userDb, {
      planVersionId: versionId,
      sessionKey: "A",
      clientId,
      now,
    }).id;
  }

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-peek-cleanup-"));
    userDb = openUserDb(dataDir, "user-1", { now: IMPORTED });

    const parsed = parsePlanDocument(fixtureMd);
    if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
    const result = importPlan(userDb, { parsed, now: IMPORTED });
    if (!result.ok) throw new Error(result.message);
    planId = result.plan_id;

    versionId = (
      userDb.db
        .prepare("SELECT id FROM plan_version WHERE plan_id = ? ORDER BY version_no DESC LIMIT 1")
        .get(planId) as { id: string }
    ).id;

    const found = getExerciseDefIdBySlug(userDb, planId, "goblet-squat");
    if (!found) throw new Error("fixture is missing goblet-squat");
    squatId = found;
  });

  afterEach(() => {
    userDb.db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("ships as version 3", () => {
    expect(cleanupSql, "migration 3 must exist").toBeTruthy();
  });

  it("deletes an old workout with nothing logged against it", () => {
    peek("peek-1", daysAgo(5));
    expect(countWorkouts()).toBe(1);

    userDb.db.exec(cleanupSql as string);

    expect(countWorkouts()).toBe(0);
  });

  it("spares an empty workout inside the 24-hour floor", () => {
    // A session open on someone's phone right now has no rows yet either. Migrations run
    // lazily on any request, POST /api/sync included, so without this floor a restart
    // between the start op syncing and the first set arriving would delete the live
    // workout and strand that set as permanently pending.
    peek("peek-fresh", daysAgo(0));

    userDb.db.exec(cleanupSql as string);

    expect(countWorkouts()).toBe(1);
  });

  it("spares a workout with a logged set", () => {
    const workoutId = peek("real-set", daysAgo(5));
    logSet(userDb, {
      workoutId,
      exerciseDefId: squatId,
      setNo: 1,
      reps: 12,
      weightKg: 6,
      difficulty: "medium",
      clientId: "set-1",
    });

    userDb.db.exec(cleanupSql as string);

    expect(countWorkouts()).toBe(1);
  });

  it("spares a workout with only a session metric", () => {
    // The NOT IN trap lives here: `metric_value.workout_id` is nullable, so a `NOT IN`
    // subquery over it goes NULL and deletes nothing at all. This is the test that
    // catches the wrong spelling.
    const workoutId = peek("real-metric", daysAgo(5));
    logMetric(userDb, {
      scope: "session",
      workoutId,
      metricKey: "energy_before",
      valueNum: 3,
      clientId: "metric-1",
    });

    userDb.db.exec(cleanupSql as string);

    expect(countWorkouts()).toBe(1);
  });

  it("spares a workout with only a deviation", () => {
    const workoutId = peek("real-deviation", daysAgo(5));
    logDeviation(userDb, {
      workoutId,
      exerciseDefId: squatId,
      kind: "skip",
      reasonCode: "time",
      clientId: "deviation-1",
    });

    userDb.db.exec(cleanupSql as string);

    expect(countWorkouts()).toBe(1);
  });

  it("spares a finished workout even with nothing logged against it", () => {
    // `completed_at` means the user tapped Finish. That is a claim they made about their
    // own session, and it is not this migration's to overrule.
    const workoutId = peek("finished-empty", daysAgo(5));
    userDb.db
      .prepare("UPDATE workout SET status = 'completed', completed_at = ? WHERE id = ?")
      .run(LONG_AGO.toISOString(), workoutId);

    userDb.db.exec(cleanupSql as string);

    expect(countWorkouts()).toBe(1);
  });

  it("deletes several peeks and spares several real workouts in one pass", () => {
    peek("peek-a", daysAgo(9));
    peek("peek-b", daysAgo(4));
    const real = peek("real", daysAgo(6));
    logSet(userDb, {
      workoutId: real,
      exerciseDefId: squatId,
      setNo: 1,
      reps: 10,
      clientId: "set-2",
    });
    peek("fresh", daysAgo(0));

    userDb.db.exec(cleanupSql as string);

    expect(countWorkouts()).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run tests/db/peek-cleanup.test.ts`
Expected: FAIL — `migration 3 must exist`, and the rest throw on `cleanupSql` being `undefined`.

- [ ] **Step 3: Add the migration**

In `src/lib/db/schema.ts`, after `MIGRATION_002`:

```ts
const MIGRATION_003 = `
-- Until lazy start landed, opening the session runner wrote a start op on mount, so a
-- session someone opened only to look at became a workout row with status 'partial'.
-- Those rows advance Home's rotation cursor and count as a Partial in the export's
-- Adherence table, where the reviewing AI reads them as sessions the user abandoned.
--
-- A row with no set, no deviation and no metric recorded nothing, which is what makes
-- deleting it provably lossless rather than merely tidy. Those three are also the only
-- tables with a foreign key onto workout, so a row passing this test is referenced by
-- nothing.
--
-- NOT EXISTS rather than NOT IN, deliberately: metric_value.workout_id is nullable, and
-- a NOT IN subquery yielding one NULL evaluates to NULL for every row, so the DELETE
-- would silently match nothing while looking correct.
--
-- The 24-hour floor is load-bearing, not caution. Migrations run lazily on a user's next
-- request (ARCHITECTURE section 5), and POST /api/sync is one of those requests. Without
-- the floor, a restart in the window between a start op syncing and the first set
-- arriving would delete that live, still-empty workout and leave the set resolving no
-- workout: NotYetError, transient, so never quarantined, and retried forever with the
-- start op already acked out of the outbox. No live session is a day old.
--
-- strftime rather than datetime('now'): datetime yields 'YYYY-MM-DD HH:MM:SS', which
-- does not sort against started_at's ISO 'YYYY-MM-DDTHH:MM:SS.sssZ'.
DELETE FROM workout
WHERE completed_at IS NULL
  AND started_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
  AND NOT EXISTS (SELECT 1 FROM set_log      s WHERE s.workout_id = workout.id)
  AND NOT EXISTS (SELECT 1 FROM deviation    d WHERE d.workout_id = workout.id)
  AND NOT EXISTS (SELECT 1 FROM metric_value m WHERE m.workout_id = workout.id);
`;
```

And extend the array:

```ts
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "domain-model-v1", sql: MIGRATION_001 },
  { version: 2, name: "drop-ai-template", sql: MIGRATION_002 },
  { version: 3, name: "delete-peeked-workouts", sql: MIGRATION_003 },
];
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/db/peek-cleanup.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Bump the schema-version assertion**

`tests/db/provision.test.ts:39` asserts `expect(appliedSchemaVersion(userDb.db)).toBe(2)`.
Change the `2` to `3`. That is the migration doing its job, not a break.

`tests/server/admin-stats.test.ts` needs no edit: it asserts against
`CURRENT_SCHEMA_VERSION`, which is `MIGRATIONS.at(-1)?.version ?? 0`
(`src/lib/server/admin-stats.ts:35`) and so follows the new migration on its own.

Run: `npx vitest run tests/schema.test.ts tests/db/provision.test.ts tests/server/admin-stats.test.ts`
Expected: PASS.

- [ ] **Step 6: Full verify**

Run: `npm run verify`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts tests/db/peek-cleanup.test.ts
git commit -m "$(cat <<'EOF'
feat(db): delete the workout rows earlier builds created for a mere peek

Lazy start stops new ones appearing; this clears the ones already in people's
databases. A workout with no set, no deviation and no metric recorded nothing,
and those three are the only tables with a foreign key onto workout, so a row
passing that test is referenced by nothing and its deletion is provably
lossless. This is the first migration in the project to delete user data, which
is worth naming: it is narrow by construction and is not a precedent for
deleting rows that hold anything.

Two spellings here are load-bearing and both fail silently if got wrong. NOT
EXISTS rather than NOT IN, because metric_value.workout_id is nullable and a
NOT IN subquery yielding one NULL evaluates to NULL for every row, so the
delete would match nothing while reading as correct. And strftime rather than
datetime('now'), which yields a space-separated stamp that does not sort
against started_at's ISO string.

The 24-hour floor is not caution. Migrations run lazily on a user's next
request, POST /api/sync included, so without it a restart between a start op
syncing and the first set arriving would delete that live empty workout and
leave the set resolving nothing, retried forever with the start op already
acked away.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: The export and offline halves

**Files:**

- Modify: `e2e/peek-session.spec.ts` — add the Adherence assertion.
- Create: `e2e/offline-peek.spec.ts`.

**Interfaces:** consumes Task 3's `peekDevUserFor`.

**Why the Adherence assertion is separate from the History one:** History is what the user sees; the Adherence table is what the *AI* sees, and it is the one that changes the next plan. The standing rule about charts and summaries applies — assert on a value that only exists with data, never on a container that renders either way.

- [ ] **Step 1: Add the export assertion to the peek spec**

Append to the test in `e2e/peek-session.spec.ts`, after the History assertion:

```ts
  // -- The half that actually reaches the reviewing AI. The Adherence table has one row
  // per declared session, so the row exists either way; the Partial *count* in it is the
  // only thing that would move.
  await page.goto(`/plan/${E2E_PLAN_SLUG}/export`);
  await page.getByRole("button", { name: "Generate the export" }).click();
  await expect(page.getByRole("heading", { name: "Paste this into your AI chat" })).toBeVisible();

  const bundle = await page.locator("textarea.doc").inputValue();
  const adherence = bundle.split("\n").find((line) => line.startsWith("| A |"));
  expect(adherence, "the Adherence table must carry a row for session A").toBeTruthy();

  // `| A | <name> | workouts | completed | partial | stopped |` — the leading pipe makes
  // an empty first element, so cells[1] is the session key.
  const cells = (adherence as string).split("|").map((cell) => cell.trim());
  expect(cells[3], "a session that was only looked at is not a workout").toBe("0");
  expect(cells[5], "a session that was only looked at is not a partial").toBe("0");

  expect(bundle).toContain("Workouts in window: 0");
```

Run: `npx playwright test --project=iphone e2e/peek-session.spec.ts`
Expected: PASS. If the cell indices are off, log `cells` once and correct them.

- [ ] **Step 2: Write the offline spec**

Create `e2e/offline-peek.spec.ts`:

```ts
/**
 * The offline half of lazy start: a session opened with no connection queues nothing, and
 * reconnecting therefore syncs nothing.
 *
 * Runs against the `offline` project's real `node build` server, because
 * `$service-worker`'s precache manifest is empty under `vite dev`. The navigation shape —
 * two online visits to Home, then a client-side navigation into the session rather than a
 * `page.goto` — is copied from `offline-session.spec.ts`; read its header for why each of
 * those is required rather than incidental.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import { outboxRecords, waitForPrecached } from "./helpers";

const SESSION_NAME = "Squat, Press & Row";

test("a session opened offline and never logged queues nothing", async ({ page, context }) => {
  test.setTimeout(60_000);

  await page.goto("/");
  await waitForPrecached(page, `/plan/${E2E_PLAN_SLUG}/session/A/__data.json`);
  await page.goto("/");

  await context.setOffline(true);

  await page.getByRole("link", { name: SESSION_NAME }).first().click();
  await expect(page.getByRole("heading", { name: "Before you start" })).toBeVisible();

  expect(await outboxRecords(page), "opening a session must queue nothing").toEqual([]);

  await context.setOffline(false);
  await page.goto("/");

  expect(await outboxRecords(page), "reconnecting must find nothing to send").toEqual([]);
});
```

**Before running:** check `outboxRecords`' return shape in `e2e/helpers.ts` (line ~230) and copy `offline-session.spec.ts`'s own navigation locator verbatim rather than guessing at the link's accessible name.

- [ ] **Step 3: Run the offline spec**

Run: `npx playwright test --project=offline e2e/offline-peek.spec.ts`
Expected: PASS. This project builds the app first, so it is slow — run it alone, never as part of a four-project run.

- [ ] **Step 4: Run the whole e2e suite once**

Run: `npx playwright test`
Expected: PASS. Watch `session-runner-resume`, `sync-banner` and `quarantine` especially — they are the three most coupled to when ops enter the outbox.

- [ ] **Step 5: Commit**

```bash
git add e2e/peek-session.spec.ts e2e/offline-peek.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): hold the export and offline halves of lazy start shut

The peek spec now also asserts that a session which was only looked at leaves
the export's Adherence row for that session at zero workouts and zero partials.
That is the assertion worth having: History is what the user sees, but the
Adherence table is what the reviewing AI reads, and a wrong Partial there
becomes a wrong prescription with nothing in the loop to catch it.

The offline spec covers the same ground with no connection, where the failure
would look different — a queued start op sitting in the outbox until reconnect
rather than a row appearing immediately.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Fold the durable half in, delete the tracking docs

**Files:**

- Modify: `docs/UI.md` (§2), `docs/ARCHITECTURE.md` (§9, "Offline model").
- Delete: `docs/todo-discard-session.md`, `docs/superpowers/specs/2026-09-01-lazy-session-start-design.md`, `docs/superpowers/plans/2026-09-01-lazy-session-start.md`.

**These are argued-prose documents.** Match their voice — do not flatten them into bullets. `docs/` is prettier-ignored; do not format it.

- [ ] **Step 1: Add the UI §2 clause**

In `docs/UI.md`, at the end of §2 "Effort is the commit action", add:

```markdown
**Effort commits the workout, not only the set.** Opening the runner writes nothing —
no `start` op, no resume key — until the first real write against that workout. Before
that, a session someone opened to see what was in it created a `workout` row on mount,
which advanced Home's rotation cursor and counted as a Partial in the export's Adherence
table; the reviewing AI reads a Partial as a session that was abandoned, so a moment of
curiosity became a wrong claim in the next revision. A session that was only looked at
must not be able to say it happened. The architectural half — what is held, and why the
op is minted at mount rather than at commit — is ARCHITECTURE §9.
```

- [ ] **Step 2: Add the ARCHITECTURE §9 rule**

In `docs/ARCHITECTURE.md`, in §9's "Offline model" list, after the client-owns-state bullet:

```markdown
- **A workout is not created until it is written to.** Opening the runner mints the
  workout's `client_id`, its `start` op and its `startedAt` in memory and persists none of
  them; the first op carrying that `workoutClientId` drags the start into the outbox ahead
  of itself and writes the `localStorage` resume key (`$lib/sync/deferred-start.ts`).
  **Every** workout-scoped op commits it, a `finish` included — not as a judgement about
  which ops are real effort, but because an op reaching the server with no workout behind
  it resolves nothing, throws `NotYetError`, and is retried forever with no start op left
  in the outbox to rescue it.

  The start op is minted **whole at mount**, not at commit. Its ULID has to sort below
  every op it precedes or `planBatch` sends the set first and replay pays a wasted round
  trip; ULIDs are monotonic, so minting it at mount makes that ordering free. It also
  fixes `startedAt` at the moment the session opened, which keeps warm-up and setup inside
  the session's duration and keeps that figure comparable with everything already logged.
```

- [ ] **Step 3: Check the standing docs still describe the app**

Re-read `docs/UI.md` §2 and §8 and `docs/ARCHITECTURE.md` §9 end to end. Anything still describing a workout as existing from the moment the screen opens is now wrong — fix it.

- [ ] **Step 4: Delete the tracking docs**

```bash
git rm docs/todo-discard-session.md
git rm docs/superpowers/specs/2026-09-01-lazy-session-start-design.md
git rm docs/superpowers/plans/2026-09-01-lazy-session-start.md
```

No strikethrough, no "done" section, no archive directory. `git log` and `git show <sha>:<path>` recover anything that mattered.

- [ ] **Step 5: Verify**

Run: `npm run verify`
Expected: exit 0. `npm run check:chars` covers Markdown too, so a stray control character in the prose fails here.

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "$(cat <<'EOF'
docs: settle lazy session start and close its tracking docs

UI section 2 gains the clause that effort commits the workout and not only the
set, with the reason it exists: a session someone only opened must not be able
to claim it happened, because the export's Adherence table turns that claim
into a wrong prescription. ARCHITECTURE section 9's offline model gains the
mechanism — what is held back, why every workout-scoped op commits it including
finish, and why the start op is minted whole at mount rather than at commit.

The design spec, the implementation plan and the older discard-session todo all
go. Their durable half is now in the two documents above, beside the code it
governs, and git holds the rest.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes

- **Spec coverage.** Spec §1 → Tasks 1 and 2. §2 → Task 3 Step 4. §3 → Task 1's finish/deviation/metric tests plus the pure rule. §4 → **revised**, see Task 3's note: no markup change is warranted, and the plan says why rather than silently dropping it. §5 → Task 4. §6 → Tasks 1, 4, 3, 5. "Folding back in" → Task 6.
- **Two traps carried from investigation into the plan rather than left to be rediscovered:** the `NOT IN` NULL behaviour and the `datetime('now')` format mismatch. Both fail silently and both pass review.
- **Naming is consistent throughout:** `resolveWrite`, `armDeferredStart`, `disarmDeferredStart`, `MIGRATION_003`, `peekDevUserFor`.
- **Copy strings in e2e locators are flagged as unverified** in Tasks 3 and 5 rather than asserted as fact — they were not read during planning, and a spec that changes app copy to match itself is worse than one that fails.
