/**
 * The sync banner's *visibility*, as opposed to its text (`tests/sync/banner.test.ts`).
 *
 * The banner renders in flow above `<main>`, so mounting one reflows the page. A healthy
 * online write settles in about a tenth of a second, and it used to raise two banners in
 * that window — "1 saved on this device" the moment `logWrite` refreshed the counts, then
 * "Syncing 1 workout…" once the flush began — and drop both again. Tapping a symptom
 * score mid-session therefore made the whole screen twitch under the user's thumb.
 *
 * `$lib/sync/banner-gate.ts` fixes it by gating on time, and the unit suite covers the
 * timing rules. What only a browser can prove is the end of that chain: that a real set
 * logged against a real server raises no banner at all. A `MutationObserver` installed
 * before the tap is what makes the negative assertion honest — polling for absence would
 * pass simply by looking after the flicker had already been and gone.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG, E2E_SESSION_KEYS } from "./env";
import { dismissPreSessionPrompt, logSet } from "./helpers";

test("a healthy online sync never raises a banner", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/${E2E_SESSION_KEYS[0]}`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".exercise-head").first()).toBeVisible();

  // Records every `.sync-banner` that is ever added to the document, however briefly.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __bannerSightings: string[] }).__bannerSightings = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains("sync-banner")) {
            seen.push(node.textContent?.trim() ?? "");
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

  await logSet(page);

  // Longer than the gate's own appear delay, so a banner that was merely late still
  // gets caught rather than finishing after the assertion.
  await page.waitForTimeout(1_500);

  const sightings = await page.evaluate(
    () => (window as unknown as { __bannerSightings: string[] }).__bannerSightings,
  );
  expect(sightings, "a set that synced normally must say nothing at all").toEqual([]);
  await expect(page.locator(".sync-banner")).toHaveCount(0);
});
