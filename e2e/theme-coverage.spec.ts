/**
 * Both themes, on the six screens §12 says are never rendered in light at all. The
 * existing `session-runner-theme.spec.ts` covers the runner and pins itself to 360; this
 * covers everything else at whichever viewport project runs it.
 *
 * `colorScheme` is set through Playwright's own emulation rather than a `data-theme`
 * attribute, because `prefers-color-scheme` is the path a real user arrives on — the
 * attribute override already has coverage in the runner's spec.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import { assertNoHorizontalOverflow } from "./helpers";

const ROUTES = [
  ["home", "/"],
  ["import", "/import"],
  ["export", `/plan/${E2E_PLAN_SLUG}/export`],
  ["progress", `/plan/${E2E_PLAN_SLUG}/progress`],
  ["history", `/plan/${E2E_PLAN_SLUG}/history`],
  ["versions", `/plan/${E2E_PLAN_SLUG}/versions`],
] as const;

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    for (const [name, url] of ROUTES) {
      test(`${name} renders without overflow`, async ({ page }) => {
        await page.goto(url);
        await page.waitForLoadState("networkidle");
        await assertNoHorizontalOverflow(page);
        // Assert the theme actually took, not merely that a page rendered — the trap
        // `session-runner-theme.spec.ts`'s own header documents at length.
        const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(ground).toBe(scheme === "dark" ? "rgb(10, 12, 15)" : "rgb(244, 246, 248)");
      });
    }
  });
}
