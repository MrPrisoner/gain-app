/**
 * UI-DECISIONS §1 and §7: the exercise state
 * machine — UI-DECISIONS §1 (completion state and auto-advance), §6 (a substitute is a
 * real swap), §7 (deviation is one tap away, and it *does* something).
 *
 * Each of these asserts on the thing that could silently rot back to the old behaviour:
 *
 * 1. **Auto-advance** — finishing an exercise opens the next one. Before the phase-4
 *    review's rebuild, the list
 *    just sat there and you hunted for the next row one-handed.
 * 2. **A swap actually substitutes** — this is the one that corrupts the export rather
 *    than merely annoying the user. Before the rebuild, tapping "Swap: dead-bug" on the
 *    conditional reverse-crunch logged the deviation and then kept posting
 *    `exercise_slug=reverse-crunch`, so the file said you did the movement the plan told
 *    you to avoid. Phase 6 moved the write off the network entirely (`logWrite` appends
 *    straight to the IndexedDB outbox), so this now asserts on the database row the set
 *    actually produced once it syncs, rather than on a POST body — a stronger check of
 *    the same property, since it proves the data that reaches the export, not just an
 *    outgoing request.
 * 3. **A skip actually skips** — before the rebuild it wrote a deviation row and left the
 *    exercise expanded and fully loggable.
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth setup here.
 */

import { expect, test, type Page } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import {
  dismissPreSessionPrompt,
  logSet,
  logSetThroughRest,
  openExercise,
  setLogsOf,
  workoutClientId,
} from "./helpers";

/** Opens a collapsed row by its rendered name. */
async function open(page: Page, name: string): Promise<void> {
  await page.locator(".exercise-head", { hasText: name }).first().click();
  await expect(openExercise(page).locator(".exercise-name")).toHaveText(name);
}

test("finishing an exercise opens the next one in prescribed order", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/D`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  // The abdominal finisher is a `type: rounds` block, so no per-set rest fires and the
  // advance is immediate — the rest-gated path is covered by `advanceAfterRest` in the
  // runner and would only add flake here.
  await open(page, "Dead bug");
  // Alternating sides within the set, not `per_side`, so one round is a single slot — and
  // since the block's round number doesn't advance until every exercise in the round is
  // done, the strip's context text stays "Round 1 of 2" across this click (`logSet`'s
  // usual "context changed" check does not hold here), so this taps the strip directly
  // and asserts on the exercise that opens next instead.
  await page.locator('.log-strip button[data-difficulty="medium"]').click();

  await expect(openExercise(page).locator(".exercise-name")).toHaveText("McGill curl-up");
  // The finished exercise collapsed to what it actually was, not to its target.
  const deadBug = page.locator(".exercise", { hasText: "Dead bug" }).first();
  await expect(deadBug).toHaveClass(/done/);
  await expect(deadBug.locator(".exercise-meta")).not.toHaveText("1 × 8 per side");
});

test("a swap logs against the substitute, not the movement it replaced", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/D`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  await open(page, "Reverse crunch");
  await expect(openExercise(page).locator(".condition")).toContainText(
    "familiar hip or lower-back symptoms",
  );
  await openExercise(page).getByRole("button", { name: "Swap: dead-bug" }).click();

  // The row renames itself to the movement now being performed, and says which prescribed
  // slot it is filling.
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Dead bug");
  await expect(openExercise(page)).toContainText("Swapped in for Reverse crunch");
  // A `rounds` block only ever shows the current round's row, and neither `dead-bug` nor
  // `reverse-crunch` is `per_side` — one row, the substitute's own, not a repainted label
  // over the original's.
  await expect(openExercise(page).locator(".ledger-row")).toHaveCount(1);
  await expect(page.locator(".log-strip .strip-exercise")).toHaveText("Dead bug");

  const clientId = await workoutClientId(page, "D");
  await logSet(page);

  // The database row — not just the rendered label — carries the substitute's slug: the
  // check that catches the export writing "you did the movement the plan told you to
  // avoid."
  expect(
    setLogsOf(clientId).map((row) => row.slug),
    "the set must be recorded against the substitute",
  ).toEqual(["dead-bug"]);
});

test("a skip collapses the exercise, says so, and advances", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Goblet squat");

  await page.locator(".log-strip .strip-change").click();
  // `kind` defaults to skip and `reason_code` to Symptoms, so Save is the whole gesture.
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();

  const squat = page.locator(".exercise", { hasText: "Goblet squat" }).first();
  await expect(squat.locator(".exercise-meta")).toHaveText("Skipped");
  await expect(squat).not.toHaveClass(/open/);
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Dumbbell floor press");
});

/**
 * The completion mark, in all three places it appears. It is one indicator on purpose —
 * a checked-off warm-up pill and a finished working exercise used to say "done" in two
 * unrelated visual languages (an accent fill on one, a font-weight shift on the other),
 * and the fix is only a fix for as long as they stay the same mark. Asserting on
 * `.exercise-status svg` rather than on a class is deliberate: the class could survive an
 * edit that renders nothing inside it.
 */
test("one completion mark covers exercises, warm-up pills and whole blocks", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  const warmup = page.locator(".block", { hasText: "Warm-up" });
  const pills = warmup.locator(".pill");
  const pillCount = await pills.count();

  // Nothing is done yet: no mark on any pill, on the block, or on the first exercise.
  await expect(warmup.locator(".pill svg")).toHaveCount(0);
  await expect(warmup.locator(".block-status svg")).toHaveCount(0);
  const squat = page.locator(".exercise", { hasText: "Goblet squat" }).first();
  await expect(squat.locator(".exercise-status svg")).toHaveCount(0);

  // One pill marks itself and nothing else — in particular not the block, which is not
  // done until every pill is.
  await pills.nth(0).click();
  await expect(pills.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(warmup.locator(".pill svg")).toHaveCount(1);
  await expect(warmup.locator(".block-status svg")).toHaveCount(0);

  // The whole block marks itself only once the last pill lands.
  for (let i = 1; i < pillCount; i++) await pills.nth(i).click();
  await expect(warmup.locator(".block-status")).toHaveAttribute("aria-label", "Block complete");
  await expect(warmup.locator(".block-status svg")).toHaveCount(1);

  // A finished exercise takes the same mark, labelled for a screen reader — the collapsed
  // row's summary ("8 · 8 · 8 at 10 kg") says what was done but never that it is finished.
  await logSetThroughRest(page);
  await logSetThroughRest(page);
  await logSetThroughRest(page);
  await expect(squat).toHaveClass(/done/);
  await expect(squat.locator(".exercise-status")).toHaveAttribute("aria-label", "Done");
  await expect(squat.locator(".exercise-status svg")).toHaveCount(1);
});

test("a skipped exercise is marked finished-with, not achieved", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  await page.locator(".log-strip .strip-change").click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();

  const squat = page.locator(".exercise", { hasText: "Goblet squat" }).first();
  await expect(squat.locator(".exercise-status")).toHaveAttribute("aria-label", "Skipped");
  await expect(squat).toHaveClass(/skipped/);
});

/** Opens the deviation sheet on whatever exercise is currently expanded. */
async function openDeviationSheet(page: Page) {
  await page.locator(".log-strip .strip-change").click();
  const sheet = page.locator(".sheet");
  await expect(sheet).toBeVisible();
  return sheet;
}

/**
 * Review finding 1: `add_set`/`drop_set` cannot move a rounds block's ledger — CONTRACT
 * makes `sets` invalid there, because `set_no` *is* the round. Offering them anyway let a
 * user write a deviation row claiming something that could not have happened.
 */
test("a rounds block does not offer to add or drop a set", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/D`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  // The `main` block is a plain sequence: both options belong there.
  const sequenceSheet = await openDeviationSheet(page);
  await expect(sequenceSheet.getByText("Add a set")).toBeVisible();
  await expect(sequenceSheet.getByText("Drop a set")).toBeVisible();
  await sequenceSheet.getByRole("button", { name: "Cancel" }).click();

  // `ab-finisher` is `type: rounds`.
  await open(page, "Dead bug");
  const roundsSheet = await openDeviationSheet(page);
  await expect(roundsSheet.getByText("Add a set")).toHaveCount(0);
  await expect(roundsSheet.getByText("Drop a set")).toHaveCount(0);
  // Everything that *is* meaningful in a rounds block is still on offer.
  await expect(roundsSheet.getByText("Skip")).toBeVisible();
  await expect(roundsSheet.getByText("Stop (red flag)")).toBeVisible();
});

/**
 * Review finding 2: completing a round left the cursor on the *last* exercise of the
 * circuit, so round 2 started at position 4 of 4 — and with a block after it, the generic
 * advance walked straight out of the circuit and abandoned the remaining rounds.
 */
test("finishing a round restarts the circuit at its first exercise", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/D`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  // Anywhere other than the top of the circuit — this is where completing a round leaves
  // the cursor in real use.
  await open(page, "Reverse crunch");
  await page.getByRole("button", { name: /^Round 1 of 2 done$/ }).click();

  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Dead bug");
  await expect(page.locator(".log-strip .strip-set")).toContainText("Round 2 of 2");
});

/**
 * Review finding 3: a `drop_set` shrank the ledger past sets that had really been
 * performed, so a logged row vanished from both the ledger and the collapsed summary while
 * still sitting in the database and in the export.
 */
test("dropping a set never hides a set already logged", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();
  // Goblet squat, 3 × 10–15.
  await expect(openExercise(page).locator(".ledger-row")).toHaveCount(3);

  await logSetThroughRest(page);
  await logSetThroughRest(page);
  await expect(openExercise(page).locator(".ledger-row.logged")).toHaveCount(2);

  // Two drops would take a 3-set exercise to 1 — below the 2 sets already performed.
  for (let i = 0; i < 2; i++) {
    const sheet = await openDeviationSheet(page);
    await sheet.getByText("Drop a set").click();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toHaveCount(0);
  }

  // The unperformed 3rd slot is gone — that is what a drop is for — but neither logged set
  // was hidden.
  await expect(openExercise(page).locator(".ledger-row")).toHaveCount(2);
  await expect(openExercise(page).locator(".ledger-row.logged")).toHaveCount(2);
});
