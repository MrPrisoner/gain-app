/**
 * Task 4 review follow-up (docs/superpowers/plans/2026-08-10-phase-4-remediation.md):
 * two ways the pinned log strip could write a set the user did not ask for. Both are
 * about the strip being **one shared form** where the per-set rows used to be many
 * independent ones, so both regress silently if the guards are removed.
 *
 * 1. The three effort keys are the form's only submit buttons, so the first of them
 *    (Easy) is its *default button* — HTML implicit submission fires a click at it when
 *    Go/Enter is pressed on a phone keyboard in a dial input. That logs the set at an
 *    effort nobody chose, and the ledger is read-only with no delete.
 * 2. A second tap inside the round trip lands after `onLogged` has advanced the cursor,
 *    so it writes a real set against N+1 — with a fresh `client_id` for a genuinely
 *    different slot, which is precisely the case `logSet`'s idempotency cannot catch.
 *
 * Both assert on the number of `?/logSet` requests that actually left the browser, which
 * is the only thing that can write a row, rather than on rendered state alone.
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth setup here.
 */

import { expect, test, type Page } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";

/** Counts `?/logSet` POSTs, optionally holding each one open to open the race window. */
async function countLogSetRequests(page: Page, holdMs = 0): Promise<() => number> {
  let count = 0;
  await page.route(/\?\/logSet/, async (route) => {
    if (route.request().method() === "POST") {
      count += 1;
      if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs));
    }
    await route.continue();
  });
  return () => count;
}

test("Enter in a dial does not log the set at Easy", async ({ page }) => {
  const logSets = await countLogSetRequests(page);
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await expect(page.locator(".log-strip")).toBeVisible();

  const reps = page.locator('.log-strip input[name="reps"]');
  await reps.fill("10");
  await reps.press("Enter");

  // Nothing left the browser, the cursor has not moved, and set 1 is still unlogged.
  expect(logSets(), "Enter must not submit the strip's form").toBe(0);
  await expect(page.locator(".log-strip .strip-set")).toContainText("Set 1 of 3");
  await expect(page.locator(".exercise.open .ledger-row").first()).toContainText("Up next");
  await expect(page.locator(".rest-overlay")).toHaveCount(0);

  // The typed value survived — Enter dismissed the keyboard, it did not reset the dial.
  await expect(reps).toHaveValue("10");
});

test("a double tap on an effort key logs exactly one set", async ({ page }) => {
  const logSets = await countLogSetRequests(page, 400);
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await expect(page.locator(".log-strip")).toBeVisible();

  // Both clicks in one task, so the `disabled` attribute provably has not been flushed
  // between them — the harshest form of the race, and the reason the submit handler
  // re-checks the flag rather than relying on `disabled` alone.
  await page.evaluate(() => {
    const key = document.querySelector<HTMLButtonElement>('.log-strip button[value="medium"]');
    key?.click();
    key?.click();
  });

  const firstRow = page.locator(".exercise.open .ledger-row").first();
  await expect(firstRow).toHaveClass(/logged/);
  await expect(firstRow.locator(".led-effort i.on")).toHaveCount(2);
  expect(logSets(), "the second tap inside the round trip must be inert").toBe(1);

  // Set 2 is untouched: the cursor advanced exactly once.
  await expect(page.locator(".exercise.open .ledger-row").nth(1)).toContainText("Up next");
});
