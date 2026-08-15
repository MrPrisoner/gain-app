/**
 * Shared e2e helpers — the gestures and queries more than one spec needs.
 *
 * Everything here was independently reimplemented across the spec files first (four
 * copies of `openExercise`, four of `logSet`, three of `logSetThroughRest`, three of
 * `workoutClientId` and `setLogsOf`, two of `assertNoHorizontalOverflow`), which the
 * final whole-branch review promoted from a string of deferred minor findings to one
 * real one: the `setLogsOf` copies had already drifted into two different return types.
 * A helper with two shapes is two helpers, and the second one is the bug.
 *
 * Pre-session metrics (ARCHITECTURE §9, UI-DECISIONS §8): a
 * genuinely fresh workout opens on the pre-session metrics prompt before the runner
 * itself (`.log-strip`, `.exercise-head`, …) becomes visible at all — a *resumed* workout
 * (`page.reload()` within a test, which lands back on the same `client_id`) skips this
 * gate, since the `?/start` response carries `hydration` in that case and the runner
 * shows straight away. Every spec that navigates fresh to a session must dismiss this
 * gate before asserting on anything inside the runner.
 */

import { expect, type Page } from "@playwright/test";
import { E2E_PLAN_SLUG, seededDataDir } from "./env";
import { openSeededUserDb } from "./seed";

export async function dismissPreSessionPrompt(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Continue to session" }).click();
}

/** The exercise row currently expanded — there is exactly one (UI-DECISIONS §1). */
export function openExercise(page: Page) {
  return page.locator(".exercise.open");
}

/**
 * Taps the strip's Medium key and waits for the round trip to settle. The strip's context
 * line names exactly what the *next* tap writes, so it always changes once a set lands —
 * whether the cursor moved within the exercise or auto-advance moved to the next one.
 *
 * This leaves any rest overlay the set fired standing; use `logSetThroughRest` when the
 * next thing the spec does is tap the strip again.
 */
export async function logSet(page: Page): Promise<void> {
  const context = page.locator(".log-strip .strip-set");
  const before = await context.innerText();
  await page.locator('.log-strip button[data-difficulty="medium"]').click();
  await expect(context).not.toHaveText(before);
}

/**
 * Logs a set and clears whatever rest overlay it fired, so the strip is tappable again —
 * most sets in this fixture declare `rest_sec`, so this is the routine path through a
 * whole walkthrough. A `type: rounds` block (the abdominal finisher) fires no per-set
 * rest, so the dismissal is a no-op there; used uniformly anyway so callers don't need to
 * know which block they're in.
 */
export async function logSetThroughRest(page: Page): Promise<void> {
  await logSet(page);
  const rest = page.locator(".rest-overlay");
  if (await rest.isVisible()) {
    await rest.getByRole("button", { name: "Start next set" }).click();
    await expect(rest).toHaveCount(0);
  }
}

/**
 * Taps the wrap-up sheet's Finish, clears the celebration screen that follows, and waits
 * for the home screen. Every spec that finishes a session goes through here, so the shape
 * of the ending is asserted in one place rather than three that can drift apart.
 *
 * Note what this proves incidentally: the finish op is written *before* the celebration is
 * shown, so a spec that never dismissed it would still find the workout complete in the
 * database. The celebration is a moment, never a step.
 */
export async function finishSession(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Finish session" }).click();
  const celebration = page.locator(".celebrate-card");
  await expect(celebration).toBeVisible();
  await celebration.getByRole("button", { name: "Back to home" }).click();
  await page.waitForURL(/\/$/);
}

/** The workout's `client_id` — the page mints it and keeps it in `localStorage` (design
 * spec §7: it must survive a browser kill, which `sessionStorage` cannot), and it is the
 * only handle a spec has on *its own* workout in the shared database. */
export async function workoutClientId(page: Page, sessionKey: string): Promise<string> {
  const key = `gain:workout:${E2E_PLAN_SLUG}:${sessionKey}`;
  const clientId = await page.evaluate((k) => localStorage.getItem(k), key);
  expect(clientId, "the runner must have stored a workout client_id").toBeTruthy();
  return clientId as string;
}

export type SetLogRow = { set_no: number; side: string | null; slug: string };

/**
 * Every `set_log` row of one workout, in insertion order, with its exercise's slug. `id`
 * is a ULID, so ordering by it is ordering by creation time.
 *
 * Returns the rows and nothing else. The resume spec's copy used to wrap them in
 * `{ workouts, sets }` so it could also assert that a reload had not started a *second*
 * workout — that is a different question about a different table, and it now has its own
 * helper (`workoutCountFor`) rather than a second return shape for this one.
 */
export function setLogsOf(clientId: string): SetLogRow[] {
  const db = openSeededUserDb(seededDataDir());
  try {
    return db
      .prepare(
        `SELECT s.set_no AS set_no, s.side AS side, e.slug AS slug
         FROM set_log s
         JOIN exercise_def e ON e.id = s.exercise_def_id
         JOIN workout w ON w.id = s.workout_id
         WHERE w.client_id = ?
         ORDER BY s.id`,
      )
      .all(clientId) as SetLogRow[];
  } finally {
    db.close();
  }
}

/** The workout's `status` — `completed` for a normal finish, `stopped` for a red flag.
 * Lives here rather than in the one spec that needs it for the reason this file's own
 * header gives: a second copy of a database query is how two of them end up disagreeing. */
export function workoutStatusOf(clientId: string): string | undefined {
  const db = openSeededUserDb(seededDataDir());
  try {
    const row = db.prepare("SELECT status FROM workout WHERE client_id = ?").get(clientId) as
      { status: string } | undefined;
    return row?.status;
  } finally {
    db.close();
  }
}

/** How many `workout` rows carry this `client_id` — one, always, is the whole point of
 * resume (ARCHITECTURE §9): a reload must land back on the workout it left, not start
 * another. */
export function workoutCountFor(clientId: string): number {
  const db = openSeededUserDb(seededDataDir());
  try {
    const { n } = db
      .prepare("SELECT COUNT(*) AS n FROM workout WHERE client_id = ?")
      .get(clientId) as {
      n: number;
    };
    return n;
  } finally {
    db.close();
  }
}

export type ActivityRow = { kind: string; occurred_at: string };

/** Every logged activity, most-recent-first — mirrors `setLogsOf`'s direct-read shape. */
export function activitiesOf(): ActivityRow[] {
  const db = openSeededUserDb(seededDataDir());
  try {
    return db
      .prepare("SELECT kind, occurred_at FROM activity ORDER BY occurred_at DESC")
      .all() as ActivityRow[];
  } finally {
    db.close();
  }
}

/** `document.documentElement.scrollWidth` must never exceed `window.innerWidth` — the
 * one assertion behind every "no horizontal overflow" test, in the base runner, in each
 * `position: fixed` overlay, and in both theme forcings. */
export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const innerWidth = await page.evaluate(() => window.innerWidth);
  expect(scrollWidth, "no horizontal overflow, ever").toBeLessThanOrEqual(innerWidth);
}

/**
 * Waits until `url` is sitting in some Cache Storage entry (phase 6, design spec §7) —
 * the service worker's own precache is fire-and-forget from the page's side
 * (`precacheSessions` posts a message and returns; there is no response channel telling
 * the caller when `cache.addAll` actually finishes), so an offline test that goes
 * offline immediately after navigating to the plan overview would otherwise race the
 * worker's own `cache.addAll` and flake. Cache name isn't known here (it's
 * version-keyed, computed only inside the worker), so this checks every cache rather
 * than assuming which one.
 */
export async function waitForPrecached(page: Page, url: string): Promise<void> {
  await page.waitForFunction(async (targetUrl: string) => {
    for (const name of await caches.keys()) {
      if (await (await caches.open(name)).match(targetUrl)) return true;
    }
    return false;
  }, url);
}
