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

import { expect, test, type Page } from "@playwright/test";
import { E2E_PLAN_SLUG, seededDataDir } from "./env";
import { dismissPreSessionPrompt } from "./helpers";
import { openSeededUserDb } from "./seed";

/** The exercise row currently expanded — there is exactly one (UI-DECISIONS §1). */
function openExercise(page: Page) {
  return page.locator(".exercise.open");
}

/** Taps the strip's Medium key, then clears any rest overlay the set fired. */
async function logSet(page: Page): Promise<void> {
  const context = page.locator(".log-strip .strip-set");
  const before = await context.innerText();
  await page.locator('.log-strip button[value="medium"]').click();
  await expect(context).not.toHaveText(before);

  const rest = page.locator(".rest-overlay");
  if (await rest.isVisible()) {
    await rest.getByRole("button", { name: "Start next set" }).click();
    await expect(rest).toHaveCount(0);
  }
}

/** The workout's `client_id` — the page mints it and keeps it here, and it is the only
 * handle a spec has on *its own* workout in the shared database. */
async function workoutClientId(page: Page, sessionKey: string): Promise<string> {
  const key = `gain:workout:${E2E_PLAN_SLUG}:${sessionKey}`;
  const clientId = await page.evaluate((k) => sessionStorage.getItem(k), key);
  expect(clientId, "the runner must have stored a workout client_id").toBeTruthy();
  return clientId as string;
}

type SetLogRow = { set_no: number; side: string | null; slug: string };

/** Every `set_log` row of one workout, in insertion order, with its exercise's slug. */
function setLogsOf(clientId: string): { workouts: number; sets: SetLogRow[] } {
  const db = openSeededUserDb(seededDataDir());
  try {
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM workout WHERE client_id = ?").get(clientId) as {
      n: number;
    };
    const sets = db
      .prepare(
        `SELECT s.set_no AS set_no, s.side AS side, e.slug AS slug
         FROM set_log s
         JOIN exercise_def e ON e.id = s.exercise_def_id
         JOIN workout w ON w.id = s.workout_id
         WHERE w.client_id = ?
         ORDER BY s.id`,
      )
      .all(clientId) as SetLogRow[];
    return { workouts: n, sets };
  } finally {
    db.close();
  }
}

test("a reload restores the ledger and leaves the cursor on the next unlogged set", async ({
  page,
}) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Goblet squat");

  // Goblet squat is 3 sets, so two logged leaves the cursor on set 3.
  await logSet(page);
  await logSet(page);
  await expect(page.locator(".log-strip .strip-set")).toContainText("Set 3 of 3");

  const clientId = await workoutClientId(page, "A");

  await page.reload();
  await expect(page.locator(".log-strip")).toBeVisible();

  // The ledger came back, and with it the cursor — not set 1 of a blank exercise.
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Goblet squat");
  await expect(openExercise(page).locator(".ledger-row.logged")).toHaveCount(2);
  await expect(page.locator(".log-strip .strip-set")).toContainText("Set 3 of 3");

  // Same workout row, and exactly the two sets that were performed.
  const afterReload = setLogsOf(clientId);
  expect(afterReload.workouts, "the reload must resume the workout, not start a second").toBe(1);
  expect(afterReload.sets).toEqual([
    { set_no: 1, side: null, slug: "goblet-squat" },
    { set_no: 2, side: null, slug: "goblet-squat" },
  ]);

  // Logging on from where the reload left off adds set 3 and re-writes neither of the
  // first two — the cursor is what makes that impossible, since a fresh `client_id` on a
  // re-offered set 1 would have written a second row for it.
  await logSet(page);
  expect(setLogsOf(clientId).sets).toEqual([
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
  const symptoms = page.locator("label", { hasText: "Lower-back symptoms during session" });
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
    page.locator("label", { hasText: "Lower-back symptoms during session" }).locator(".scale-cell.selected"),
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
