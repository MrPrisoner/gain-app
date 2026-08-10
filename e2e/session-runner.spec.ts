/**
 * Task 0 (docs/superpowers/plans/2026-08-10-phase-4-remediation.md): opens
 * the session runner for Session A and Session D of the fixture plan at
 * three real viewport widths, captures a full-page screenshot of each, and
 * asserts no horizontal overflow — `document.documentElement.scrollWidth`
 * must never exceed `window.innerWidth`. `playwright.config.ts` runs this
 * spec once per viewport project, so 2 sessions × 3 projects = 6 runs and 6
 * screenshots.
 *
 * `GAIN_DEV_USER` (set on the dev server in `playwright.config.ts`) puts
 * `hooks.server.ts` in bypass mode for every request, so no login step is
 * needed here — `global-setup.ts` has already provisioned that same bypass
 * user and imported the fixture plan before the server starts serving.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG, E2E_SESSION_KEYS } from "./env";
import { dismissPreSessionPrompt } from "./helpers";

for (const sessionKey of E2E_SESSION_KEYS) {
  test(`session ${sessionKey} has no horizontal overflow`, async ({ page }, testInfo) => {
    await page.goto(`/plan/${E2E_PLAN_SLUG}/session/${sessionKey}`);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Task 9: a fresh workout opens on the pre-session prompt — dismiss it before
    // asserting on the runner itself, which is what this spec's overflow check is about.
    await dismissPreSessionPrompt(page);
    // The runner opens the first tracked exercise of every block by default
    // (UI-DECISIONS §1) — this is the harness's own signal that the
    // session's content, not just the page shell, has rendered.
    await expect(page.locator(".exercise-head").first()).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath(`session-${sessionKey}.png`),
      fullPage: true,
    });

    // The bug class this harness exists to catch for good: nothing on this
    // screen may be wider than the viewport, at any viewport. Expected to
    // fail on this branch (the phase-4 remediation plan's Task 4 defect);
    // it must pass once Task 4 lands.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(
      scrollWidth,
      "document.documentElement.scrollWidth must not exceed window.innerWidth — no horizontal overflow, ever",
    ).toBeLessThanOrEqual(innerWidth);
  });
}

// Task 10 (phase-4 remediation, UI-DECISIONS §8): "Scales render as a row of tappable
// cells — one tap, no slider." The fixture's `symptoms_during`/`symptoms_after` wrap-up
// metrics are an 11-cell 0-10 scale — the exact case that used to wrap into ragged rows
// on a phone (`flex-wrap` + a fixed `min-width`). Checked at every viewport this project
// runs (`playwright.config.ts`), including the narrowest at 360px.
test("the wrap-up's scale metrics render as one row, with no horizontal overflow", async ({
  page,
}) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".exercise-head").first()).toBeVisible();

  await page.getByRole("button", { name: "End session" }).click();
  const scaleRows = page.locator(".scale-row");
  await expect(scaleRows.first()).toBeVisible();

  const rowCount = await scaleRows.count();
  for (let i = 0; i < rowCount; i++) {
    const tops = await scaleRows
      .nth(i)
      .locator(".scale-cell")
      .evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().top));
    expect(
      new Set(tops).size,
      "every cell in a scale row must share one top offset — no ragged wrapping",
    ).toBe(1);
  }

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const innerWidth = await page.evaluate(() => window.innerWidth);
  expect(scrollWidth, "the wrap-up sheet must not force horizontal overflow").toBeLessThanOrEqual(
    innerWidth,
  );
});

/** `document.documentElement.scrollWidth` must never exceed `window.innerWidth`, same
 * assertion the two tests above make — extracted here since Task 11 adds two more
 * overlay states that need exactly the same check. */
async function assertNoHorizontalOverflow(page: import("@playwright/test").Page): Promise<void> {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const innerWidth = await page.evaluate(() => window.innerWidth);
  expect(scrollWidth, "no horizontal overflow, ever").toBeLessThanOrEqual(innerWidth);
}

// Task 11 (phase-4 remediation): the base runner and the wrap-up sheet were already
// covered (above); the deviation sheet and the rest overlay were not. Both are
// `position: fixed` overlays with their own layout, so each is its own chance to
// reintroduce overflow that the base-runner check alone would never catch.
test("the deviation sheet has no horizontal overflow", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  // "Change" on the strip opens the deviation sheet for whatever exercise is open —
  // Goblet squat, the first tracked exercise of Session A.
  await page.locator(".log-strip .strip-change").click();
  await expect(page.locator(".sheet")).toBeVisible();
  // The reason chips are the widest row in the sheet — worth confirming they actually
  // rendered before asserting the page never had to widen to fit them.
  await expect(page.getByText("Equipment")).toBeVisible();

  await assertNoHorizontalOverflow(page);
});

// Goblet squat (Session A's first tracked exercise) declares `rest_sec: [75, 90]`
// (fixtures/plans/home-dumbbell-v1.md), so logging its first set always fires the rest
// overlay — the one full-viewport surface that isn't exercised by any other overflow
// test in this file.
test("the rest overlay has no horizontal overflow", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  await page.locator('.log-strip button[value="medium"]').click();
  const rest = page.locator(".rest-overlay");
  await expect(rest).toBeVisible();
  await expect(rest.getByText("Up next")).toBeVisible();

  await assertNoHorizontalOverflow(page);
});
