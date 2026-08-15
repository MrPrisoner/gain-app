/**
 * The celebration screen a completed session lands on (UI-DECISIONS §8, "Settled
 * 2026-08-15"). What is worth asserting here is not that confetti appears — it is that a
 * decorative screen was inserted into the one flow in the app that ends a workout, without
 * becoming load-bearing in it:
 *
 * 1. **The workout is already finished when the screen appears.** The finish op is written
 *    before it renders, so nothing about dismissing it can change what reaches the export.
 *    A user who backgrounds the phone here has still trained.
 * 2. **A red-flag stop never celebrates.** A session that ended because something hurt is
 *    not an occasion, and confetti over it is the app cheering at the wrong moment.
 * 3. **`prefers-reduced-motion` drops the animation, not the way out.** The message and the
 *    button survive; only the particle field goes.
 * 4. **No horizontal overflow at 360px** with it open — UI-DECISIONS §12 asks this of
 *    every screen, and a full-viewport element whose children are positioned by percentage
 *    is exactly the shape that gets it wrong.
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth setup here.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import {
  assertNoHorizontalOverflow,
  dismissPreSessionPrompt,
  workoutClientId,
  workoutCountFor,
  workoutStatusOf,
} from "./helpers";

test("the workout is already complete before the celebration is dismissed", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  const clientId = await workoutClientId(page, "A");

  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Finish session" }).click();

  const card = page.locator(".celebrate-card");
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Back to home" })).toBeVisible();

  // The point of the whole design: this is true *now*, with the screen still up and
  // nothing dismissed. Nothing below this line can change it.
  await expect
    .poll(() => workoutStatusOf(clientId), {
      message: "the finish op must land before the confetti",
    })
    .toBe("completed");
  expect(workoutCountFor(clientId)).toBe(1);

  await assertNoHorizontalOverflow(page);

  await card.getByRole("button", { name: "Back to home" }).click();
  await page.waitForURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Home Training Plan" })).toBeVisible();
});

test("a red-flag stop goes straight home without celebrating", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  const clientId = await workoutClientId(page, "A");

  await page.locator(".log-strip .strip-change").click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Stop (red flag)").check();
  await sheet.getByRole("button", { name: "Save" }).click();

  await page.waitForURL(/\/$/);
  await expect(page.locator(".celebrate-card")).toHaveCount(0);
  expect(workoutStatusOf(clientId)).toBe("stopped");
});

test("reduced motion drops the confetti but keeps the message and the way out", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);

  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Finish session" }).click();

  const card = page.locator(".celebrate-card");
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading")).not.toBeEmpty();
  await expect(card.getByRole("button", { name: "Back to home" })).toBeVisible();
  await expect(page.locator(".confetti")).toBeHidden();
});
