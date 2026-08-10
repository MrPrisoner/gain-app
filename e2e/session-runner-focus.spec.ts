/**
 * Task 11 (docs/superpowers/plans/2026-08-10-phase-4-remediation.md): both the wrap-up
 * sheet (`+page.svelte`) and `DeviationSheet.svelte` are now real modal dialogs —
 * `role="dialog"`, `aria-modal="true"`, a labelled heading, focus moved into the sheet
 * on open, Tab/Shift+Tab trapped inside it, Escape treated the same as the existing
 * Cancel/Back button, and focus restored to whatever triggered the sheet once it
 * closes. `src/lib/actions/focus-trap.ts` is the one shared mechanism behind both; this
 * spec drives it through a real browser, which is the only way to exercise the action
 * itself in this repo — `vitest.config.ts` runs Vitest with no DOM, so only the pure
 * cycling decision (`nextTrapFocusTarget`) is unit-tested
 * (`tests/actions/focus-trap.test.ts`).
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth setup here.
 */

import { expect, test, type Page } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import { dismissPreSessionPrompt } from "./helpers";

// Mirrors `src/lib/actions/focus-trap.ts`'s own `FOCUSABLE_SELECTOR` — see its comment
// for why `[type="hidden"]` is excluded (both sheets carry several hidden form fields,
// which a browser silently refuses to focus).
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

test("the deviation sheet traps focus and Escape closes it, restoring focus", async ({
  page,
}) => {
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
