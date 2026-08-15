/**
 * Phase 4's "done when" (ARCHITECTURE §12), as a durable regression spec for Session D
 * — the ranged/optional-set case, a prescription-level substitute with no `conditional`
 * flag, and the two-round abdominal finisher, walked end-to-end in one browser session
 * rather than in the isolated pieces `session-runner-exercise-state.spec.ts` and
 * `session-runner-resume.spec.ts` already cover.
 *
 * What this test covers: Goblet squat's ranged `sets: [2, 3]` together with its
 * prescription-level `substitutes: [bodyweight-squat]` — swapped via the deviation
 * sheet's general "Swap" path rather than the inline chip, since this substitute has no
 * `conditional` flag to trigger that chip (UI-DECISIONS: the inline swap only renders
 * for a conditional exercise; the sheet's own substitute option does not care) — then
 * "Add the optional set" taken against the substitute itself, proving the ranged-set
 * range survives a swap. Dumbbell floor press's own ranged sets are logged at the
 * declared minimum without touching the optional third, since that mechanism is already
 * exercised above. Then both rounds of the `ab-finisher` rounds block, and — the
 * load-bearing case this whole task exists to re-prove — the conditional `reverse-crunch`
 * taken as a substitute, specifically swapped to `dead-bug`. `ab-finisher` prescribes
 * `dead-bug` directly *and* offers it as `reverse-crunch`'s substitute in the same block
 * (`fixtures/plans/home-training-v1.md`, `ab-finisher`), which is exactly the
 * same-block-slug-collision case that `setLogKey`'s pinning to the prescribed slug, and
 * the resume matching in `$lib/session/resume.ts`, were built to handle (ARCHITECTURE §5
 * and §9). Neither `dead-bug` nor `reverse-crunch` is `per_side` in this fixture, so both
 * of a round's `dead-bug` rows land on the same `set_no` with no `side` to tell them
 * apart except insertion order — an even sharper version of the collision than a
 * per-side movement would give.
 *
 * The database is queried directly afterwards to confirm the logged rows carry the
 * substitute's `exercise_def_id` (`dead-bug`'s), not the original `reverse-crunch`'s —
 * `set_log` has no notion of "which prescribed slot" a row came from, so the assertion
 * below both counts every `dead-bug` row (prescribed + substitute, 4 total) and confirms
 * zero rows exist for `reverse-crunch` at all, which is the thing that would be true if
 * the old bug (logging the original after a swap) had regressed.
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth setup here.
 */

import { expect, test, type Page } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import {
  dismissPreSessionPrompt,
  finishSession,
  logSetThroughRest,
  openExercise,
  setLogsOf,
  workoutClientId,
} from "./helpers";

/** Skips the currently open exercise via the deviation sheet's default gesture. Used
 * here to move quickly through the main-block exercises this spec's assertions are not
 * about, so the exercises that *are* the point (the ranged/substituted squat, the
 * finisher) don't drown in more identical set-logging loops. */
async function skipCurrent(page: Page): Promise<void> {
  await page.locator(".log-strip .strip-change").click();
  const sheet = page.locator(".sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toHaveCount(0);
}

/**
 * Taps the strip's Medium key inside the `ab-finisher` rounds block, without
 * `logSetThroughRest`'s "the context line changes" wait: `formatSlotContext` names a
 * rounds block's slot by round number alone (`$lib/session/session-view.ts`), with no
 * exercise name and no `per_side` suffix — none of this fixture's finisher exercises are
 * `per_side` — so "Round 1 of 2" reads identically before and after every tap within the
 * same round. That is correct app behaviour, not a bug; the caller's own next-state
 * assertion (the exercise that's about to auto-advance into view, or the ledger row that
 * just landed) is the wait condition instead — `submitEffort` (`LogStrip.svelte`) awaits
 * the write before either one changes, so both are just as safe a signal.
 */
async function tapMedium(page: Page): Promise<void> {
  await page.locator('.log-strip button[data-difficulty="medium"]').click();
}

test("Session D end-to-end: a ranged set surviving a substitute, the two-round abdominal finisher, the reverse-crunch swap", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/D`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  // --- Main, exercise 1: Goblet squat — ranged `sets: [2, 3]` and a prescription-level
  // `substitutes: [bodyweight-squat]` with no `conditional` flag, so the swap has to come
  // from the deviation sheet's "Swap" option rather than the inline chip. ---
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Goblet squat");
  await expect(openExercise(page).locator(".ledger-row")).toHaveCount(2);

  await page.locator(".log-strip .strip-change").click();
  const swapSheet = page.locator(".sheet");
  await expect(swapSheet).toBeVisible();
  await swapSheet.getByRole("radio", { name: "Swap" }).check();
  await swapSheet.locator("select").selectOption("bodyweight-squat");
  await swapSheet.getByRole("button", { name: "Save" }).click();
  await expect(swapSheet).toHaveCount(0);

  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Bodyweight squat");
  await expect(openExercise(page)).toContainText("Swapped in for Goblet squat");

  // The ranged range is the prescription's, not the exercise's — it survives the swap.
  await expect(openExercise(page).locator(".ledger-row")).toHaveCount(2);
  await expect(
    openExercise(page).getByRole("button", { name: "Add the optional set" }),
  ).toBeVisible();
  await openExercise(page).getByRole("button", { name: "Add the optional set" }).click();
  await expect(openExercise(page).locator(".ledger-row")).toHaveCount(3);
  await logSetThroughRest(page); // set 1
  await logSetThroughRest(page); // set 2
  await logSetThroughRest(page); // the optional 3rd set

  // --- Main, exercise 2: Dumbbell floor press — also ranged (`sets: [2, 3]`); the base 2
  // sets are logged here without the optional 3rd, since that mechanism is already
  // exercised above. ---
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Dumbbell floor press");
  await logSetThroughRest(page);
  await logSetThroughRest(page);

  // --- The rest of `main` is not this spec's concern — skip through to the finisher. ---
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Prone dumbbell row");
  await skipCurrent(page);
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Hammer curl");
  await skipCurrent(page);
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Lying triceps extension");
  await skipCurrent(page);

  // --- Abdominal finisher: `type: rounds, rounds: 2`. Round 1. Neither Dead bug nor
  // McGill curl-up is per_side in this fixture, so each is a single set per round. ---
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Dead bug");
  await expect(page.locator(".log-strip .strip-set")).toContainText("Round 1 of 2");
  await tapMedium(page);
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("McGill curl-up");

  await tapMedium(page);

  // The conditional reverse-crunch, taken as a substitute: swapped to `dead-bug`
  // specifically (not `front-plank`) — `ab-finisher` also prescribes `dead-bug` directly
  // two rows above, so this exercises the exact same-block-slug-collision case Task
  // 5/6 were built to handle, not just a generic swap.
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Reverse crunch");
  await expect(openExercise(page).locator(".condition")).toContainText(
    "familiar hip or lower-back symptoms",
  );
  await openExercise(page).getByRole("button", { name: "Swap: dead-bug" }).click();
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Dead bug");
  await expect(openExercise(page)).toContainText("Swapped in for Reverse crunch");

  await tapMedium(page);
  // Nothing left to advance to within round 1 (`+page.svelte`'s `advance()`: "nothing
  // left means nothing moves"), so the exercise stays open showing its own logged row —
  // that is this tap's wait condition, in place of a context line that cannot change.
  await expect(openExercise(page).locator(".ledger-row.logged")).toHaveCount(1);

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
  await tapMedium(page);
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("McGill curl-up");

  await tapMedium(page);
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Dead bug");
  await expect(openExercise(page)).toContainText("Swapped in for Reverse crunch");

  await tapMedium(page);
  // Round 2 is the last round — nothing left to advance to at all, so this is the same
  // "stays open, own row logged" wait as round 1's last tap.
  await expect(openExercise(page).locator(".ledger-row.logged")).toHaveCount(1);

  // --- The load-bearing check: query the database directly. ---
  const clientId = await workoutClientId(page, "D");
  // `setLogsOf` already returns this workout's rows in insertion order with their slugs;
  // the two counts below are a filter over that, not two more bespoke queries.
  const rows = setLogsOf(clientId);
  const deadBugRows = rows.filter((row) => row.slug === "dead-bug");
  const reverseCrunchCount = rows.filter((row) => row.slug === "reverse-crunch").length;

  // 2 rows from the block's own directly-prescribed `dead-bug` (2 rounds × 1, not
  // per-side) plus 2 from the swapped-in substitute (2 rounds × 1) — every set logged
  // against the substitute really did land on `dead-bug`'s `exercise_def_id`.
  expect(deadBugRows).toHaveLength(4);
  // And critically: nothing was ever logged against the original `reverse-crunch` — the
  // old bug (Bug 3, task-12-brief.md) kept posting `exercise_slug=reverse-crunch` after a
  // swap; this is the row-level proof that regression has not come back.
  expect(
    reverseCrunchCount,
    "no set_log row may carry reverse-crunch's exercise_def_id — every logged set went to the substitute",
  ).toBe(0);

  // The full ordered ledger corroborates it: the two `dead-bug` rows that follow
  // `mcgill-curl-up` in each round are exactly the ones the swap produced, landing on the
  // same `set_no` as the round's directly-prescribed `dead-bug` with no `side` to tell
  // them apart except order.
  expect(setLogsOf(clientId)).toEqual([
    { set_no: 1, side: null, slug: "bodyweight-squat" },
    { set_no: 2, side: null, slug: "bodyweight-squat" },
    { set_no: 3, side: null, slug: "bodyweight-squat" },
    { set_no: 1, side: null, slug: "db-floor-press" },
    { set_no: 2, side: null, slug: "db-floor-press" },
    // round 1
    { set_no: 1, side: null, slug: "dead-bug" }, // prescribed directly
    { set_no: 1, side: null, slug: "mcgill-curl-up" },
    { set_no: 1, side: null, slug: "dead-bug" }, // the reverse-crunch substitute
    // round 2
    { set_no: 2, side: null, slug: "dead-bug" },
    { set_no: 2, side: null, slug: "mcgill-curl-up" },
    { set_no: 2, side: null, slug: "dead-bug" },
  ]);

  // --- Wrap-up. ---
  await page.getByRole("button", { name: "End session" }).click();
  const symptoms = page.locator("fieldset", {
    hasText: "Hip / lower-back symptoms during this session",
  });
  await expect(symptoms).toBeVisible();
  await symptoms.getByRole("button", { name: "3", exact: true }).click();
  await expect(symptoms.locator(".scale-cell.selected")).toHaveText("3");

  await finishSession(page);
  await expect(page.getByRole("heading", { name: "Home Training Plan" })).toBeVisible();
});
