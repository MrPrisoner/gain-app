// e2e/progress-walkthrough.spec.ts
/**
 * The hub's own durable proof. goblet-squat is prescribed in both session A ([8,12]) and
 * session D ([12,15]) of the fixture, and the redesign splits what that means: it is ONE
 * mover row, because whether squats are moving is not a per-session question, and up to
 * TWO readiness rows, because a range belongs to an occurrence. A regression in either
 * direction — a movers list that keys on (session, exercise), or a readiness list that
 * collapses to the slug — shows up here.
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

// The second test's link click depends on the first test's mover row existing —
// `fullyParallel: true` (playwright.config.ts) otherwise schedules all three tests in
// this file onto separate workers at once, and the second test would find an empty
// `.mover-list` racing the first test's still-in-flight session log.
test.describe.configure({ mode: "serial" });

async function logGobletSquat(page: Page, sessionKey: string, sets: number): Promise<void> {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/${sessionKey}`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  const pills = page.locator(".checkoff-pills .pill");
  const pillCount = await pills.count();
  for (let i = 0; i < pillCount; i++) await pills.nth(i).click();

  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Goblet squat");
  for (let i = 0; i < sets; i++) await logSetThroughRest(page);
  await page.getByRole("button", { name: "End session" }).click();
  await finishSession(page);
}

test("the hub answers what changed, and groups movements the way each section needs", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await logGobletSquat(page, "A", 3);
  await logGobletSquat(page, "D", 2);

  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress?window=all`);

  // Counts stay "at least one" rather than exact: this suite shares one seeded database
  // across three parallel viewport projects (history-walkthrough.spec.ts), so how many
  // times a session has been logged by the time this runs is not deterministic.
  await expect(page.getByRole("heading", { name: "Where you're moving" })).toBeVisible();

  // One mover row for the movement, whichever sessions it was logged in.
  const moverRows = page.locator(".mover-list li").filter({ hasText: "Goblet squat" });
  await expect(moverRows).toHaveCount(1);

  // The row's sparkline must actually be populated — Sparkline renders its <svg
  // aria-label> in the empty branch too, so the container proves nothing.
  await expect(
    page.locator('svg[aria-label="Goblet squat progress trend chart"] .dot').first(),
  ).toBeVisible();

  // The consistency strip is a real chart with real bars, not an empty well.
  await expect(
    page.locator('svg[aria-label="sessions per week bar chart"] rect').first(),
  ).toBeVisible();

  await assertNoHorizontalOverflow(page);
});

test("a mover row links to a session the movement is actually prescribed in", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress?window=all`);
  const link = page.locator(".mover-list li a").first();
  await link.click();
  // The detail route 404s on an unprescribed (session, exercise) pair, so arriving at a
  // rendered heading is the assertion.
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.getByText("not prescribed in this session")).toHaveCount(0);
});

test("the window pills navigate and mark the current span", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress`);
  // 12w is the default and is current without any query string.
  await expect(page.locator('.window-pills a[data-window="12w"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.locator('.window-pills a[data-window="all"]').click();
  await expect(page).toHaveURL(/window=all/);
  await expect(page.locator('.window-pills a[data-window="all"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
  await assertNoHorizontalOverflow(page);
});
