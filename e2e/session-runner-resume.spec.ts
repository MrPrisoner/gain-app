/**
 * Task 6 (docs/superpowers/plans/2026-08-10-phase-4-remediation.md): a reload resumes the
 * workout, not just the workout *row*.
 *
 * Before this task the runner kept its `client_id` in `sessionStorage`, so a reload landed
 * back on the same `workout` row — and then re-armed every ledger slot empty. The strip
 * re-offered set 1 with a freshly minted `client_id`, which is precisely the case
 * `logSet`'s per-`client_id` idempotency cannot catch: a new id is a new "first" write. The
 * ledger, the cursor, skips, swaps and the wrap-up's answers all started blank.
 *
 * The duplicate assertion is on the database, not on rendered state, because "cannot create
 * a duplicate `(workout, exercise, set_no, side)`" is a claim about rows. Every query is
 * scoped to this test's own workout via the `client_id` the page minted — three viewport
 * projects share one seeded `gain.db`, so nothing here may count rows globally.
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth setup here.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import {
  dismissPreSessionPrompt,
  logSetThroughRest,
  openExercise,
  setLogsOf,
  workoutClientId,
  workoutCountFor,
} from "./helpers";

test("a reload restores the ledger and leaves the cursor on the next unlogged set", async ({
  page,
}) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Goblet squat");

  // Goblet squat is 3 sets, so two logged leaves the cursor on set 3.
  await logSetThroughRest(page);
  await logSetThroughRest(page);
  await expect(page.locator(".log-strip .strip-set")).toContainText("Set 3 of 3");

  const clientId = await workoutClientId(page, "A");

  await page.reload();
  await expect(page.locator(".log-strip")).toBeVisible();

  // The ledger came back, and with it the cursor — not set 1 of a blank exercise.
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Goblet squat");
  await expect(openExercise(page).locator(".ledger-row.logged")).toHaveCount(2);
  await expect(page.locator(".log-strip .strip-set")).toContainText("Set 3 of 3");

  // Same workout row, and exactly the two sets that were performed.
  expect(workoutCountFor(clientId), "the reload must resume the workout, not start a second").toBe(
    1,
  );
  expect(setLogsOf(clientId)).toEqual([
    { set_no: 1, side: null, slug: "goblet-squat" },
    { set_no: 2, side: null, slug: "goblet-squat" },
  ]);

  // Logging on from where the reload left off adds set 3 and re-writes neither of the
  // first two — the cursor is what makes that impossible, since a fresh `client_id` on a
  // re-offered set 1 would have written a second row for it.
  await logSetThroughRest(page);
  expect(setLogsOf(clientId)).toEqual([
    { set_no: 1, side: null, slug: "goblet-squat" },
    { set_no: 2, side: null, slug: "goblet-squat" },
    { set_no: 3, side: null, slug: "goblet-squat" },
  ]);
});

test("a reload restores a skip and the wrap-up's already-answered metrics", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Goblet squat");

  // Skip: `kind` defaults to skip and `reason_code` to Symptoms, so Save is the whole
  // gesture (see session-runner-exercise-state.spec.ts).
  await page.locator(".log-strip .strip-change").click();
  await page.locator(".sheet button[type=submit]").click();
  const squat = page.locator(".exercise", { hasText: "Goblet squat" }).first();
  await expect(squat.locator(".exercise-meta")).toHaveText("Skipped");

  // A session-scope wrap-up answer, which is a `metric_value` row of its own.
  await page.getByRole("button", { name: "End session" }).click();
  const symptoms = page.locator("fieldset", { hasText: "Lower-back symptoms during session" });
  await symptoms.getByRole("button", { name: "4", exact: true }).click();
  await expect(symptoms.locator(".scale-cell.selected")).toHaveText("4");

  await page.reload();
  await expect(page.locator(".log-strip")).toBeVisible();

  // The skip survived — and the runner did not reopen the skipped exercise.
  await expect(squat.locator(".exercise-meta")).toHaveText("Skipped");
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Dumbbell floor press");

  // And the wrap-up does not re-ask something already answered.
  await page.getByRole("button", { name: "End session" }).click();
  await expect(
    page
      .locator("fieldset", { hasText: "Lower-back symptoms during session" })
      .locator(".scale-cell.selected"),
  ).toHaveText("4");
});

test("a reload restores a swap, so the strip still logs the substitute", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/D`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  await page.locator(".exercise-head", { hasText: "Reverse crunch" }).first().click();
  await openExercise(page).getByRole("button", { name: "Swap: dead-bug" }).click();
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Dead bug");

  await page.reload();
  await expect(page.locator(".log-strip")).toBeVisible();

  // Resume reopens the first exercise still needing something, which is the top of the
  // session — so the swapped slot is collapsed, and its *collapsed* row is already proof
  // the swap survived: the head renders the movement being performed.
  const finisher = page.locator("section.block", { hasText: "Abdominal finisher" });
  const swapped = finisher.locator(".exercise").nth(3);
  await expect(swapped.locator(".exercise-name")).toHaveText("Dead bug");

  await swapped.locator(".exercise-head").click();
  // Still says which prescription it is filling, and still carries the substitute's own
  // `per_side` shape (`dead-bug` is per-side, `reverse-crunch` is not) — the swap is the
  // real thing after a reload, not a repainted label.
  await expect(swapped).toContainText("Swapped in for Reverse crunch");
  await expect(swapped.locator(".ledger-row")).toHaveCount(2);
  await expect(page.locator(".log-strip .strip-exercise")).toHaveText("Dead bug");
});
