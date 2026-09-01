/**
 * UI §8: both the wrap-up
 * sheet (`+page.svelte`) and `DeviationSheet.svelte` are now real modal dialogs —
 * `role="dialog"`, `aria-modal="true"`, a labelled heading, focus moved into the sheet
 * on open, Tab/Shift+Tab trapped inside it, Escape treated the same as the existing
 * Cancel/Back button, and focus restored to whatever triggered the sheet once it
 * closes. The rest overlay (`RestTimer.svelte`) is the third — the final whole-branch
 * review caught that the accessibility sweep had missed it, though it is the same kind of
 * full-screen modal over the same still-tabbable runner.
 *
 * `src/lib/actions/focus-trap.ts` is the one shared mechanism behind all three; this
 * spec drives it through a real browser, which is the only way to exercise the action
 * itself in this repo — `vitest.config.ts` runs Vitest with no DOM, so only the pure
 * cycling decision (`nextTrapFocusTarget`) is unit-tested
 * (`tests/actions/focus-trap.test.ts`).
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth setup here.
 */

import { expect, test, type Page } from "@playwright/test";
// The *actual* app constant, not a re-typed copy. This spec counts a dialog's Tab stops
// to decide how many presses prove the cycle wraps; a local copy would keep passing while
// the app's selector drifted, which is the one thing this test must not do.
import { FOCUSABLE_SELECTOR } from "../src/lib/actions/focus-trap";
import { E2E_PLAN_SLUG } from "./env";
import { dismissPreSessionPrompt } from "./helpers";

/** Presses Tab `presses` times, asserting after *every* press that focus is still
 * somewhere inside `sheetSelector` — checking after each press, rather than only at the
 * end, catches a one-tap leak that a single final assertion would miss. */
async function assertTabStaysWithin(
  page: Page,
  sheetSelector: string,
  presses: number,
): Promise<void> {
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("Tab");
    const stillInside = await page.evaluate(
      (selector) => !!document.activeElement?.closest(selector),
      sheetSelector,
    );
    expect(stillInside, `Tab press ${i + 1} of ${presses} escaped the sheet`).toBe(true);
  }
}

test("the deviation sheet traps focus and Escape closes it, restoring focus", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  const trigger = page.locator(".log-strip .strip-change");
  await trigger.click();

  const sheet = page.locator(".sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("role", "dialog");
  await expect(sheet).toHaveAttribute("aria-modal", "true");
  await expect(sheet).toHaveAttribute("aria-labelledby", "deviation-heading");

  // Focus moved into the sheet, onto its labelled heading, on open.
  await expect(page.locator("#deviation-heading")).toBeFocused();

  // Tab from the heading lands on the sheet's first real control — "Skip", the first
  // radio in `.kind-row` — never on anything on the page behind the sheet.
  await page.keyboard.press("Tab");
  await expect(page.locator('.sheet input[value="skip"]')).toBeFocused();

  // One extra lap past the sheet's full focusable count proves the cycle genuinely
  // wraps around rather than merely reaching the end and stopping (or escaping).
  const focusableCount = await sheet.locator(FOCUSABLE_SELECTOR).count();
  await assertTabStaysWithin(page, ".sheet", focusableCount + 2);

  // Review finding: a `keydown` listener scoped to the sheet element goes silent the
  // moment focus leaves it — and on a phone, tapping any non-focusable region *inside*
  // the sheet (padding between rows, here — not a button, radio, or the heading) blurs
  // `document.activeElement` to `<body>`. This is the common case on a touch device
  // ("assume sweaty hands and a phone propped on the floor"), not an edge case, so both
  // Tab and Escape have to keep working after it, not just after a click that happens
  // to land on a real control.
  const sheetBox = await sheet.boundingBox();
  if (!sheetBox) throw new Error("sheet has no bounding box");
  const nonFocusableTap = { x: sheetBox.width / 2, y: 6 }; // the sheet's own top padding

  await sheet.click({ position: nonFocusableTap });
  expect(
    await page.evaluate(() => document.activeElement === document.body),
    "the tap should have blurred focus to <body>, reproducing the bug this guards",
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(page.locator('.sheet input[value="skip"]')).toBeFocused();

  await sheet.click({ position: nonFocusableTap });
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  // Focus returned to the control that opened the sheet.
  await expect(trigger).toBeFocused();
});

test("the wrap-up sheet traps focus and Escape closes it, restoring focus", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  const trigger = page.getByRole("button", { name: "End session" });
  await trigger.click();

  const sheet = page.locator(".sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("role", "dialog");
  await expect(sheet).toHaveAttribute("aria-modal", "true");
  await expect(sheet).toHaveAttribute("aria-labelledby", "wrap-up-heading");

  await expect(page.locator("#wrap-up-heading")).toBeFocused();

  // Tab from the heading lands on the sheet's first real control, not stuck on the
  // heading itself (a hidden `<input>` that a browser refuses to focus would leave
  // `document.activeElement` unchanged — still technically "inside the sheet", which is
  // why this checks the specific target moved, not just that it stayed contained).
  await page.keyboard.press("Tab");
  await expect(sheet.locator(FOCUSABLE_SELECTOR).first()).toBeFocused();

  const focusableCount = await sheet.locator(FOCUSABLE_SELECTOR).count();
  await assertTabStaysWithin(page, ".sheet", focusableCount + 1);

  // Same review finding as the deviation sheet's test above: a tap on non-focusable
  // sheet content (the next-morning note, here — real text this sheet renders, not a
  // synthetic target) blurs focus to `<body>`, and both Tab and Escape have to recover
  // from that, not just from a click that happens to land on a real control.
  const note = sheet.locator(".next-morning-note");
  await expect(note).toBeVisible();

  await note.click();
  expect(
    await page.evaluate(() => document.activeElement === document.body),
    "the tap should have blurred focus to <body>, reproducing the bug this guards",
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(sheet.locator(FOCUSABLE_SELECTOR).first()).toBeFocused();

  await note.click();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

/**
 * Final-review finding: the rest overlay is the third full-screen modal in the runner and
 * was the one that never got that treatment. It is `position: fixed; inset: 0` over
 * a log strip and an exercise list that both stay mounted and tabbable, so before the fix
 * a keyboard user could Tab straight through it into effort keys they could not see and
 * log a set during rest.
 *
 * Goblet squat (Session A's first tracked exercise) declares `rest_sec: [75, 90]`
 * (fixtures/plans/home-training-v1.md), so logging its first set always fires the overlay.
 */
test("the rest overlay traps focus and Escape starts the next set", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  const trigger = page.locator('.log-strip button[data-difficulty="medium"]');
  await trigger.click();

  const rest = page.locator(".rest-overlay");
  await expect(rest).toBeVisible();
  await expect(rest).toHaveAttribute("role", "dialog");
  await expect(rest).toHaveAttribute("aria-modal", "true");
  await expect(rest).toHaveAttribute("aria-labelledby", "rest-heading");
  // `role="timer"` moved onto the readout it describes rather than being dropped —
  // `role="dialog"` had to take the overlay itself.
  await expect(rest.locator(".rest-time")).toHaveAttribute("role", "timer");

  await expect(page.locator("#rest-heading")).toBeFocused();

  // Tab from the heading lands on the overlay's own first control (+30s), never on the
  // log strip's effort keys sitting underneath it.
  await page.keyboard.press("Tab");
  await expect(rest.getByRole("button", { name: "+30s" })).toBeFocused();

  const focusableCount = await rest.locator(FOCUSABLE_SELECTOR).count();
  await assertTabStaysWithin(page, ".rest-overlay", focusableCount + 2);

  // Same regression the sheets' fix round covered for the other two: a tap on
  // non-focusable overlay content (the "Up next" label — real text this overlay renders)
  // blurs focus to `<body>`, and both Tab and Escape have to recover from that.
  const upNext = rest.locator(".upnext-label");
  await expect(upNext).toBeVisible();

  await upNext.click();
  expect(
    await page.evaluate(() => document.activeElement === document.body),
    "the tap should have blurred focus to <body>, reproducing the bug this guards",
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(rest.getByRole("button", { name: "+30s" })).toBeFocused();

  // Escape is wired to the same deliberate escape the primary button offers — "start the
  // next set early" (`onSkip`). It is a tap, not the auto-dismiss UI §4 forbids.
  await upNext.click();
  await page.keyboard.press("Escape");
  await expect(rest).toHaveCount(0);

  // The two sheets above additionally assert focus returns to the control that opened
  // them. This overlay cannot make that claim, and the difference is the log strip's, not
  // the trap's: the trigger re-renders out from under the overlay before it closes —
  // logging a set advances the cursor, so the exact element that was focused when the
  // overlay opened need not exist by the time it closes. What must still hold is that
  // focus is not stranded in the removed overlay — a detached `activeElement` is a
  // keyboard dead end, which is the actual failure mode worth guarding.
  expect(
    await page.evaluate(
      () =>
        !!document.activeElement?.isConnected && !document.activeElement.closest(".rest-overlay"),
    ),
    "focus must be on a live element outside the dismissed overlay",
  ).toBe(true);
  await expect(trigger).toBeVisible();
});
