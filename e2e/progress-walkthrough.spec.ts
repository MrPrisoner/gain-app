// e2e/progress-walkthrough.spec.ts
/**
 * Phase 7b's own durable proof (spec §11): goblet-squat is prescribed in both session A
 * ([8,12]) and session D ([12,15]) of the fixture — logging it in both and finding two
 * separate rows on the exercises list is the one behaviour that would silently regress
 * to a merged row if buildExerciseSeries ever went back to keying on a bare
 * exercise_slug.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import {
  assertNoHorizontalOverflow,
  dismissPreSessionPrompt,
  logSetThroughRest,
  openExercise,
} from "./helpers";
import type { Page } from "@playwright/test";

async function logGobletSquat(page: Page, sessionKey: string, sets: number): Promise<void> {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/${sessionKey}`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  const pills = page.locator(".checkoff-pills .pill");
  const pillCount = await pills.count();
  for (let i = 0; i < pillCount; i++) await pills.nth(i).click();

  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Goblet squat");
  for (let i = 0; i < sets; i++) await logSetThroughRest(page);
}

test("goblet squat, prescribed in two sessions, tracks as two separate progress rows", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await logGobletSquat(page, "A", 3);
  await logGobletSquat(page, "D", 2);

  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress/exercises`);
  const rows = page.getByRole("listitem").filter({ hasText: "Goblet squat" });
  await expect(rows).toHaveCount(2);

  await rows.first().getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Goblet squat" })).toBeVisible();
  // Goblet squat carries a load, so the first chart plots it; a bodyweight movement
  // would plot reps instead and be headed differently (topSetChartPoints, Task 1).
  await expect(page.locator('svg[aria-label="Load × reps trend chart"]')).toBeVisible();
  await expect(page.locator('svg[aria-label="volume bar chart"]')).toBeVisible();
  await expect(page.locator('svg[aria-label="difficulty bar chart"]')).toBeVisible();

  await assertNoHorizontalOverflow(page);
});

test("the progress hub shows a session card with a duration chart", async ({ page }) => {
  await logGobletSquat(page, "A", 1);

  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress`);
  await expect(page.getByRole("heading", { name: "Squat, Press & Row" })).toBeVisible();
  await expect(
    page.locator('svg[aria-label="Squat, Press & Row duration trend chart"]'),
  ).toBeVisible();

  await assertNoHorizontalOverflow(page);
});
