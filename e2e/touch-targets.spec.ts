/**
 * UI-DECISIONS §12's open gap, closed. Everything interactive is at least 44 CSS px in
 * both directions — the same shape of assertion as the overflow sweep, catching the same
 * class of bug: one that is invisible on a desktop browser and decides whether a control
 * can be hit at arm's length with sweaty hands.
 *
 * Asserted per route rather than per component, because the failure mode is a *screen*
 * whose controls were never given a floor — `/admin`, `/account`, `/export` and `/import`
 * used padding alone, with no minimum, before `Button` existed.
 */

import { expect, test, type Page } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";

const INTERACTIVE =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]';

async function undersized(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll(selector)) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const { width, height } = el.getBoundingClientRect();
      if (width === 0 && height === 0) continue;
      // An inline link inside a paragraph is text, not a control, and WCAG exempts it.
      if (el.tagName === "A" && style.display === "inline") continue;
      if (width < 44 || height < 44) {
        const label = (el.textContent ?? "").trim().slice(0, 30);
        bad.push(
          `${el.tagName.toLowerCase()} "${label}" ${Math.round(width)}x${Math.round(height)}`,
        );
      }
    }
    return bad;
  }, INTERACTIVE);
}

const ROUTES = [
  ["home", "/"],
  ["import", "/import"],
  ["account", "/account"],
  ["export", `/plan/${E2E_PLAN_SLUG}/export`],
  ["progress", `/plan/${E2E_PLAN_SLUG}/progress`],
  ["history", `/plan/${E2E_PLAN_SLUG}/history`],
  ["versions", `/plan/${E2E_PLAN_SLUG}/versions`],
] as const;

for (const [name, url] of ROUTES) {
  test(`${name} has no undersized touch target`, async ({ page }) => {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    expect(await undersized(page), "every control is at least 44x44 CSS px").toEqual([]);
  });
}
