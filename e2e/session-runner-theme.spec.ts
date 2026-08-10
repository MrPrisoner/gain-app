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

/** `--ground` from `src/app.css`, which `body`'s `background` resolves to — the one
 * property every test in this file actually checks took effect, since it's set once at
 * `:root` (or its `[data-theme]`/media-query overrides) and inherited by nothing more
 * specific that could mask a broken override. Written as the browser reports computed
 * colours (`rgb(r, g, b)`), not the source hex, so the assertion compares like with
 * like. */
const GROUND = {
  dark: "rgb(11, 13, 16)", // #0b0d10
  light: "rgb(244, 246, 248)", // #f4f6f8
} as const;

async function bodyGround(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/**
 * Registers an init script that sets `data-theme` on `<html>` before Session A loads.
 *
 * This has to be an `addInitScript`, not a `page.evaluate` after `goto` resolves — the
 * override must be in place *before* the app's own CSS is first applied, or the
 * screenshots would show a flash of the wrong theme even if the final state were
 * correct. The naive version of this (`document.documentElement.setAttribute(...)`
 * called directly in the init script body) silently does nothing: Playwright's
 * `addInitScript` runs before the HTML parser has processed the response body at all,
 * so `document.documentElement` is still `null` at that point — `.setAttribute` on it
 * throws, and because init-script errors aren't surfaced to the Node side, the failure
 * is invisible unless something downstream specifically checks whether the theme
 * actually changed (which is exactly what a review finding on this spec caught: the
 * first version asserted no horizontal overflow and took a screenshot, neither of which
 * fails when the override silently no-ops and the page just renders its default theme
 * twice). This is a well-known, environment-independent `addInitScript` gotcha, not
 * anything specific to this sandbox's browser build. The fix: retry via a
 * `MutationObserver` on `document` until the parser has actually created
 * `document.documentElement`, then set the attribute on the real element.
 */
async function applyThemeOverride(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.addInitScript((value) => {
    const apply = (): boolean => {
      if (!document.documentElement) return false;
      document.documentElement.setAttribute("data-theme", value);
      return true;
    };
    if (apply()) return;
    const observer = new MutationObserver(() => {
      if (apply()) observer.disconnect();
    });
    observer.observe(document, { childList: true });
  }, theme);
}

/** Opens Session A, dismisses the pre-session gate, logs the first set (Goblet squat,
 * Medium) and clears the rest overlay it fires — leaving the strip on "Set 2 of 3" and
 * the ledger's first row showing a logged set with its effort segments, per this file's
 * header. */
async function openWithLoggedSet(page: Page): Promise<void> {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
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
  // The assertion this spec exists to make: the theme actually rendered as dark, not
  // just "the page didn't overflow" — a broken override would leave this at the light
  // default instead and fail here.
  expect(await bodyGround(page), "prefers-color-scheme: dark must render the dark palette").toBe(
    GROUND.dark,
  );
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("theme-360-prefers-dark.png"),
    fullPage: true,
  });
});

test("prefers-color-scheme: light (the default, no override)", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openWithLoggedSet(page);
  expect(
    await bodyGround(page),
    "prefers-color-scheme: light must render the light palette",
  ).toBe(GROUND.light);
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
  await applyThemeOverride(page, "light");
  await openWithLoggedSet(page);
  // The load-bearing assertion: if the override silently failed to apply (the exact
  // failure mode `applyThemeOverride`'s own comment documents and works around), this
  // would still read `GROUND.dark` — the emulated `prefers-color-scheme` — and fail
  // here rather than passing on an unexercised code path.
  expect(
    await bodyGround(page),
    'data-theme="light" must win over a dark prefers-color-scheme',
  ).toBe(GROUND.light);
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
  await applyThemeOverride(page, "dark");
  await openWithLoggedSet(page);
  expect(
    await bodyGround(page),
    'data-theme="dark" must win over a light prefers-color-scheme',
  ).toBe(GROUND.dark);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("theme-360-data-theme-dark.png"),
    fullPage: true,
  });
});
