/**
 * Log-strip review follow-up (UI §2):
 * two ways the pinned log strip could write a set the user did not ask for. Both are
 * about the strip being **one shared control** where the per-set rows used to be many
 * independent ones, so both regress silently if the guards are removed.
 *
 * 1. The three effort keys used to be the form's only submit buttons, so the first of
 *    them (Easy) was its *default button* — HTML implicit submission fired a click at it
 *    when Go/Enter was pressed on a phone keyboard in a dial input. That would log the
 *    set at an effort nobody chose, and the ledger is read-only with no delete.
 * 2. A second tap inside the write's round trip lands after `onLogged` has advanced the
 *    cursor, so it writes a real set against N+1 — with a fresh op id for a genuinely
 *    different slot, which idempotency on that id alone cannot catch.
 *
 * Phase 6 moved the write off `?/logSet` entirely (`LogStrip.svelte`'s `submitEffort` now
 * calls `logWrite`, appending straight to the IndexedDB outbox — no network request until
 * a later, batched, asynchronous sync), so neither guard has a network signature to count
 * anymore. Both tests instead assert on the ledger the write actually produced: a set
 * that was never submitted leaves it untouched, and a double tap leaves exactly one row
 * logged, never two — the same properties the old network-request count proved, verified
 * through the state that write is now the only thing that changes.
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth setup here.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import { dismissPreSessionPrompt, logSetThroughRest } from "./helpers";

test("Enter in a dial does not log the set at Easy", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  const reps = page.locator('.log-strip input[aria-label="Reps"]');
  await reps.fill("10");
  await reps.press("Enter");

  // The cursor has not moved and set 1 is still unlogged.
  await expect(page.locator(".log-strip .strip-set")).toContainText("Set 1 of 3");
  await expect(page.locator(".exercise.open .ledger-row").first()).toContainText("Up next");
  await expect(page.locator(".rest-overlay")).toHaveCount(0);

  // The typed value survived — Enter dismissed the keyboard, it did not reset the dial.
  await expect(reps).toHaveValue("10");
});

test("a double tap on an effort key logs exactly one set", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  // Both clicks in one task, so the `submitting` guard provably has not been set between
  // them by a prior microtask turn — the harshest form of the race, and the reason
  // `submitEffort` sets that flag synchronously before its first `await` rather than
  // relying on the `disabled` attribute alone.
  await page.evaluate(() => {
    const key = document.querySelector<HTMLButtonElement>(
      '.log-strip button[data-difficulty="medium"]',
    );
    key?.click();
    key?.click();
  });

  const firstRow = page.locator(".exercise.open .ledger-row").first();
  await expect(firstRow).toHaveClass(/logged/);
  await expect(firstRow.locator(".led-effort i.on")).toHaveCount(2);

  // Set 2 is untouched: the cursor advanced exactly once, so the second tap was inert.
  await expect(page.locator(".exercise.open .ledger-row").nth(1)).toContainText("Up next");
});

/**
 * A third way the shared strip can offer a value nobody logged, found in the 2026-08-27
 * review (U2).
 *
 * `LogStrip`'s per-slot input drafts deliberately *shadow* the pre-fill, so an adjustment
 * survives looking at another exercise and coming back. Nothing removed an entry, and the
 * component never remounts — so backing out of a correction left the abandoned number
 * waiting in the strip the next time that row was tapped, presented as the current value
 * and one effort tap from being committed.
 *
 * That sits directly against the invariant the ledger already honours: client state is
 * what was submitted, never what was pre-filled. A surviving draft is a third thing that
 * is neither, and it is the one of the three that reaches the export.
 */
test("a cancelled correction does not leave its abandoned value in the strip", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  const reps = page.locator('.log-strip input[aria-label="Reps"]');
  await reps.fill("10");
  // Clears the rest overlay this set fires, which would otherwise sit over the ledger.
  await logSetThroughRest(page);

  const loggedRow = page.locator(".exercise.open .ledger-row.logged").first();
  await expect(loggedRow).toContainText("10");

  // Reopen it for correction, type a number, then back out without writing.
  await loggedRow.locator("button.ledger-edit").click();
  await expect(page.locator(".log-strip .strip-set")).toContainText("Editing");
  await expect(reps).toHaveValue("10");
  await reps.fill("99");
  await page.locator(".log-strip .strip-change").click();

  // Nothing was written: the ledger still reads what was actually logged.
  await expect(loggedRow).toContainText("10");
  await expect(loggedRow).not.toContainText("99");

  // And the strip does not re-offer the abandoned 99 on the next tap.
  await loggedRow.locator("button.ledger-edit").click();
  await expect(page.locator(".log-strip .strip-set")).toContainText("Editing");
  await expect(reps).toHaveValue("10");
});
