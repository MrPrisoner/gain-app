/**
 * Task 12 (docs/superpowers/sdd/2026-08-10-phase-4-remediation): the plan's closing,
 * durable regression spec for Session D — the ranged-set/optional-third case and the
 * two-round abdominal finisher, walked end-to-end in one browser session rather than in
 * the isolated pieces `session-runner-exercise-state.spec.ts` and
 * `session-runner-resume.spec.ts` already cover.
 *
 * What this test covers: `db-floor-press`'s ranged `sets: [2, 3]` — log the declared
 * minimum, tap "Add the optional set" for the third (UI-DECISIONS §6) —,
 * `supported-one-arm-row`'s own ranged/per-side sets, both rounds of the `ab-finisher`
 * rounds block, and — the load-bearing case this whole task exists to re-prove — the
 * conditional `reverse-crunch` taken **as a substitute**, specifically swapped to
 * `dead-bug`. `ab-finisher` prescribes `dead-bug` directly *and* offers it as
 * `reverse-crunch`'s substitute in the same block (fixtures/plans/home-dumbbell-v1.md,
 * `ab-finisher`), which is exactly the same-block-slug-collision case Task 5's
 * `setLogKey`-pinned-to-the-prescribed-slug fix and Task 6's resume matching were built
 * to handle (Bug 3/8 in the review, `docs/superpowers/sdd/2026-08-10-phase-4-remediation/task-12-brief.md`).
 * The database is queried directly afterwards to confirm the logged rows carry the
 * substitute's `exercise_def_id` (`dead-bug`'s), not the original `reverse-crunch`'s —
 * `set_log` has no notion of "which prescribed slot" a row came from, so the assertion
 * below both counts every `dead-bug` row (prescribed + substitute, 8 total) and confirms
 * zero rows exist for `reverse-crunch` at all, which is the thing that would be true if
 * the old bug (logging the original after a swap) had regressed.
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth setup here.
 */

import { expect, test, type Page } from "@playwright/test";
import { E2E_PLAN_SLUG, seededDataDir } from "./env";
import { dismissPreSessionPrompt } from "./helpers";
import { openSeededUserDb } from "./seed";

/** The exercise row currently expanded — there is exactly one (UI-DECISIONS §1). */
function openExercise(page: Page) {
  return page.locator(".exercise.open");
}

/** Taps the strip's Medium key and waits for the round trip to settle. */
async function logSet(page: Page): Promise<void> {
  const context = page.locator(".log-strip .strip-set");
  const before = await context.innerText();
  await page.locator('.log-strip button[value="medium"]').click();
  await expect(context).not.toHaveText(before);
}

/** Logs a set and clears whatever rest overlay it fires. A `type: rounds` block (the
 * abdominal finisher) never fires a per-set rest (only between rounds), so this is a
 * no-op there — used uniformly anyway so callers don't need to know which block they're
 * in. */
async function logSetThroughRest(page: Page): Promise<void> {
  await logSet(page);
  const rest = page.locator(".rest-overlay");
  if (await rest.isVisible()) {
    await rest.getByRole("button", { name: "Start next set" }).click();
    await expect(rest).toHaveCount(0);
  }
}

/** Skips the currently open exercise via the deviation sheet's default gesture. Used
 * here to move quickly through the main-block exercises this spec's assertions are not
 * about, so the exercises that *are* the point (the ranged sets, the per-side row) don't
 * drown in five more identical set-logging loops. */
async function skipCurrent(page: Page): Promise<void> {
  await page.locator(".log-strip .strip-change").click();
  const sheet = page.locator(".sheet");
  await expect(sheet).toBeVisible();
  await sheet.locator("button[type=submit]").click();
  await expect(sheet).toHaveCount(0);
}

async function workoutClientId(page: Page, sessionKey: string): Promise<string> {
  const key = `gain:workout:${E2E_PLAN_SLUG}:${sessionKey}`;
  const clientId = await page.evaluate((k) => sessionStorage.getItem(k), key);
  expect(clientId, "the runner must have stored a workout client_id").toBeTruthy();
  return clientId as string;
}

type SetLogRow = { set_no: number; side: string | null; slug: string };

/** Every `set_log` row of one workout, in insertion order, with its exercise's slug. */
function setLogsOf(clientId: string): SetLogRow[] {
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

test("Session D end-to-end: ranged optional third, the two-round abdominal finisher, the reverse-crunch swap", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/D`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  // --- Main, exercise 1: Goblet squat — not this spec's concern, skip it to keep
  // Session D's own walkthrough focused on the ranged/per-side/finisher cases below. ---
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Goblet squat");
  await skipCurrent(page);

  // --- Main, exercise 2: Dumbbell floor press — the ranged-set case: `sets: [2, 3]`.
  // "Add the optional set" is offered from the start (the minimum is drawn, but the plan
  // already declared a possible 3rd) — taken *before* logging, because taking it only
  // after the declared minimum's 2nd set would be too late: that set already satisfies
  // "finished", so its rest overlay auto-advances straight past this exercise the moment
  // it is dismissed (UI-DECISIONS §1), before there is any chance to tap the button. ---
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Dumbbell floor press");
  await expect(openExercise(page).locator(".ledger-row")).toHaveCount(2);
  await expect(openExercise(page).getByRole("button", { name: "Add the optional set" })).toBeVisible();
  await openExercise(page).getByRole("button", { name: "Add the optional set" }).click();
  await expect(openExercise(page).locator(".ledger-row")).toHaveCount(3);
  await logSetThroughRest(page); // set 1
  await logSetThroughRest(page); // set 2
  await logSetThroughRest(page); // the optional 3rd set

  // --- Main, exercise 3: Supported one-arm row — also ranged (`sets: [2, 3]`) and
  // per_side; the base 2 sets (4 slots) are logged here without the optional 3rd, since
  // the optional-third case is already exercised above. ---
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Supported one-arm row");
  for (let i = 0; i < 4; i++) await logSetThroughRest(page);

  // --- The rest of `main` is not this spec's concern — skip through to the finisher. ---
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Reverse lunge");
  await skipCurrent(page);
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Lateral raise");
  await skipCurrent(page);
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Hammer curl");
  await skipCurrent(page);
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Overhead triceps extension");
  await skipCurrent(page);

  // --- Abdominal finisher: `type: rounds, rounds: 2`. Round 1. ---
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Dead bug");
  await expect(page.locator(".log-strip .strip-set")).toContainText("Round 1 of 2");
  await logSetThroughRest(page); // left
  await logSetThroughRest(page); // right

  await expect(openExercise(page).locator(".exercise-name")).toHaveText("McGill curl-up");
  await logSetThroughRest(page);
  await logSetThroughRest(page);

  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Side plank");
  await logSetThroughRest(page);
  await logSetThroughRest(page);

  // The conditional reverse-crunch, taken as a substitute: swapped to `dead-bug`
  // specifically (not `front-plank`) — `ab-finisher` also prescribes `dead-bug` directly
  // three rows above, so this exercises the exact same-block-slug-collision case Task
  // 5/6 were built to handle, not just a generic swap.
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Reverse crunch");
  await expect(openExercise(page).locator(".condition")).toContainText("familiar back symptoms");
  await openExercise(page).getByRole("button", { name: "Swap: dead-bug" }).click();
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Dead bug");
  await expect(openExercise(page)).toContainText("Swapped in for Reverse crunch");
  // `dead-bug` is per_side where `reverse-crunch` is not — the ledger re-shaped around
  // the substitute's own shape, not the original's.
  await expect(openExercise(page).locator(".ledger-row")).toHaveCount(2);
  await logSetThroughRest(page); // left
  await logSetThroughRest(page); // right

  // Round 1 is fully logged; move to round 2. `ab-finisher` also declares a
  // between-round `rest_sec: [45, 60]`, so this fires its own rest overlay — dismissed
  // by hand, same as every per-set rest above.
  await page.getByRole("button", { name: /^Round 1 of 2 done$/ }).click();
  const betweenRoundsRest = page.locator(".rest-overlay");
  await expect(betweenRoundsRest).toBeVisible();
  await betweenRoundsRest.getByRole("button", { name: "Start next set" }).click();
  await expect(betweenRoundsRest).toHaveCount(0);

  await expect(page.locator(".rounds-indicator")).toHaveAttribute(
    "aria-label",
    "1 of 2 rounds complete",
  );
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Dead bug");
  await expect(page.locator(".log-strip .strip-set")).toContainText("Round 2 of 2");

  // --- Round 2 — the substitute is already applied (state carries across rounds), so
  // Reverse crunch's slot reopens as Dead bug directly, with no need to swap again. ---
  await logSetThroughRest(page);
  await logSetThroughRest(page);

  await expect(openExercise(page).locator(".exercise-name")).toHaveText("McGill curl-up");
  await logSetThroughRest(page);
  await logSetThroughRest(page);

  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Side plank");
  await logSetThroughRest(page);
  await logSetThroughRest(page);

  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Dead bug");
  await expect(openExercise(page)).toContainText("Swapped in for Reverse crunch");
  await logSetThroughRest(page);
  await logSetThroughRest(page);

  // --- The load-bearing check: query the database directly. ---
  const clientId = await workoutClientId(page, "D");
  const db = openSeededUserDb(seededDataDir());
  let deadBugRows: SetLogRow[];
  let reverseCrunchCount: number;
  try {
    deadBugRows = db
      .prepare(
        `SELECT s.set_no AS set_no, s.side AS side, e.slug AS slug
         FROM set_log s
         JOIN exercise_def e ON e.id = s.exercise_def_id
         JOIN workout w ON w.id = s.workout_id
         WHERE w.client_id = ? AND e.slug = 'dead-bug'
         ORDER BY s.id`,
      )
      .all(clientId) as SetLogRow[];
    const { n } = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM set_log s
         JOIN exercise_def e ON e.id = s.exercise_def_id
         JOIN workout w ON w.id = s.workout_id
         WHERE w.client_id = ? AND e.slug = 'reverse-crunch'`,
      )
      .get(clientId) as { n: number };
    reverseCrunchCount = n;
  } finally {
    db.close();
  }

  // 4 rows from the block's own directly-prescribed `dead-bug` (2 rounds × L/R) plus 4
  // from the swapped-in substitute (2 rounds × L/R) — every set logged against the
  // substitute really did land on `dead-bug`'s `exercise_def_id`.
  expect(deadBugRows).toHaveLength(8);
  // And critically: nothing was ever logged against the original `reverse-crunch` — the
  // old bug (Bug 3, task-12-brief.md) kept posting `exercise_slug=reverse-crunch` after a
  // swap; this is the row-level proof that regression has not come back.
  expect(
    reverseCrunchCount,
    "no set_log row may carry reverse-crunch's exercise_def_id — every logged set went to the substitute",
  ).toBe(0);

  // The full ordered ledger corroborates it: the two `dead-bug` pairs that follow
  // `side-plank` in each round are exactly the ones the swap produced.
  expect(setLogsOf(clientId)).toEqual([
    { set_no: 1, side: null, slug: "db-floor-press" },
    { set_no: 2, side: null, slug: "db-floor-press" },
    { set_no: 3, side: null, slug: "db-floor-press" },
    { set_no: 1, side: "left", slug: "supported-one-arm-row" },
    { set_no: 1, side: "right", slug: "supported-one-arm-row" },
    { set_no: 2, side: "left", slug: "supported-one-arm-row" },
    { set_no: 2, side: "right", slug: "supported-one-arm-row" },
    // round 1
    { set_no: 1, side: "left", slug: "dead-bug" }, // prescribed directly
    { set_no: 1, side: "right", slug: "dead-bug" },
    { set_no: 1, side: "left", slug: "mcgill-curl-up" },
    { set_no: 1, side: "right", slug: "mcgill-curl-up" },
    { set_no: 1, side: "left", slug: "side-plank" },
    { set_no: 1, side: "right", slug: "side-plank" },
    { set_no: 1, side: "left", slug: "dead-bug" }, // the reverse-crunch substitute
    { set_no: 1, side: "right", slug: "dead-bug" },
    // round 2
    { set_no: 2, side: "left", slug: "dead-bug" },
    { set_no: 2, side: "right", slug: "dead-bug" },
    { set_no: 2, side: "left", slug: "mcgill-curl-up" },
    { set_no: 2, side: "right", slug: "mcgill-curl-up" },
    { set_no: 2, side: "left", slug: "side-plank" },
    { set_no: 2, side: "right", slug: "side-plank" },
    { set_no: 2, side: "left", slug: "dead-bug" }, // the reverse-crunch substitute
    { set_no: 2, side: "right", slug: "dead-bug" },
  ]);

  // --- Wrap-up. ---
  await page.getByRole("button", { name: "End session" }).click();
  const symptoms = page.locator("fieldset", { hasText: "Lower-back symptoms during session" });
  await expect(symptoms).toBeVisible();
  await symptoms.getByRole("button", { name: "3", exact: true }).click();
  await expect(symptoms.locator(".scale-cell.selected")).toHaveText("3");

  await page.getByRole("button", { name: "Finish session" }).click();
  await page.waitForURL(/\/$/);
  await expect(page.getByRole("heading", { name: "4-Week Home Dumbbell Training Plan" })).toBeVisible();
});
