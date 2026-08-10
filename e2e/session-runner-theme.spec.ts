/**
 * Task 11 (docs/superpowers/plans/2026-08-10-phase-4-remediation.md): "Check both
 * themes: `prefers-color-scheme` and an explicit `data-theme` override, at 360px.
 * Screenshot both." `src/app.css` makes dark the default, light follow
 * `prefers-color-scheme: light`, and an explicit `data-theme="light"`/`"dark"` on
 * `<html>` override both — this spec exercises all three paths at the narrowest
 * configured viewport (`playwright.config.ts`'s `small-android` project, 360×800),
 * with a set already logged so the strip, the ledger's logged row (and its effort
 * segments) and the effort keys are all on screen at once — the fullest real rendering
 * this route has, and the one most likely to expose a colour-token misuse.
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth setup here.
 */

import { expect, test, type Page } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import { dismissPreSessionPrompt } from "./helpers";

test.use({ viewport: { width: 360, height: 800 } });

// `test.use` above pins every test in this file to 360px regardless of which
// viewport project runs it (`playwright.config.ts` has three), so running it under
// all three would produce three byte-identical sets of screenshots — skip everywhere
// but one.
// Playwright's fixture-collection step requires the first parameter to be written as
// an object-destructuring pattern (even an empty one — no fixtures are needed here);
// `no-empty-pattern` otherwise flags exactly that.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "small-android",
    "theme check runs once, at a fixed 360px viewport — not once per viewport project",
  );
});

/** Opens Session A, applies an explicit `data-theme` override if given, dismisses the
 * pre-session gate, logs the first set (Goblet squat, Medium) and clears the rest
 * overlay it fires — leaving the strip on "Set 2 of 3" and the ledger's first row
 * showing a logged set with its effort segments, per this file's header.
 *
 * The override is applied with `page.evaluate` right after `goto` resolves, not via
 * `page.addInitScript` before it — this sandbox's Chromium is a Playwright "fallback
 * build" (`playwright.config.ts`'s own comment on `launchOptions`), and on it a
 * `document.documentElement` attribute set that early does not survive the HTML
 * parser's own `<html lang="en">` start tag; set immediately after navigation, on the
 * live element, it does, and (confirmed by the screenshots this spec produces) the
 * `:root[data-theme]` rule still wins the cascade over `@media (prefers-color-scheme)`
 * on both light and dark either way, since it is applied well before anything is
 * painted or asserted on. */
async function openWithLoggedSet(page: Page, theme?: "light" | "dark"): Promise<void> {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  if (theme) {
    await page.evaluate((value) => {
      document.documentElement.setAttribute("data-theme", value);
    }, theme);
  }
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  await page.locator('.log-strip button[value="medium"]').click();
  const rest = page.locator(".rest-overlay");
  await expect(rest).toBeVisible();
  await rest.getByRole("button", { name: "Start next set" }).click();
  await expect(rest).toHaveCount(0);

  await expect(page.locator(".ledger-row.logged .led-effort i.on")).toHaveCount(2);
  await expect(page.locator(".log-strip .strip-set")).toContainText("Set 2 of 3");
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const innerWidth = await page.evaluate(() => window.innerWidth);
  expect(scrollWidth, "no horizontal overflow, ever").toBeLessThanOrEqual(innerWidth);
}

test("prefers-color-scheme: dark (the default, no override)", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openWithLoggedSet(page);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("theme-360-prefers-dark.png"),
    fullPage: true,
  });
});

test("prefers-color-scheme: light (the default, no override)", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openWithLoggedSet(page);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("theme-360-prefers-light.png"),
    fullPage: true,
  });
});

// `data-theme="light"` must win even when the OS/browser itself prefers dark — that is
// the whole point of an explicit override.
test('data-theme="light" override (against a dark prefers-color-scheme)', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openWithLoggedSet(page, "light");
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("theme-360-data-theme-light.png"),
    fullPage: true,
  });
});

// `data-theme="dark"` must win even when the OS/browser itself prefers light.
test('data-theme="dark" override (against a light prefers-color-scheme)', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openWithLoggedSet(page, "dark");
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("theme-360-data-theme-dark.png"),
    fullPage: true,
  });
});
