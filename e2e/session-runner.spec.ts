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
