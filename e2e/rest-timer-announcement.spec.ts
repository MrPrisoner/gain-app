// e2e/rest-timer-announcement.spec.ts
/**
 * The rest overlay's phase announcement survives the phase change.
 *
 * A live region is announced when its *contents* change while it is in the document. An
 * element inserted with its text already in place is not a change — so a region that
 * lives inside the `{#if}` branch for one phase is torn down and rebuilt on every
 * transition, and the one transition that matters, "Resting" becoming "Ready", says
 * nothing at all. It only ever spoke as a side effect of the countdown mutating the same
 * element each second.
 *
 * A screen reader is not available here, so this asserts the property that decides it
 * instead: the same DOM node stays in the document across the transition, and its text
 * changes. Node identity is the whole question — a spec that only checked the text would
 * pass against markup that re-mounts.
 *
 * `page.clock` is what makes it quick: the fixture's first rest is a 75-90s window, and
 * the timer reads `Date.now()` on a 250ms interval, both of which the fake clock drives.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import { dismissPreSessionPrompt, logSet } from "./helpers";

test("the rest phase announcement is one live region across the whole rest", async ({ page }) => {
  await page.clock.install();

  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();
  await logSet(page);

  const overlay = page.locator(".rest-overlay");
  await expect(overlay).toBeVisible();
  const live = overlay.locator("[aria-live]");
  await expect(live).toHaveText("Resting");

  // The node itself, so identity can be checked rather than just the text.
  const before = await live.elementHandle();

  // Past the window's lower bound (goblet squat rests 75-90s in the fixture) but short of
  // its upper one, into the phase whose announcement is the point of the whole overlay.
  await page.clock.fastForward(80_000);

  await expect(live).toContainText("Ready");
  expect(
    await before.evaluate((el) => el.isConnected),
    "the live region must be the same node across the phase change — a re-mounted region announces nothing",
  ).toBe(true);
});
