# Unfinished Sessions: Resume or Discard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an unfinished training session visible on Home, resumable for twelve hours, and discardable forever.

**Architecture:** Home's rotation cursor starts reading only *finished* workouts (`completed_at NOT NULL`), which is the whole of the reported bug. A new Home card surfaces each open workout — replacing the next-session card inside the twelve-hour window, sitting above it outside — offering Resume (inside the window only) and Discard (always). Discard is a hard delete carried by a sixth sync op so it works offline, and it is the one op whose "workout not found" on replay means success rather than "not yet".

**Tech Stack:** TypeScript, SvelteKit (Svelte 5 runes), SQLite via better-sqlite3, Zod 4, Vitest 4, Playwright, `ulidx`.

**Spec:** [`docs/superpowers/specs/2026-09-19-unfinished-session-resume-design.md`](../specs/2026-09-19-unfinished-session-resume-design.md) — read it before Task 1. It carries the reasoning; this plan carries the steps.

## Global Constraints

- **Read `CLAUDE.md` first.** Its Invariants and "Rules learned the hard way" govern every task here, especially the offline-sync and form-action rules.
- **Branch:** work directly on `main`. Do not create a worktree — `CLAUDE.md` forbids worktrees in this repo.
- **Zod 4 syntax:** `z.strictObject`, `z.looseObject`, `error:`. Never `z.object().strict()` or `message:`.
- **Svelte 5 runes only:** `$state`, `$derived`, `$props`, `$effect`. No `export let`, no `createEventDispatcher`.
- **Icons:** `~icons/lucide/<name>` only. Never `@iconify/svelte`. Never set `width`/`height` on an icon.
- **Never write a literal control character.** Write the escape `\u0000`, never the character itself. Both `npm run check:chars` and the `gain/no-control-characters` ESLint rule enforce this; if either fires, fix the character rather than reaching for a disable.
- **After editing a TypeScript or Svelte file:** run `npx prettier --write <file>`. `docs/`, `fixtures/` and `templates/` are excluded from formatting — do not run Prettier on them.
- **`npm run verify` before declaring any task done.** Never pipe it through `tail`/`head` — the shell is fish, and a pipeline reports the filter's exit status, not npm's. Redirect to a file and read the file.
- **The resume window is 12 hours, measured from the workout's `started_at`.** One constant, `RESUME_WINDOW_MS`, defined once in Task 2 and imported everywhere else.
- **No new "in progress" status.** `workout.status` stays `completed | partial | stopped`. An open workout is one with a NULL `completed_at`.
- **Commit message format:** `type(scope): imperative summary`, lowercase, no trailing period, closing with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Two functions are called `discardWorkout`, deliberately.** `$lib/db/workout`'s takes a `UserDb` and deletes rows server-side (Task 4); `$lib/sync/client.svelte`'s takes a `planSlug` and drives the client half (Task 6). They are never imported into the same file. Check the import path before calling either.
- **`ulidAt(ms)` is a shared test helper** — create it at `tests/helpers/ulid-at.ts` in Task 2 and import it in Tasks 7 and 10 rather than redefining it: `export const ulidAt = (ms: number) => `${encodeTime(ms, 10)}0000000000000000`;` using `encodeTime` from `ulidx`.

---

### Task 1: The rotation cursor reads finished workouts only

This is the reported bug. `suggestNextSession` takes the most recent workout as its cursor regardless of whether it was ever finished, so one logged set advances the suggestion as though the session had been completed.

**Files:**
- Modify: `src/lib/home/next-session.ts`
- Modify: `src/lib/db/home.ts:17-32` (`recentWorkoutsForPlan`)
- Test: `tests/home/next-session.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `RecentWorkoutRef` gains `completedAt: string | undefined`. `suggestNextSession(sessions, sequence, recentWorkouts)` keeps its signature; only the element type widens.

- [ ] **Step 1: Write the failing tests**

Append to `tests/home/next-session.test.ts`. Note that every existing test in the file constructs `RecentWorkoutRef` literals without `completedAt` — they will stop compiling in Step 3, and Step 3 fixes them.

```ts
const DONE = "2026-08-12T09:00:00.000Z";

describe("suggestNextSession and unfinished workouts", () => {
  it("does not advance the cursor past a workout that was never finished", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "B", startedAt: "2026-08-12T08:00:00.000Z", completedAt: undefined },
      { sessionKey: "A", startedAt: "2026-08-05T08:00:00.000Z", completedAt: DONE },
    ]);
    // B was abandoned, so A is still the last session that happened.
    expect(result.suggestedKey).toBe("B");
  });

  it("still advances on a finished workout of any status", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "B", startedAt: "2026-08-12T08:00:00.000Z", completedAt: DONE },
    ]);
    expect(result.suggestedKey).toBe("C");
  });

  it("skips an unfinished workout to reach the finished one behind it", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "C", startedAt: "2026-08-14T08:00:00.000Z", completedAt: undefined },
      { sessionKey: "B", startedAt: "2026-08-12T08:00:00.000Z", completedAt: DONE },
    ]);
    expect(result.suggestedKey).toBe("C");
  });

  it("reports no last session when the only workout is unfinished", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "A", startedAt: "2026-08-12T08:00:00.000Z", completedAt: undefined },
    ]);
    expect(result.lastSession).toBeUndefined();
  });

  it("does not report a lastDoneDate for a session only ever abandoned", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "A", startedAt: "2026-08-12T08:00:00.000Z", completedAt: undefined },
    ]);
    expect(result.overrides.find((o) => o.key === "A")?.lastDoneDate).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/home/next-session.test.ts`
Expected: FAIL. TypeScript will also object to the unknown `completedAt` property — that is part of the failure.

- [ ] **Step 3: Widen the type and apply the predicate**

In `src/lib/home/next-session.ts`, change the type and add the predicate:

```ts
export type RecentWorkoutRef = {
  sessionKey: string;
  startedAt: string;
  /**
   * ISO timestamp, or `undefined` for a workout still open. ARCHITECTURE §5: there is
   * no "in progress" status — in-progress is the absence of `completed_at`.
   */
  completedAt: string | undefined;
};

/**
 * A workout that reached an ending, whatever that ending was. A red-flag stop counts:
 * `finishWorkout` stamps `completed_at` on a stop, so the rotation still advances past
 * one, which is the behaviour this module already documented. What does not count is a
 * session abandoned mid-way — it never happened, so nothing may be derived from it.
 *
 * The same predicate is already the definition of "finished" in
 * `$lib/progress/consistency.ts` and `$lib/progress/session-stats.ts`. Home was the one
 * module not using it, which is why one logged set used to advance the suggestion.
 */
function isFinished(workout: RecentWorkoutRef): boolean {
  return workout.completedAt !== undefined;
}
```

Then apply it in the three places that derive a claim from history — the cursor, `lastSession`, and each override's `lastDoneDate`:

```ts
  const finished = recentWorkouts.filter(isFinished);

  const cursor = finished.find((w) => order.includes(w.sessionKey));
  const suggestedKey =
    cursor === undefined
      ? firstKey
      : (order[(order.indexOf(cursor.sessionKey) + 1) % order.length] ?? firstKey);

  const overrides: SessionOverrideRef[] = [...sessions]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      key: s.key,
      lastDoneDate: finished.find((w) => w.sessionKey === s.key)?.startedAt.slice(0, 10),
    }));

  const last = finished[0];
```

Update the existing cursor comment to say that an unfinished workout never advances it, at any age.

Then fix the existing tests in `tests/home/next-session.test.ts`: every `RecentWorkoutRef` literal needs `completedAt`. Give them all a finished timestamp so their intent is unchanged — including the "advances the cursor on any workout status" test, whose comment must be updated to say the caller now includes `completed_at` and that a *stop* still advances while an *abandonment* does not.

- [ ] **Step 4: Add the column to the query**

In `src/lib/db/home.ts`, `recentWorkoutsForPlan`:

```ts
export type HomeWorkoutRef = {
  sessionKey: string;
  startedAt: string;
  completedAt: string | undefined;
};

export function recentWorkoutsForPlan(
  userDb: UserDb,
  planId: string,
  limit = 10,
): HomeWorkoutRef[] {
  const rows = userDb.db
    .prepare(
      `SELECT w.session_key AS sessionKey, w.started_at AS startedAt,
              w.completed_at AS completedAt
       FROM workout w
       JOIN plan_version pv ON pv.id = w.plan_version_id
       WHERE pv.plan_id = ?
       ORDER BY w.started_at DESC
       LIMIT ?`,
    )
    .all(planId, limit) as { sessionKey: string; startedAt: string; completedAt: string | null }[];

  return rows.map((row) => ({
    sessionKey: row.sessionKey,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? undefined,
  }));
}
```

The `?? undefined` mapping is not cosmetic: SQLite hands back `null`, and `completedAt: null` would pass an `!== undefined` check and make every abandoned workout read as finished.

The `limit = 10` default now counts unfinished workouts toward the ten, so a user with several open workouts could push the last finished one out of the window. Raise the default to `25` and note why in a comment.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run tests/home/next-session.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Verify and commit**

```bash
npx prettier --write src/lib/home/next-session.ts src/lib/db/home.ts tests/home/next-session.test.ts
npm run verify > /tmp/verify.log 2>&1; echo "exit=$status"; tail -40 /tmp/verify.log
git add src/lib/home/next-session.ts src/lib/db/home.ts tests/home/next-session.test.ts
git commit -m "fix(home): stop an abandoned session advancing the rotation

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(The `echo "exit=$status"` is fish syntax — `$status`, not `$?`.)

---

### Task 2: The twelve-hour resume window

A pure module owning the one constant and the one comparison. Nothing else in the codebase may define twelve hours.

**Files:**
- Create: `src/lib/session/workout-age.ts`
- Test: `tests/session/workout-age.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `RESUME_WINDOW_MS: number`
  - `workoutStartedAtMs(clientId: string): number | undefined`
  - `isResumable(clientId: string, now: Date): boolean`

- [ ] **Step 1: Create the shared ULID test helper**

Create `tests/helpers/ulid-at.ts` (Tasks 7 and 10 import it too):

```ts
import { encodeTime } from "ulidx";

/**
 * A ULID whose timestamp is exactly `ms`. The 16-character random suffix is fixed — the
 * tests that use this care only about the time half, and a deterministic suffix keeps a
 * failure message readable.
 */
export function ulidAt(ms: number): string {
  return `${encodeTime(ms, 10)}0000000000000000`;
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/session/workout-age.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ulidAt } from "../helpers/ulid-at";
import {
  RESUME_WINDOW_MS,
  isResumable,
  workoutStartedAtMs,
} from "../../src/lib/session/workout-age";

const NOW = new Date("2026-09-19T20:00:00.000Z");

describe("workoutStartedAtMs", () => {
  it("decodes the start time a ULID client id carries", () => {
    const ms = Date.parse("2026-09-19T14:02:00.000Z");
    expect(workoutStartedAtMs(ulidAt(ms))).toBe(ms);
  });

  it("returns undefined for anything that is not a ULID", () => {
    // A client id from a future format, or a corrupted localStorage value. Guessing a
    // time here would silently gate resume on a fabricated number.
    expect(workoutStartedAtMs("not-a-ulid")).toBeUndefined();
    expect(workoutStartedAtMs("")).toBeUndefined();
  });
});

describe("isResumable", () => {
  it("is true just inside the window", () => {
    expect(isResumable(ulidAt(NOW.getTime() - RESUME_WINDOW_MS + 1000), NOW)).toBe(true);
  });

  it("is false exactly at the window", () => {
    expect(isResumable(ulidAt(NOW.getTime() - RESUME_WINDOW_MS), NOW)).toBe(false);
  });

  it("is false past the window", () => {
    expect(isResumable(ulidAt(NOW.getTime() - RESUME_WINDOW_MS - 1000), NOW)).toBe(false);
  });

  it("is false for an undecodable client id", () => {
    // Refusing to resume is the safe direction: the cost of a wrong `false` is starting
    // a fresh workout, and the cost of a wrong `true` is a multi-day session duration
    // in the export.
    expect(isResumable("not-a-ulid", NOW)).toBe(false);
  });

  it("is true for a clock that has gone backwards", () => {
    // A device clock corrected backwards can put `started_at` in the future. That is a
    // session started moments ago, not an ancient one.
    expect(isResumable(ulidAt(NOW.getTime() + 60_000), NOW)).toBe(true);
  });
});

describe("RESUME_WINDOW_MS", () => {
  it("is twelve hours", () => {
    expect(RESUME_WINDOW_MS).toBe(12 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `npx vitest run tests/session/workout-age.test.ts`
Expected: FAIL, "Failed to resolve import".

- [ ] **Step 4: Write the module**

Create `src/lib/session/workout-age.ts`:

```ts
/**
 * How long an unfinished workout stays resumable, and the one comparison that decides it.
 *
 * Twelve hours from the workout's start. Past that, the session is not resumed — it can
 * only be discarded, and starting the same session again mints a fresh workout. The
 * reason is the export rather than tidiness: session duration is `completed_at -
 * started_at` (`$lib/export/bundle.ts`), so appending today's sets to a days-old workout
 * reports a multi-day session to the reviewing AI, and CLAUDE.md's summary invariant is
 * that a wrong number there becomes a wrong prescription with nothing in the loop to
 * catch it.
 *
 * The age is read from the workout's **client id**, which is a ULID minted when the
 * runner mounted and therefore already carries `started_at` to the millisecond. That is
 * what lets the server (which has the column) and the client (which has only the
 * `localStorage` pointer) reach the same answer with no extra plumbing and no round trip.
 *
 * Pure, and `now` is injected — no clock is read here, so this stays usable during SSR
 * without a hydration mismatch.
 */

import { decodeTime, isValid } from "ulidx";

/** Twelve hours. Defined once; nothing else may spell this number. */
export const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * The start time a workout's ULID client id encodes, or `undefined` when the id is not a
 * ULID at all — a value from a future id format, or a corrupted `localStorage` entry.
 * `decodeTime` throws on a malformed input rather than returning a sentinel, so the
 * guard is `isValid` and not a try/catch after the fact.
 */
export function workoutStartedAtMs(clientId: string): number | undefined {
  if (!isValid(clientId)) return undefined;
  return decodeTime(clientId);
}

/**
 * Whether this workout may still be resumed.
 *
 * An id we cannot read is **not** resumable. That is the safe direction: a wrong `false`
 * costs a fresh workout, while a wrong `true` costs a corrupted duration in an export
 * nobody re-checks.
 *
 * A start time in the future is resumable. A device clock corrected backwards can
 * produce one, and that describes a session started moments ago rather than an ancient
 * one.
 */
export function isResumable(clientId: string, now: Date): boolean {
  const startedAt = workoutStartedAtMs(clientId);
  if (startedAt === undefined) return false;
  return now.getTime() - startedAt < RESUME_WINDOW_MS;
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npx vitest run tests/session/workout-age.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Verify and commit**

```bash
npx prettier --write src/lib/session/workout-age.ts tests/session/workout-age.test.ts tests/helpers/ulid-at.ts
npm run verify > /tmp/verify.log 2>&1; echo "exit=$status"; tail -40 /tmp/verify.log
git add src/lib/session/workout-age.ts tests/session/workout-age.test.ts tests/helpers/ulid-at.ts
git commit -m "feat(session): add the twelve-hour resume window

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Read the open workouts Home needs

**Files:**
- Modify: `src/lib/db/home.ts`
- Test: `tests/db/open-workouts.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type OpenWorkoutRef = { workoutClientId: string; sessionKey: string; startedAt: string; setCount: number }`
  - `openWorkoutsForPlan(userDb: UserDb, planId: string): OpenWorkoutRef[]` — newest first.

- [ ] **Step 1: Write the failing test**

Look at an existing file in `tests/db/` first (for example `tests/db/archive.test.ts`) and copy its fixture setup — how it provisions a `UserDb` and imports the fixture plan. Then create `tests/db/open-workouts.test.ts` with these cases, using that setup:

```ts
describe("openWorkoutsForPlan", () => {
  it("returns a workout with no completed_at, with its set count", () => {
    // start a workout, log two sets, do not finish it
    const open = openWorkoutsForPlan(userDb, planId);
    expect(open).toHaveLength(1);
    expect(open[0]?.sessionKey).toBe("A");
    expect(open[0]?.setCount).toBe(2);
  });

  it("omits a finished workout, whatever its status", () => {
    // start and finish one with status 'stopped'
    expect(openWorkoutsForPlan(userDb, planId)).toHaveLength(0);
  });

  it("omits a workout with no client_id, which nothing can address", () => {
    // insert a workout row directly with client_id NULL
    expect(openWorkoutsForPlan(userDb, planId)).toHaveLength(0);
  });

  it("returns newest first", () => {
    // two open workouts, started an hour apart
    const open = openWorkoutsForPlan(userDb, planId);
    expect(open.map((w) => w.sessionKey)).toEqual(["B", "A"]);
  });

  it("returns only this plan's workouts", () => {
    // a second plan with its own open workout
    expect(openWorkoutsForPlan(userDb, planId).map((w) => w.sessionKey)).toEqual(["A"]);
  });

  it("reports a zero set count for a workout whose only write was a metric", () => {
    // a pre-session metric commits the workout without logging a set
    expect(openWorkoutsForPlan(userDb, planId)[0]?.setCount).toBe(0);
  });
});
```

Fill each case in with the real `startWorkout` / `logSet` / `finishWorkout` calls from `$lib/db/workout` — their signatures are in `src/lib/db/workout.ts`.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/db/open-workouts.test.ts`
Expected: FAIL, `openWorkoutsForPlan` is not exported.

- [ ] **Step 3: Write the query**

Add to `src/lib/db/home.ts`:

```ts
/** One workout the user started and never finished. Addressed by `client_id`, because
 * every action Home offers on it (resume, discard) travels through the offline sync
 * layer, which names workouts by client id and never by server id. */
export type OpenWorkoutRef = {
  workoutClientId: string;
  sessionKey: string;
  startedAt: string;
  setCount: number;
};

/**
 * Every workout of this plan the user started and never finished, newest first.
 *
 * "Unfinished" is `completed_at IS NULL` — ARCHITECTURE §5's rule that in-progress is the
 * absence of a completion rather than a fourth status. There is no false-positive case
 * to filter out: `$lib/sync/deferred-start.ts` means a session merely opened persists
 * nothing, so a row existing at all is proof the user wrote something.
 *
 * `client_id IS NOT NULL` excludes rows nothing can act on. Every row the sync layer
 * writes carries one; a row without one could only come from a direct insert, and
 * offering Resume or Discard on something neither can address would be a dead button.
 *
 * The set count is a correlated subquery rather than a join, so a workout whose only
 * write was a pre-session metric still comes back — with `0` — instead of being dropped
 * by an inner join or duplicated by an outer one.
 */
export function openWorkoutsForPlan(userDb: UserDb, planId: string): OpenWorkoutRef[] {
  return userDb.db
    .prepare(
      `SELECT w.client_id AS workoutClientId,
              w.session_key AS sessionKey,
              w.started_at  AS startedAt,
              (SELECT COUNT(*) FROM set_log s WHERE s.workout_id = w.id) AS setCount
       FROM workout w
       JOIN plan_version pv ON pv.id = w.plan_version_id
       WHERE pv.plan_id = ?
         AND w.completed_at IS NULL
         AND w.client_id IS NOT NULL
       ORDER BY w.started_at DESC`,
    )
    .all(planId) as OpenWorkoutRef[];
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/db/open-workouts.test.ts`
Expected: PASS, all six cases.

- [ ] **Step 5: Verify and commit**

```bash
npx prettier --write src/lib/db/home.ts tests/db/open-workouts.test.ts
npm run verify > /tmp/verify.log 2>&1; echo "exit=$status"; tail -40 /tmp/verify.log
git add src/lib/db/home.ts tests/db/open-workouts.test.ts
git commit -m "feat(home): read the plan's unfinished workouts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Discard in the write layer

The app's first surgical delete of logged training data.

**Files:**
- Modify: `src/lib/db/workout.ts`
- Test: `tests/db/discard-workout.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `discardWorkout(userDb: UserDb, workoutClientId: string): boolean` — `true` when a workout was found and deleted, `false` when there was nothing to delete.

- [ ] **Step 1: Write the failing test**

Create `tests/db/discard-workout.test.ts`, reusing the fixture setup from `tests/db/open-workouts.test.ts`:

```ts
describe("discardWorkout", () => {
  it("deletes the workout and every row that hangs off it", () => {
    // a workout with 2 set_logs, 1 session metric_value, 1 set metric_value, 1 deviation
    expect(discardWorkout(userDb, clientId)).toBe(true);
    expect(countOf("workout")).toBe(0);
    expect(countOf("set_log")).toBe(0);
    expect(countOf("metric_value")).toBe(0);
    expect(countOf("deviation")).toBe(0);
  });

  it("returns false for a client id it has never seen", () => {
    // Not an error: a discard op replayed twice, or one for a workout whose start op was
    // purged before it ever synced, must both be a quiet no-op.
    expect(discardWorkout(userDb, "01JXXXXXXXXXXXXXXXXXXXXXXX")).toBe(false);
  });

  it("leaves another workout's rows untouched", () => {
    // two workouts, each with sets; discard the first
    expect(setLogCountForWorkout(otherId)).toBe(2);
  });

  it("deletes a set-scope metric_value, which references the set and not the workout", () => {
    // metric_value rows for scope 'set' carry set_log_id; assert none survive
    expect(countOf("metric_value")).toBe(0);
  });

  it("is a no-op on the activity table", () => {
    // `activity` carries no workout reference and belongs to the user, not the session
    expect(countOf("activity")).toBe(1);
  });
});
```

Write `countOf` as a small local helper running `SELECT COUNT(*) FROM <table>`.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/db/discard-workout.test.ts`
Expected: FAIL, `discardWorkout` is not exported.

- [ ] **Step 3: Write the delete**

Add to `src/lib/db/workout.ts`, beside `finishWorkout`:

```ts
/**
 * Delete a workout and everything logged under it. The app's one surgical destructive
 * operation — `$lib/server/admin-reset.ts` wipes a whole account, and nothing else
 * removes a logged row at all.
 *
 * A hard delete rather than a "discarded" status, deliberately. A soft-deleted row has
 * to be filtered by every reader — `logsForPlan`, and through it the export, history and
 * progress — and the one reader that forgets feeds discarded data to the reviewing AI
 * with nothing to catch it. There is no filter to forget when the rows are gone.
 *
 * `metric_value` is deleted first and by two paths, because a `scope: 'set'` metric
 * references its `set_log` and not the workout: deleting the sets first would orphan it.
 *
 * Returns whether anything was deleted. `false` is a normal outcome, not an error — a
 * discard op replayed twice, or one whose workout never reached this server at all,
 * both land here (see `$lib/sync/replay.ts`).
 */
export function discardWorkout(userDb: UserDb, workoutClientId: string): boolean {
  const workoutId = selectByClientId(userDb, "workout", workoutClientId);
  if (!workoutId) return false;

  userDb.db
    .transaction(() => {
      userDb.db
        .prepare(
          `DELETE FROM metric_value
           WHERE workout_id = ?
              OR set_log_id IN (SELECT id FROM set_log WHERE workout_id = ?)`,
        )
        .run(workoutId, workoutId);
      userDb.db.prepare("DELETE FROM deviation WHERE workout_id = ?").run(workoutId);
      userDb.db.prepare("DELETE FROM set_log WHERE workout_id = ?").run(workoutId);
      userDb.db.prepare("DELETE FROM workout WHERE id = ?").run(workoutId);
    })
    .immediate();

  return true;
}
```

Confirm against `src/lib/db/schema.ts` that `metric_value` really does carry both `workout_id` and `set_log_id`, and that no sixth table references `workout_id`. If a table has appeared that this misses, add it here and add a test case for it.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/db/discard-workout.test.ts`
Expected: PASS, all five cases.

- [ ] **Step 5: Verify and commit**

```bash
npx prettier --write src/lib/db/workout.ts tests/db/discard-workout.test.ts
npm run verify > /tmp/verify.log 2>&1; echo "exit=$status"; tail -40 /tmp/verify.log
git add src/lib/db/workout.ts tests/db/discard-workout.test.ts
git commit -m "feat(db): delete a workout and everything logged under it

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The discard sync op

**Files:**
- Modify: `src/lib/sync/ops.ts`
- Modify: `src/lib/sync/replay.ts`
- Test: `tests/sync/replay.test.ts` (extend — check the real filename in `tests/sync/` first)

**Interfaces:**
- Consumes: `discardWorkout` from Task 4.
- Produces: `DiscardOp = { kind: "discard"; id: string; workoutClientId: string }`, a member of `SyncOp`.

- [ ] **Step 1: Write the failing tests**

Add to the replay test file:

```ts
describe("replaying a discard op", () => {
  it("deletes the workout and reports it applied", () => {
    // replay a start + two sets, then a discard
    const ack = replayOps(userDb, [{ kind: "discard", id: newOpId(), workoutClientId }]);
    expect(ack.applied).toEqual([expect.any(String)]);
    expect(ack.failed).toEqual([]);
    expect(ack.pending).toEqual([]);
    expect(resolveWorkoutIdByClientId(userDb, workoutClientId)).toBeUndefined();
  });

  it("reports applied for a workout the server has never seen", () => {
    // The critical case. The client purges the workout's ops — the `start` among them —
    // before enqueueing the discard, so there is no start op behind it and never will
    // be. `NotYetError` here would retry an unsatisfiable op until it quarantined, which
    // is the permanent-failure trap CLAUDE.md's offline section describes.
    const ack = replayOps(userDb, [
      { kind: "discard", id: newOpId(), workoutClientId: "01JNEVERSYNCEDXXXXXXXXXXXX" },
    ]);
    expect(ack.applied).toHaveLength(1);
    expect(ack.pending).toEqual([]);
    expect(ack.failed).toEqual([]);
  });

  it("is idempotent across a replay of the same op", () => {
    const op = { kind: "discard" as const, id: newOpId(), workoutClientId };
    replayOps(userDb, [op]);
    expect(replayOps(userDb, [op]).applied).toHaveLength(1);
  });

  it("discards a workout whose start op is in the same batch", () => {
    // Ordered by ULID, so the start lands first and the discard undoes it. Odd, but it
    // must not fail: an offline user who logs a set and immediately discards produces
    // exactly this batch.
    const ack = replayOps(userDb, [startOp, setOp, discardOp]);
    expect(ack.failed).toEqual([]);
    expect(resolveWorkoutIdByClientId(userDb, startOp.workoutClientId)).toBeUndefined();
  });
});
```

Also add a schema test asserting `syncOpSchema` accepts a discard op and rejects one with an extra property (the union is built from `z.strictObject`).

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/sync/`
Expected: FAIL — `"discard"` is not a member of the discriminated union.

- [ ] **Step 3: Add the op**

In `src/lib/sync/ops.ts`, after `finishOpSchema`:

```ts
/**
 * Throw a workout away. Carries nothing but the workout it names: a delete has no
 * payload, and no timestamp is wanted — unlike `startedAt` and `finishedAt`, nothing
 * downstream records *when* a discard happened, because the row it describes will not
 * exist to carry it.
 */
const discardOpSchema = z.strictObject({
  kind: z.literal("discard"),
  id: opId,
  workoutClientId: opId,
});
```

Add it to the union and export the type:

```ts
export const syncOpSchema = z.discriminatedUnion("kind", [
  startOpSchema,
  setOpSchema,
  metricOpSchema,
  deviationOpSchema,
  finishOpSchema,
  discardOpSchema,
  activityOpSchema,
]);

export type DiscardOp = z.infer<typeof discardOpSchema>;
```

- [ ] **Step 4: Add the replay case**

In `src/lib/sync/replay.ts`, import `discardWorkout` from `../db/workout` and add the case before `activity`:

```ts
    case "discard":
      /**
       * The one op whose missing workout is **success, not `NotYetError`**.
       *
       * Every other workout-scoped op calls `requireWorkout` and stays pending when the
       * workout is absent, because the `start` op is still behind it in the queue. A
       * discard has no start behind it: the client purges every op for that workout,
       * the start included, before enqueueing this one. Waiting for a start that was
       * deleted means retrying forever and quarantining an op whose whole job is to make
       * data not exist — the exact permanent-failure trap CLAUDE.md's offline section
       * describes. "Nothing to delete" means the job is done.
       *
       * Deliberately does *not* go through `requireWorkout`. If a later refactor
       * consolidates these two for consistency, this breaks silently.
       */
      discardWorkout(userDb, op.workoutClientId);
      return;
```

The `default:` exhaustiveness guard will now compile again with seven kinds; leave its comment's "sixth" wording updated to "seventh".

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run tests/sync/`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

```bash
npx prettier --write src/lib/sync/ops.ts src/lib/sync/replay.ts tests/sync/
npm run verify > /tmp/verify.log 2>&1; echo "exit=$status"; tail -40 /tmp/verify.log
git add src/lib/sync/ops.ts src/lib/sync/replay.ts tests/sync/
git commit -m "feat(sync): add a discard op whose missing workout is success

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Purge the outbox, and the client's discard entry point

**Files:**
- Modify: `src/lib/sync/queue.ts` (the `OutboxStore` interface)
- Modify: `src/lib/sync/idb.ts` (the implementation)
- Modify: `src/lib/sync/client.svelte.ts`
- Test: `tests/sync/queue.test.ts` (extend — check the real filename first)

**Interfaces:**
- Consumes: `DiscardOp` and `newOpId` from Task 5.
- Produces:
  - `OutboxStore.dropForWorkout(workoutClientId: string): Promise<void>`
  - `discardWorkout(planSlug: string, workoutClientId: string): Promise<void>` from `$lib/sync/client.svelte`
  - `pendingDiscardIds(): Promise<string[]>` from `$lib/sync/client.svelte` — the `workoutClientId` of every discard op still queued.

- [ ] **Step 1: Write the failing test**

The existing queue tests drive a fake `OutboxStore`; extend that fake with `dropForWorkout` and add:

```ts
describe("dropForWorkout", () => {
  it("removes pending and quarantined records alike for that workout", async () => {
    // A quarantined op is held, never dropped (ARCHITECTURE §4) — but "held" means held
    // until the person whose data it is decides otherwise, and discarding the workout it
    // belongs to is exactly that decision. Leaving it would keep the quarantine banner
    // up for a workout that no longer exists.
    await store.dropForWorkout(workoutClientId);
    expect(await store.counts()).toEqual({ pending: 0, quarantined: 0 });
  });

  it("leaves another workout's records alone", async () => {
    await store.dropForWorkout(workoutClientId);
    expect((await store.forWorkout(otherClientId))).toHaveLength(2);
  });

  it("leaves activity ops alone, which carry no workoutClientId", async () => {
    await store.dropForWorkout(workoutClientId);
    expect((await store.pending()).filter((op) => op.kind === "activity")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/sync/`
Expected: FAIL, `dropForWorkout` is not a function.

- [ ] **Step 3: Add it to the interface**

In `src/lib/sync/queue.ts`, inside `OutboxStore`:

```ts
  /**
   * Drop every record for one workout, pending and quarantined alike. Called only when
   * the user discards that workout.
   *
   * Its own method rather than a `forWorkout` + `ack` composition at the call site,
   * because `ack` means "the server confirmed this" and every reader of that call would
   * have to know it was being told a lie here.
   *
   * Quarantined records go too. "Held, never dropped" means held until the person whose
   * data it is decides otherwise (ARCHITECTURE §4), and discarding the workout is that
   * decision — a quarantined op for a workout that no longer exists could only keep the
   * banner up forever.
   */
  dropForWorkout(workoutClientId: string): Promise<void>;
```

- [ ] **Step 4: Implement it on IndexedDB**

In `src/lib/sync/idb.ts`, beside `forWorkout`:

```ts
    async dropForWorkout(workoutClientId: string): Promise<void> {
      const store = tx(db, "readwrite");
      const index = store.index("workoutClientId");
      const records = await run(index.getAll(workoutClientId) as IDBRequest<OutboxRecord[]>);
      // Every `delete` is issued before the first `await` that follows, for the same
      // reason `ack` does it: they must land on this one transaction.
      await Promise.all(records.map((record) => run(store.delete(record.op.id))));
    },
```

Check in `open()` that the `workoutClientId` index really is defined on the store and that a `readwrite` transaction can read through it — if the index was created `unique: false` on the op record, this is fine as written.

- [ ] **Step 5: Add the client entry points**

In `src/lib/sync/client.svelte.ts`, beside `discardQuarantined`:

```ts
/**
 * Throw an unfinished workout away, from Home.
 *
 * Order matters. The purge runs **first**, so the workout's own `start` op cannot reach
 * the server after the discard has already deleted the row it would recreate. The
 * discard op then goes out to erase whatever had already synced; the server treats a
 * workout it has never heard of as already discarded (`$lib/sync/replay.ts`), which is
 * what makes the purge-first order safe for a workout that never synced at all.
 *
 * The `localStorage` resume pointer is the caller's to clear — this module owns the
 * outbox, and `$lib/session/workout-storage.ts` owns that key.
 */
export async function discardWorkout(planSlug: string, workoutClientId: string): Promise<void> {
  const outbox = await store();
  await outbox.dropForWorkout(workoutClientId);
  await outbox.append({ kind: "discard", id: newOpId(), workoutClientId });
  await refreshCounts();
  void flushNow(planSlug);
}

/**
 * The workouts with a discard still queued. Home filters these out of what the server
 * reported: until the op syncs, the server still has the row and would keep rendering a
 * card for a workout the user has already thrown away. Self-healing — once the op is
 * acked it leaves the outbox, and by then the server has stopped reporting the workout
 * too.
 */
export async function pendingDiscardIds(): Promise<string[]> {
  const ops = await (await store()).pending();
  return ops.filter((op) => op.kind === "discard").map((op) => op.workoutClientId);
}
```

Import `newOpId` from `./ops` if it is not already imported there.

- [ ] **Step 6: Run the tests and verify they pass**

Run: `npx vitest run tests/sync/`
Expected: PASS.

- [ ] **Step 7: Verify and commit**

```bash
npx prettier --write src/lib/sync/queue.ts src/lib/sync/idb.ts src/lib/sync/client.svelte.ts tests/sync/
npm run verify > /tmp/verify.log 2>&1; echo "exit=$status"; tail -40 /tmp/verify.log
git add src/lib/sync/queue.ts src/lib/sync/idb.ts src/lib/sync/client.svelte.ts tests/sync/
git commit -m "feat(sync): purge a discarded workout's ops before queueing the discard

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The unfinished-session model, including the offline-only case

Home is server-rendered, so a session logged in a garage and never synced is invisible to the query from Task 3. This task adds the `localStorage` fallback and the merge, as pure functions.

**Files:**
- Modify: `src/lib/session/workout-storage.ts` (key parsing and enumeration)
- Create: `src/lib/home/unfinished.ts` (the merge)
- Test: `tests/session/workout-storage.test.ts` (extend or create)
- Test: `tests/home/unfinished.test.ts` (create)

**Interfaces:**
- Consumes: `isResumable` and `workoutStartedAtMs` (Task 2), `OpenWorkoutRef` (Task 3).
- Produces:
  - `parseWorkoutStorageKey(key: string): { planSlug: string; sessionKey: string } | undefined`
  - `listStoredWorkouts(storage?): { planSlug: string; sessionKey: string; workoutClientId: string }[]`
  - `type UnfinishedSession = { workoutClientId: string; planSlug: string; sessionKey: string; startedAt: string; setCount: number | undefined; resumable: boolean }`
  - `mergeUnfinished(input): UnfinishedSession[]`

- [ ] **Step 1: Write the failing tests for key parsing**

```ts
describe("parseWorkoutStorageKey", () => {
  it("splits the prefix, plan slug and session key", () => {
    expect(parseWorkoutStorageKey("gain:workout:home-training:A")).toEqual({
      planSlug: "home-training",
      sessionKey: "A",
    });
  });

  it("returns undefined for a key that is not ours", () => {
    expect(parseWorkoutStorageKey("gain:theme")).toBeUndefined();
    expect(parseWorkoutStorageKey("sveltekit:something")).toBeUndefined();
  });

  it("returns undefined for a malformed key rather than guessing", () => {
    expect(parseWorkoutStorageKey("gain:workout:only-three")).toBeUndefined();
    expect(parseWorkoutStorageKey("gain:workout:a:b:c")).toBeUndefined();
    expect(parseWorkoutStorageKey("gain:workout::A")).toBeUndefined();
  });

  it("round-trips with workoutStorageKey", () => {
    expect(parseWorkoutStorageKey(workoutStorageKey("home-training", "D"))).toEqual({
      planSlug: "home-training",
      sessionKey: "D",
    });
  });
});

describe("listStoredWorkouts", () => {
  it("returns every stored pointer", () => {
    const storage = fakeStorage({
      "gain:workout:p:A": "01JAAA0000000000000000000A",
      "gain:workout:p:B": "01JBBB0000000000000000000B",
      "gain:theme": "dark",
    });
    expect(listStoredWorkouts(storage)).toHaveLength(2);
  });

  it("returns nothing when localStorage is unavailable", () => {
    // SSR, and a browser with storage disabled. Both callers are render paths.
    expect(listStoredWorkouts(undefined)).toEqual([]);
  });

  it("skips a key whose value is empty", () => {
    expect(listStoredWorkouts(fakeStorage({ "gain:workout:p:A": "" }))).toEqual([]);
  });
});
```

Write `fakeStorage` as a small local helper implementing `length`, `key(i)` and `getItem`.

- [ ] **Step 2: Run and verify they fail**

Run: `npx vitest run tests/session/workout-storage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement key parsing**

In `src/lib/session/workout-storage.ts`:

```ts
/**
 * The inverse of `workoutStorageKey`. Neither a plan slug nor a session key may contain
 * a colon, so a well-formed key is exactly four segments and anything else is a key that
 * is not ours, or one a future format wrote. Both get `undefined` rather than a guess —
 * a wrongly-parsed key would render a card pointing at a session that does not exist.
 */
export function parseWorkoutStorageKey(
  key: string,
): { planSlug: string; sessionKey: string } | undefined {
  if (!key.startsWith(WORKOUT_KEY_PREFIX)) return undefined;
  const parts = key.split(":");
  if (parts.length !== 4) return undefined;
  const [, , planSlug, sessionKey] = parts;
  if (!planSlug || !sessionKey) return undefined;
  return { planSlug, sessionKey };
}

/**
 * Every workout this device has a resume pointer for. Home's fallback for the case the
 * server cannot see: a session logged offline whose ops have not synced yet, which is
 * this app's core scenario rather than an edge one.
 *
 * Iterates upwards — unlike `clearWorkoutStorage`, nothing is removed here, so the
 * reindexing that forces that function to count down does not apply.
 */
export function listStoredWorkouts(
  storage: Storage | undefined = globalThis.localStorage,
): { planSlug: string; sessionKey: string; workoutClientId: string }[] {
  if (!storage) return [];
  const found: { planSlug: string; sessionKey: string; workoutClientId: string }[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key === null) continue;
    const parsed = parseWorkoutStorageKey(key);
    if (!parsed) continue;
    const workoutClientId = storage.getItem(key);
    if (!workoutClientId) continue;
    found.push({ ...parsed, workoutClientId });
  }
  return found;
}
```

- [ ] **Step 4: Write the failing tests for the merge**

Create `tests/home/unfinished.test.ts`:

```ts
import { ulidAt } from "../helpers/ulid-at";

const NOW = new Date("2026-09-19T20:00:00.000Z");
const FRESH = ulidAt(NOW.getTime() - 60 * 60 * 1000);
const STALE = ulidAt(NOW.getTime() - 30 * 60 * 60 * 1000);

describe("mergeUnfinished", () => {
  it("marks a workout inside the window resumable", () => { /* ... */ });
  it("marks a workout past the window not resumable", () => { /* ... */ });

  it("includes a local-only workout the server has never seen", () => {
    // Logged offline, not yet synced. Without this the first load after a garage
    // session shows nothing, which is the whole scenario the card exists for.
    const merged = mergeUnfinished({
      server: [],
      local: [{ planSlug: "p", sessionKey: "A", workoutClientId: FRESH }],
      pendingDiscards: [],
      now: NOW,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.setCount).toBeUndefined();
  });

  it("prefers the server's record when both sources have the same workout", () => {
    // The server knows the set count; the pointer does not.
    expect(merged[0]?.setCount).toBe(3);
  });

  it("does not duplicate a workout present in both sources", () => {
    expect(merged).toHaveLength(1);
  });

  it("omits a workout with a discard still queued", () => {
    // The op has not synced, so the server still reports the row. Rendering a card for
    // a workout the user already discarded would look like the discard failed.
    expect(mergeUnfinished({ server: [open], local: [], pendingDiscards: [open.workoutClientId], now: NOW }))
      .toEqual([]);
  });

  it("orders newest first", () => { /* two workouts, assert order */ });

  it("drops a local pointer whose client id is not a ULID", () => {
    // Nothing can be said about its age, so nothing honest can be rendered for it.
    expect(mergeUnfinished({ server: [], local: [{ planSlug: "p", sessionKey: "A", workoutClientId: "junk" }], pendingDiscards: [], now: NOW }))
      .toEqual([]);
  });
});
```

Reuse the `ulidAt` helper from Task 2's test — move it to `tests/helpers/` so both files import it rather than defining it twice.

- [ ] **Step 5: Run and verify they fail**

Run: `npx vitest run tests/home/unfinished.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 6: Write the merge**

Create `src/lib/home/unfinished.ts`:

```ts
/**
 * What Home knows about unfinished sessions, from the two sources that each know half.
 *
 * The server (`openWorkoutsForPlan`, `$lib/db/home.ts`) is the source of truth and the
 * only one that knows a set count, but it cannot see a session logged offline whose ops
 * have not synced. The device's `localStorage` resume pointers cover exactly that gap —
 * and only that gap, since a pointer is written the moment a workout's first op commits.
 *
 * Pure, and `now` is injected, so the same inputs give the same answer during SSR and
 * after hydration.
 */

import { isResumable, workoutStartedAtMs } from "../session/workout-age";
import type { OpenWorkoutRef } from "../db/home";

export type UnfinishedSession = {
  workoutClientId: string;
  planSlug: string;
  sessionKey: string;
  /** ISO timestamp. From the server's column where it has one, else decoded from the
   * client id's ULID — the same instant either way, since the runner mints that id at
   * mount and the `start` op carries it as `startedAt`. */
  startedAt: string;
  /** `undefined` for a workout only the local pointer knows about: the count lives in
   * the database, and this one has not reached it. The card renders no count rather
   * than a wrong "0 sets" for a session with three in the queue. */
  setCount: number | undefined;
  resumable: boolean;
};

export type MergeInput = {
  server: readonly (OpenWorkoutRef & { planSlug: string })[];
  local: readonly { planSlug: string; sessionKey: string; workoutClientId: string }[];
  /** Workouts with a discard op still queued (`pendingDiscardIds`). */
  pendingDiscards: readonly string[];
  now: Date;
};

export function mergeUnfinished({
  server,
  local,
  pendingDiscards,
  now,
}: MergeInput): UnfinishedSession[] {
  const discarded = new Set(pendingDiscards);
  const byId = new Map<string, UnfinishedSession>();

  for (const row of server) {
    if (discarded.has(row.workoutClientId)) continue;
    byId.set(row.workoutClientId, {
      workoutClientId: row.workoutClientId,
      planSlug: row.planSlug,
      sessionKey: row.sessionKey,
      startedAt: row.startedAt,
      setCount: row.setCount,
      resumable: isResumable(row.workoutClientId, now),
    });
  }

  for (const pointer of local) {
    if (discarded.has(pointer.workoutClientId)) continue;
    // The server's record wins: it is the same workout, and only it knows the set count.
    if (byId.has(pointer.workoutClientId)) continue;
    const startedAtMs = workoutStartedAtMs(pointer.workoutClientId);
    // An id whose age cannot be read supports no honest claim — not a start time, not a
    // resumability verdict. Better to say nothing than to render a guess.
    if (startedAtMs === undefined) continue;
    byId.set(pointer.workoutClientId, {
      workoutClientId: pointer.workoutClientId,
      planSlug: pointer.planSlug,
      sessionKey: pointer.sessionKey,
      startedAt: new Date(startedAtMs).toISOString(),
      setCount: undefined,
      resumable: isResumable(pointer.workoutClientId, now),
    });
  }

  return [...byId.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
```

- [ ] **Step 7: Run and verify they pass**

Run: `npx vitest run tests/home/unfinished.test.ts tests/session/workout-storage.test.ts`
Expected: PASS.

- [ ] **Step 8: Verify and commit**

```bash
npx prettier --write src/lib/home/unfinished.ts src/lib/session/workout-storage.ts tests/home/unfinished.test.ts tests/session/workout-storage.test.ts
npm run verify > /tmp/verify.log 2>&1; echo "exit=$status"; tail -40 /tmp/verify.log
git add src/lib/home/unfinished.ts src/lib/session/workout-storage.ts tests/
git commit -m "feat(home): merge the server's and the device's view of unfinished sessions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The Home card and the discard sheet

**Files:**
- Create: `src/routes/UnfinishedSessionCard.svelte`
- Create: `src/routes/DiscardSessionSheet.svelte`
- Modify: `src/routes/+page.server.ts` (load `openWorkoutsForPlan`)
- Modify: `src/routes/+page.svelte` (merge, and choose replace vs. stack)
- Modify: `src/routes/NextSessionCard.svelte` (make `SessionOverrideList` renderable from either parent)

**Interfaces:**
- Consumes: `openWorkoutsForPlan` (Task 3), `mergeUnfinished` / `UnfinishedSession` (Task 7), `listStoredWorkouts` (Task 7), `discardWorkout` and `pendingDiscardIds` from `$lib/sync/client.svelte` (Task 6), `clearWorkoutStorage`'s sibling `workoutStorageKey` (existing).
- Produces: nothing later tasks consume.

- [ ] **Step 1: Read the three sheets before writing one**

Read `src/routes/plan/[slug]/session/[key]/DeviationSheet.svelte` and `WrapUpSheet.svelte`, plus `src/lib/actions/focus-trap.ts`. `DiscardSessionSheet` copies that pattern exactly: `max-height` with `overflow-y`, `env(safe-area-inset-bottom)`, focus on open and returned on close, focus trapped while open, Escape to close. Do not invent a different sheet.

- [ ] **Step 2: Load the open workouts**

In `src/routes/+page.server.ts`, inside the `overviews` map, add to each plan's object:

```ts
        openWorkouts: openWorkoutsForPlan(userDb, plan.id),
```

Import `openWorkoutsForPlan` alongside the existing `recentWorkoutsForPlan` import. Also return a `nowIso: new Date().toISOString()` beside the existing `todayDate`, so the merge has a server clock during SSR for the same reason `lastDoneLabel` takes `todayDate`.

- [ ] **Step 3: Write the card**

Create `src/routes/UnfinishedSessionCard.svelte`. Two shapes, chosen by `session.resumable`:

```svelte
<script lang="ts">
  import IconPlay from "~icons/lucide/play";
  import IconTrash2 from "~icons/lucide/trash-2";
  import Button from "$lib/components/Button.svelte";
  import { lastDoneLabel } from "$lib/home/last-done";
  import type { UnfinishedSession } from "$lib/home/unfinished";

  /**
   * One unfinished session, on Home.
   *
   * Inside the resume window this replaces `NextSessionCard` for its plan (the parent
   * decides), so it carries the plan name and is handed the override picker to render —
   * hiding the only session picker on the screen would make "I will do B tonight" a dead
   * end. Outside the window it is a slim notice above the normal card, and Resume is
   * gone: appending today's sets to a days-old workout puts a multi-day duration in the
   * export (`$lib/session/workout-age.ts`).
   *
   * `--amber` rather than the accent: this is outside the session runner, where UI §5's
   * accent-only rule does not apply and amber carries its ordinary "warning" sense.
   * Muted, not an alarm. `--red` belongs on the confirmation, not here.
   */
  let {
    session,
    planName,
    todayDate,
    onDiscard,
    picker,
  }: {
    session: UnfinishedSession;
    planName: string | undefined;
    todayDate: string;
    onDiscard: () => void;
    picker?: import("svelte").Snippet;
  } = $props();

  const setLabel = $derived(
    session.setCount === undefined
      ? "not yet synced"
      : `${session.setCount} ${session.setCount === 1 ? "set" : "sets"} logged`,
  );
</script>
```

Markup: when `session.resumable`, a full card with `planName`, the session key badge and "in progress", `setLabel` plus `lastDoneLabel(session.startedAt.slice(0, 10), todayDate)`, a primary `<a class="start-link" href={`/plan/${session.planSlug}/session/${session.sessionKey}?resume=${session.workoutClientId}`}>` labelled "Resume {key}", a secondary Discard `<Button variant="quiet" onclick={onDiscard}>`, then `{@render picker?.()}`. When not resumable, a slim notice: the key, "left unfinished", `setLabel`, the date, and Discard only — no `planName`, no picker.

Reuse `NextSessionCard`'s `.card`, `.plan-name`, `.suggested-key` and `.start-link` styles rather than inventing new ones; copy them across and adjust rather than importing, matching how the other Home components are written.

- [ ] **Step 4: Write the confirmation sheet**

Create `src/routes/DiscardSessionSheet.svelte`, modelled on `DeviationSheet.svelte`. It names what dies and says it is permanent:

> **Discard session A?**
> This permanently deletes the 3 sets you logged. It cannot be undone.
> [Cancel] [Discard session]

The confirm button is `<Button variant="danger">`. When `setCount` is `undefined`, the body reads "This permanently deletes everything you logged in this session." — never a count the card does not have.

Props: `{ session: UnfinishedSession; onCancel: () => void; onConfirm: () => void }`.

- [ ] **Step 5: Wire it into Home**

In `src/routes/+page.svelte`:

```svelte
  // Server rows plus this device's own pointers. `$state` seeded in `$effect` rather than
  // at the top level: `listStoredWorkouts` and `pendingDiscardIds` both need the browser,
  // and the server's rows alone are the correct SSR render.
  let unfinished = $state<UnfinishedSession[]>(
    untrack(() => serverOnlyUnfinished(data)),
  );

  $effect(() => {
    void (async () => {
      unfinished = mergeUnfinished({
        server: serverRows(data),
        local: listStoredWorkouts(),
        pendingDiscards: await pendingDiscardIds(),
        now: new Date(),
      });
    })();
  });
```

`serverRows(data)` flattens each plan's `openWorkouts` into `OpenWorkoutRef & { planSlug }`. `serverOnlyUnfinished(data)` is the same thing through `mergeUnfinished` with empty `local`/`pendingDiscards` and `new Date(data.nowIso)`.

Then, per plan:

```svelte
{@const open = unfinished.filter((u) => u.planSlug === plan.slug)}
{@const resuming = open.find((u) => u.resumable)}

{#each open.filter((u) => !u.resumable) as session (session.workoutClientId)}
  <UnfinishedSessionCard {session} planName={undefined} todayDate={data.todayDate}
    onDiscard={() => (confirming = session)} />
{/each}

{#if resuming}
  <UnfinishedSessionCard session={resuming} planName={plan.name} todayDate={data.todayDate}
    onDiscard={() => (confirming = resuming)}>
    {#snippet picker()}
      <SessionOverrideList planSlug={plan.slug} suggestedKey={plan.suggestion.suggestedKey}
        sessions={plan.sessions} todayDate={data.todayDate}
        schedulingRules={plan.schedulingRules} dropOrder={plan.dropOrder} />
    {/snippet}
  </UnfinishedSessionCard>
{:else}
  <NextSessionCard ... />
{/if}
```

Note `{@const}` is only legal as the first child of a block — put these inside the existing `{#each data.plans as plan}`.

Discard handler:

```svelte
  async function confirmDiscard(session: UnfinishedSession) {
    confirming = undefined;
    // Optimistic: the server still has the row until the op syncs, and `mergeUnfinished`
    // will filter it on the next load via `pendingDiscardIds`. Removing it here is what
    // makes the tap feel like it did something while offline.
    unfinished = unfinished.filter((u) => u.workoutClientId !== session.workoutClientId);
    localStorage.removeItem(workoutStorageKey(session.planSlug, session.sessionKey));
    await discardWorkout(session.planSlug, session.workoutClientId);
    await invalidateAll();
  }
```

Import `invalidateAll` from `$app/navigation`.

- [ ] **Step 6: Make the picker renderable from either parent**

`SessionOverrideList` is currently rendered inside `NextSessionCard`. Leave that as-is — the snippet above constructs a second instance with the same props. Confirm its props in `src/routes/SessionOverrideList.svelte` match what the snippet passes; adjust the snippet, not the component.

- [ ] **Step 7: Check it in a browser**

There is no display here, so follow CLAUDE.md's recipe: write a throwaway `e2e/tmp-unfinished.spec.ts` that seeds a plan, logs two sets, navigates to `/`, and calls `page.screenshot()`. Run `npx playwright test --project=iphone e2e/tmp-unfinished.spec.ts` and Read the image. Check both shapes (fresh and aged-out) and that nothing overflows at 360px. **Delete the throwaway spec before committing.**

- [ ] **Step 8: Verify and commit**

```bash
npx prettier --write src/routes/UnfinishedSessionCard.svelte src/routes/DiscardSessionSheet.svelte src/routes/+page.svelte src/routes/+page.server.ts
npm run verify > /tmp/verify.log 2>&1; echo "exit=$status"; tail -40 /tmp/verify.log
git status --short   # confirm no e2e/tmp-*.spec.ts is staged
git add src/routes/
git commit -m "feat(home): surface an unfinished session with resume and discard

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Resume by id, and refuse to resume a stale workout

Two runner fixes Resume cannot ship without.

**Files:**
- Modify: `src/routes/plan/[slug]/session/[key]/+page.svelte:132-200`
- Test: covered by Task 10's e2e (the logic here is two calls into already-tested pure code)

**Interfaces:**
- Consumes: `isResumable` (Task 2).
- Produces: the route accepts `?resume=<workoutClientId>`.

- [ ] **Step 1: Adopt the id from the query string**

In the mount `$effect`, replace the `existing` lookup:

```ts
      /**
       * `?resume=` is Home's Resume link. Adopting the id it names, rather than minting a
       * fresh one, is what stops Resume forking: on a device that never held this
       * workout's pointer the runner would otherwise start a *second* workout for the
       * same session, splitting one session's effort across two rows in the export.
       */
      const requested = page.url.searchParams.get("resume");
      const stored = typeof localStorage !== "undefined" ? localStorage.getItem(storageKey) : null;
      const candidate = requested ?? stored;
```

Import `page` from `$app/state` if it is not already imported (check which of `$app/state` / `$app/stores` this codebase uses elsewhere and match it).

- [ ] **Step 2: Gate the candidate on age**

```ts
      /**
       * A pointer older than the resume window is not resumed. Appending today's sets to
       * a days-old workout makes the export report a multi-day session duration
       * (`completed_at - started_at`, `$lib/export/bundle.ts`) — a wrong number reaching
       * the reviewing AI, which nothing downstream can catch. Past the window the user
       * gets a genuinely new workout, and the old one stays on Home as a discardable
       * notice.
       */
      const resumed = candidate !== null && isResumable(candidate, new Date());
      clientId = resumed ? candidate : newOpId();

      // A pointer we are declining to resume must go, or the next visit re-reads it and
      // the fresh workout started here is orphaned behind a stale key.
      if (!resumed && stored !== null && typeof localStorage !== "undefined") {
        localStorage.removeItem(storageKey);
      }
```

The rest of the effect is unchanged: `if (!resumed)` arms the deferred start (which rewrites the key on commit), and `if (resumed)` hydrates. The pre-session metric gate already keys on `!resumed`, so an aged-out session correctly asks its `prompt_when: start` metrics again.

- [ ] **Step 3: Confirm the null-vs-empty handling**

`localStorage.getItem` returns `null` for a missing key; `searchParams.get` returns `null` too. `candidate` is therefore `string | null`, and `isResumable` takes a `string` — the `candidate !== null &&` guard is what narrows it. Do not replace it with a truthiness check that would also swallow an empty string differently from how Task 7's `listStoredWorkouts` does.

- [ ] **Step 4: Verify**

```bash
npx prettier --write "src/routes/plan/[slug]/session/[key]/+page.svelte"
npm run verify > /tmp/verify.log 2>&1; echo "exit=$status"; tail -40 /tmp/verify.log
```

- [ ] **Step 5: Commit**

```bash
git add "src/routes/plan/[slug]/session/[key]/+page.svelte"
git commit -m "fix(session): resume by id, and never resume past the window

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: End-to-end proof, online and offline

**Files:**
- Create: `e2e/unfinished-session.spec.ts`
- Create: `e2e/offline-discard.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Read the helpers before writing a locator**

Read `e2e/helpers.ts` and `e2e/seed.ts`. Reuse `seedFixturePlan`, `openExercise`, `logSet`, `workoutClientId`, `setLogsOf`, `workoutCountFor`, `outboxRecords` and `assertNoHorizontalOverflow`. Do not re-derive the gestures.

- [ ] **Step 2: Write the online walkthrough**

Create `e2e/unfinished-session.spec.ts`:

```ts
test("an abandoned session is surfaced, resumable, and discardable", async ({ page }) => {
  // 1. Start session A, log two sets, leave without finishing.
  // 2. Go to "/". Assert the card is there and names the set count:
  //      await expect(page.getByText("2 sets logged")).toBeVisible();
  //    Assert on the count, never on the card's container — every shell in this app
  //    renders unconditionally (CLAUDE.md), so a container assertion passes with no data.
  // 3. Assert the rotation did NOT advance: the Resume link points at A.
  //      await expect(page.getByRole("link", { name: /Resume A/ })).toBeVisible();
  // 4. Assert NextSessionCard is gone — the resume card replaced it.
  //      await expect(page.getByRole("link", { name: /^Start / })).toHaveCount(0);
  // 5. Assert the override picker survived the replacement.
  //      await expect(page.getByRole("button", { name: /different session/i })).toBeVisible();
  // 6. Resume. Assert the ledger came back with both sets, and that no second workout
  //    row was minted: expect(workoutCountFor(clientId)).toBe(1);
  // 7. Back to "/", open the discard sheet, confirm.
  // 8. Assert the card is gone and the rows are gone:
  //      expect(setLogsOf(clientId)).toHaveLength(0);
  //      expect(workoutCountFor(clientId)).toBe(0);
  // 9. await assertNoHorizontalOverflow(page);
});

test("a session older than the resume window offers only discard", async ({ page }) => {
  // Seed a workout directly with a started_at 30 hours ago AND a client_id whose ULID
  // encodes that same time — `isResumable` reads the id, not the column, so a mismatched
  // pair would test nothing. Use encodeTime from ulidx to build it.
  // Assert: "left unfinished" is visible, Discard is visible, no Resume link,
  //         and the normal NextSessionCard IS present below it.
});

test("starting a session past the window mints a new workout", async ({ page }) => {
  // Same seed, plus the stale localStorage pointer. Navigate to the session, log a set,
  // and assert two workout rows exist for session A — the stale one and the new one.
});
```

- [ ] **Step 3: Run it**

Run: `npx playwright test --project=iphone e2e/unfinished-session.spec.ts`
Expected: PASS. If a spec fails, read `test-results/<test>/error-context.md` before reaching for a trace — a component throwing at runtime appears there as the runner's own error alert, which the timeout message never names.

- [ ] **Step 4: Write the offline spec**

Create `e2e/offline-discard.spec.ts`. This one must run in the `offline` project, which builds and serves a real `node build` — `$service-worker`'s precache manifest is empty under `vite dev`, so no offline spec can pass there.

```ts
test("discarding offline purges locally and replays on reconnect", async ({ page, context }) => {
  // 1. Online: start A, log two sets, wait for the outbox to drain.
  // 2. Go offline.
  // 3. Home, discard, confirm. Assert the card disappears immediately.
  // 4. Assert the outbox holds exactly one op for that workout, and it is the discard —
  //    the purge removed the rest:
  //      const records = await outboxRecords(page);
  //      expect(records.filter((r) => r.op.workoutClientId === clientId).map((r) => r.op.kind))
  //        .toEqual(["discard"]);
  // 5. Reload while still offline. Assert the card stays gone — `pendingDiscardIds`
  //    filters the row the server still has.
  // 6. Go back online, wait for the flush.
  // 7. expect(workoutCountFor(clientId)).toBe(0);
  // 8. Assert nothing quarantined: the sync banner shows no quarantine notice and
  //    outboxRecords is empty for that workout.
});

test("discarding a session that never synced leaves nothing behind", async ({ page, context }) => {
  // Go offline BEFORE starting. Start A, log a set, discard. Reconnect.
  // The discard op reaches a server that never heard of this workout — the case that
  // would quarantine forever if replay threw NotYetError.
  // Assert: expect(workoutCountFor(clientId)).toBe(0); and nothing is quarantined.
});
```

- [ ] **Step 5: Run the offline spec**

Run: `npx playwright test --project=offline e2e/offline-discard.spec.ts`
Expected: PASS. Note this project pays for a full production build — if a run is killed, `ss -ltnp | grep -E '4319|4320'` names the pid still holding the port.

- [ ] **Step 6: Run the whole suite**

```bash
npm run verify > /tmp/verify.log 2>&1; echo "exit=$status"; tail -40 /tmp/verify.log
npx playwright test > /tmp/e2e.log 2>&1; echo "exit=$status"; tail -60 /tmp/e2e.log
```

Both must pass. `e2e/home-walkthrough.spec.ts` and `e2e/session-runner-resume.spec.ts` are the two most likely to have been broken by Tasks 1 and 8 — if either fails, it is a real regression, not a stale assertion to relax.

- [ ] **Step 7: Commit**

```bash
git add e2e/unfinished-session.spec.ts e2e/offline-discard.spec.ts
git commit -m "test(e2e): walk resume and discard for an unfinished session

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Fold the durable half in, and delete the tracking docs

CLAUDE.md's "Tracking work, and folding it back in": the spec and this plan are deleted in the same commit that lands the durable reasoning in the standing documents.

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§9)
- Modify: `docs/UI.md`
- Modify: `CLAUDE.md` (Invariants)
- Delete: `docs/superpowers/specs/2026-09-19-unfinished-session-resume-design.md`
- Delete: `docs/superpowers/plans/2026-09-19-unfinished-session.md`

- [ ] **Step 1: ARCHITECTURE §9, "Home"**

Add: the rotation cursor reads finished workouts only (`completed_at NOT NULL`, any status), so an abandoned session never advances it at any age, and that this is the same predicate `consistency.ts` and `session-stats.ts` use.

- [ ] **Step 2: ARCHITECTURE §9, "Resuming a workout"**

Add: the twelve-hour gate on the `localStorage` pointer and on `?resume=`, with the reason — session duration is `completed_at - started_at`, so a stale resume puts a multi-day figure in the export. Note that the age is read from the workout's ULID `client_id`, which is what lets client and server agree without a round trip.

- [ ] **Step 3: UI — a new numbered section for the Home card**

Write it as prose arguing the case, matching the surrounding document rather than bulleting it. Cover: the card replaces the next-session suggestion inside the window and coexists with it outside; why that asymmetry exists (with the card persisting until discarded, hiding the picker at every age would make an irreversible delete the only way to train again); why the override picker moves rather than disappearing; and that `--amber` here is correct rather than an exception, because §5's accent-only rule is about the session runner.

- [ ] **Step 4: CLAUDE.md Invariants — the one that breaks quietly**

Add an entry: **a discard op's missing workout is success, not `NotYetError`.** Every other workout-scoped op stays pending when its workout is absent because the start op is still behind it; a discard has no start behind it, because the client purges the workout's ops before enqueueing it. Routing it through `requireWorkout` "for consistency" would retry an unsatisfiable op until it quarantined — and a quarantined discard is an op the user can never clear, for a workout they already deleted.

- [ ] **Step 5: Module doc comments**

- `src/lib/session/workout-storage.ts` — that a pointer is now age-gated, and points at `workout-age.ts`.
- `src/lib/sync/replay.ts` — the discard case's comment from Task 5 is the home for that reasoning; confirm it survived review intact.

- [ ] **Step 6: Check the standing docs still describe the app**

Re-read ARCHITECTURE §5's bullet on `workout` having no in-progress state. It is still true and still correct — confirm the new text does not contradict it.

- [ ] **Step 7: Delete both tracking docs and commit**

```bash
git rm docs/superpowers/specs/2026-09-19-unfinished-session-resume-design.md
git rm docs/superpowers/plans/2026-09-19-unfinished-session.md
npm run verify > /tmp/verify.log 2>&1; echo "exit=$status"; tail -40 /tmp/verify.log
git add docs/ARCHITECTURE.md docs/UI.md CLAUDE.md
git commit -m "docs: settle unfinished-session resume and discard

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
