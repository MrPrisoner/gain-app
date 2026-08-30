/**
 * The symptom guide (UI-DECISIONS §5): the plan's own
 * `safety.symptom_framework` rendered in the runner, reachable from the header at any
 * point in the session and quoted inline on the deviation sheet's `stop_red_flag`
 * choice. What matters is that the real level text from the fixture is on screen — not
 * that the sheet's shell rendered, which is the vacuous-assertion trap recorded in
 * `CLAUDE.md` under "Rules learned the hard way".
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth setup here.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import { assertNoHorizontalOverflow, dismissPreSessionPrompt } from "./helpers";

test("the symptom guide opens from the header and shows the plan's own levels", async ({
  page,
}) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);

  await page.getByRole("button", { name: "Symptom guide" }).click();

  const sheet = page.locator(".sheet");
  await expect(sheet).toBeVisible();
  // The real fixture text (`fixtures/plans/home-training-v1.md`), not a placeholder —
  // proving the load path actually carried `safety.symptom_framework` through.
  await expect(sheet.getByText("Mild, familiar, stable")).toBeVisible();
  await expect(sheet.getByText("Building, or changing how you move")).toBeVisible();
  await expect(sheet.getByText("Sharp, escalating")).toBeVisible();
  await expect(sheet.getByText("Reduce the load.")).toBeVisible();
  await expect(sheet.getByText("No clinical assessment underpins this plan")).toBeVisible();

  await assertNoHorizontalOverflow(page);

  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);
});

test("the deviation sheet quotes the red level on a red-flag stop", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);

  await page.locator(".log-strip .strip-change").click();
  const sheet = page.locator(".sheet");
  await expect(sheet).toBeVisible();

  // Not shown for the default "Skip" choice — only once the red-flag option is selected.
  await expect(sheet.getByText("Get it assessed")).toHaveCount(0);

  await sheet.getByText("Stop (red flag)").click();
  await expect(sheet.getByText("Sharp, escalating")).toBeVisible();
  await expect(sheet.getByText("Get it assessed")).toBeVisible();
});
