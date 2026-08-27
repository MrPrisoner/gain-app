/**
 * The self-service reset's "done when" (docs/ROADMAP.md): a user resets themselves and
 * lands on the empty state with the bootstrap prompt. The second half of that "done
 * when" — a second device's queued outbox getting the generation 409 and clearing rather
 * than quarantining forever — is exercised by `tests/server/sync-route.test.ts`'s
 * existing 409 coverage plus `tests/server/account-route.test.ts`'s generation-bump
 * assertion, since reproducing two genuinely separate devices racing a reset needs a
 * second browser context for no more signal than those already give.
 *
 * One disposable account per viewport project (`accountResetDevUserFor`) — the reset is
 * destructive, and `fullyParallel: true` runs this file across all three projects
 * concurrently, so a shared account would have its data wiped from under a sibling run.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG, accountResetDevUserFor } from "./env";
import { assertNoHorizontalOverflow, dismissPreSessionPrompt, logSetThroughRest } from "./helpers";

test("a user resets their own account and lands on the empty state", async ({ page }, testInfo) => {
  const devUser = accountResetDevUserFor(testInfo.project.name);
  await page.setExtraHTTPHeaders({ "x-gain-e2e-user": devUser });

  // -- Log a set, so there is real data for the reset to erase.
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await logSetThroughRest(page);

  // -- Reset from the account screen, reached from the footer.
  await page.goto("/");
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();

  // `exact: true`: "Reset my data…" (the trigger) would otherwise substring-match too.
  const confirm = page.getByRole("button", { name: "Reset my data", exact: true });

  // Retried rather than a single click (matches `admin-walkthrough.spec.ts`): the
  // trigger button exists in the DOM the moment SSR markup lands, but its `onclick`
  // only does anything once Svelte finishes hydrating — a click landing in that window
  // is a silent no-op, not an error.
  await expect(async () => {
    await page.getByRole("button", { name: "Reset my data…" }).click();
    await expect(confirm).toBeVisible({ timeout: 500 });
  }).toPass();

  await expect(confirm).toBeDisabled();

  // The widest state the panel ever reaches, in both themes.
  await assertNoHorizontalOverflow(page);
  await page.emulateMedia({ colorScheme: "light" });
  await assertNoHorizontalOverflow(page);
  await page.emulateMedia({ colorScheme: "dark" });

  // Case-insensitive by design.
  await page.getByLabel("Type RESET to confirm").fill("reset");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // -- Lands on Home's empty state, with the bootstrap prompt ready to generate.
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "GAIN doesn't write plans — an AI does." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "1 · Give the AI a running start" }),
  ).toBeVisible();

  // -- The account survived; a fresh visit to the session route is a 404, not a 500 —
  // the plan itself is gone.
  const response = await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  expect(response?.status()).toBe(404);
});
