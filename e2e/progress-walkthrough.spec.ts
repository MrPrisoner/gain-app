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
  finishSession,
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
  await assertNoHorizontalOverflow(page);

  await rows.first().getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Goblet squat" })).toBeVisible();
  // Goblet squat carries a load, so the first chart plots it; a bodyweight movement
  // would plot reps instead and be headed differently (topSetChartPoints, Task 1).
  // Counts stay "at least one" rather than exact: this suite shares one seeded database
  // across three parallel viewport projects (history-walkthrough.spec.ts), so how many
  // times session A has been logged by the time this assertion runs isn't deterministic.
  await expect(
    page.locator('svg[aria-label="Load × reps trend chart"] .dot').first(),
  ).toBeVisible();
  await expect(page.locator('svg[aria-label="volume bar chart"] rect').first()).toBeVisible();
  // difficultyBars always renders three bars (easy/medium/hard), even at zero-zero-zero
  // (unlike Sparkline's empty state, BarChart's `<svg aria-label>` alone proves nothing
  // about whether any set was actually logged) — so proving the chart is populated means
  // reading a specific bar's readout, not just the svg's presence. Every set above was
  // logged through `logSetThroughRest`'s default Medium tap, so Easy and Hard stay at 0.
  await expect(page.getByRole("button", { name: /^Medium: [1-9]\d*$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Easy: 0" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hard: 0" })).toBeVisible();

  await assertNoHorizontalOverflow(page);
});

test("the progress hub shows a session card with a duration chart", async ({ page }) => {
  await logGobletSquat(page, "A", 1);
  await page.getByRole("button", { name: "End session" }).click();
  await finishSession(page);

  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress`);
  await expect(page.getByRole("heading", { name: "Squat, Press & Row" })).toBeVisible();
  // The svg wrapper renders in both the populated and empty-data states (Sparkline.svelte),
  // so proving the duration series actually got a point means asserting on `.dot`, not the
  // svg's mere presence.
  await expect(
    page.locator('svg[aria-label="Squat, Press & Row duration trend chart"] .dot').first(),
  ).toBeVisible();

  await assertNoHorizontalOverflow(page);
});

test("the metric trends list and detail chart the session-scope symptoms metric", async ({
  page,
}) => {
  // The fixture declares `symptoms_during` at both set and session scope — the one
  // pairing the `(scope, key)` invariant exists to protect. The wrap-up sheet only ever
  // asks the session-scope one (`prompt_when: end`), so answering it here is the
  // cheapest way to get a chartable value onto these two never-before-visited routes.
  await logGobletSquat(page, "A", 1);
  await page.getByRole("button", { name: "End session" }).click();
  await page
    .getByRole("group", { name: "Hip / lower-back symptoms during this session" })
    .getByRole("button", { name: "4", exact: true })
    .click();
  await finishSession(page);

  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress/metrics`);
  const row = page
    .getByRole("listitem")
    .filter({ hasText: "Hip / lower-back symptoms during this session" });
  await expect(row).toHaveCount(1);

  await row.getByRole("link").click();
  await expect(
    page.getByRole("heading", { name: "Hip / lower-back symptoms during this session" }),
  ).toBeVisible();
  await expect(
    page.locator('svg[aria-label="Hip / lower-back symptoms during this session trend chart"]'),
  ).toBeVisible();

  await assertNoHorizontalOverflow(page);
});
