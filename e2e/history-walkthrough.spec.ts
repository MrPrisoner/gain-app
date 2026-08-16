// e2e/history-walkthrough.spec.ts
/**
 * Resolves its own workout by `client_id` rather than scanning the History list: every
 * spec in this suite runs against one shared seeded database across three parallel
 * viewport projects (`fullyParallel: true`, `playwright.config.ts`), so a bare "newest
 * Session A" list scan can land on a different test's in-progress workout instead of this
 * one.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import {
  assertNoHorizontalOverflow,
  dismissPreSessionPrompt,
  logSetThroughRest,
  workoutClientId,
  workoutIdOf,
} from "./helpers";

test("a logged workout appears in History and drills into matching set detail", async ({
  page,
}) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  const pills = page.locator(".checkoff-pills .pill");
  const pillCount = await pills.count();
  for (let i = 0; i < pillCount; i++) await pills.nth(i).click();
  await logSetThroughRest(page);

  const clientId = await workoutClientId(page, "A");
  const workoutId = workoutIdOf(clientId);
  expect(workoutId, "the set log must have synced before History can show it").toBeTruthy();

  await page.goto(`/plan/${E2E_PLAN_SLUG}/history`);
  await expect(page.getByRole("link", { name: /Squat, Press & Row/ }).first()).toBeVisible();

  await page.goto(`/plan/${E2E_PLAN_SLUG}/history/${workoutId}`);
  await expect(page.getByRole("heading", { name: "Squat, Press & Row" })).toBeVisible();
  await expect(page.getByText("Goblet squat")).toBeVisible();
  await expect(page.getByText(/Plan v\d+/)).toBeVisible();

  await assertNoHorizontalOverflow(page);
});
