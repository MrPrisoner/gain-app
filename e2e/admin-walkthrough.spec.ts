/**
 * The operator screen's "done when" (docs/superpowers/specs/2026-08-17-admin-section-design.md):
 * an operator sees every registered user with counts, resets one, and no user's training
 * content is on the screen at any point.
 *
 * One admin account shared across projects, one disposable subject per project — see
 * `adminSubjectFor`. `GAIN_DEV_ADMIN` (playwright.config.ts) is what makes the first of
 * those an operator; every other spec's bypass user stays a normal user.
 */

import { expect, test } from "@playwright/test";
import { E2E_ADMIN_USER, E2E_PLAN_SLUG, adminSubjectFor, homeDevUserFor } from "./env";
import { assertNoHorizontalOverflow } from "./helpers";

test("an operator sees counts, resets one user, and never sees plan content", async ({
  page,
}, testInfo) => {
  const subject = adminSubjectFor(testInfo.project.name);
  await page.setExtraHTTPHeaders({ "x-gain-e2e-user": E2E_ADMIN_USER });

  await page.goto("/admin");

  const card = page.locator("li.card", { hasText: subject });
  await expect(card).toBeVisible();

  // The seeded subject has a plan and has never trained. This string can only be right
  // if the cross-user read actually happened.
  await expect(card.locator(".status")).toHaveText("Plan imported, not trained yet");

  // Counts only: nothing naming the plan reaches the operator.
  await expect(page.getByText(E2E_PLAN_SLUG)).toHaveCount(0);

  const confirm = card.getByRole("button", { name: `Reset ${subject}'s data` });

  // Retried rather than a single click: the trigger button exists in the DOM (and so is
  // already "actionable" to Playwright) the moment SSR markup lands, but its `onclick`
  // only does anything once Svelte finishes hydrating — a click landing in that window is
  // a silent no-op, not an error. Three viewport projects hydrating the same route
  // concurrently against one dev server is enough to make that window wide enough to hit.
  await expect(async () => {
    await card.getByRole("button", { name: "Reset data…" }).click();
    await expect(confirm).toBeVisible({ timeout: 500 });
  }).toPass();

  await expect(confirm).toBeDisabled();

  // The widest state the card ever reaches — input plus two buttons — in both themes.
  await assertNoHorizontalOverflow(page);
  await page.emulateMedia({ colorScheme: "light" });
  await assertNoHorizontalOverflow(page);
  await page.emulateMedia({ colorScheme: "dark" });

  await card.getByLabel(`Type ${subject} to confirm`).fill(subject);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // Scoped to the page body: the sync banner in the root layout is also a live region,
  // so a bare getByRole("status") can match two nodes.
  await expect(page.locator("p.done")).toHaveText(`Reset ${subject}'s data.`);

  // The account survives the reset; only its data is gone.
  const after = page.locator("li.card", { hasText: subject });
  await expect(after).toBeVisible();
  await expect(after.locator(".status")).toHaveText("No plan yet");
});

test("the operator screen is invisible to everyone else", async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ "x-gain-e2e-user": homeDevUserFor(testInfo.project.name) });

  const response = await page.goto("/admin");

  // 404, not 403: a 403 would confirm both that the route exists and that this instance
  // has an operator configured.
  expect(response?.status()).toBe(404);
});
