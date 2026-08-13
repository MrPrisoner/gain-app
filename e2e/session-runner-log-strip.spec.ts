/**
 * Log-strip review follow-up (UI-DECISIONS §2):
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
import { dismissPreSessionPrompt } from "./helpers";

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
