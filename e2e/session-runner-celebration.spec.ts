/**
 * The celebration screen a completed session lands on (UI §8, "Settled
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
 * 4. **No horizontal overflow at 360px** with it open — UI §12 asks this of
 *    every screen, and a full-viewport element whose children are positioned by percentage
 *    is exactly the shape that gets it wrong.
 * 5. **Neither ending leaves the session on the history stack.** The user is done with the
 *    app when they reach home, and Back is how a phone is put down — it must not walk back
 *    into a workout that is already finished.
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth setup here.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import {
  assertNoHorizontalOverflow,
  dismissPreSessionPrompt,
  logSetThroughRest,
  workoutClientId,
  workoutCountFor,
  workoutStatusOf,
} from "./helpers";

test("the workout is already complete before the celebration is dismissed", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);

  // Lazy start (ARCHITECTURE §9, "Offline model"): the `gain:workout:...` localStorage key
  // is only written on the *first* workout-scoped write, not on mount. Finish and the
  // red-flag stop below both write-then-clear that key within one async call, so there is
  // no window after either to read it from. Logging one set first commits the deferred
  // start and writes the key via `onCommit` — and nothing clears it again until the
  // terminating action runs — so it is the earliest point this spec can read it safely.
  //
  // This spec used to also assert that a zero-set finish still creates a workout; under
  // lazy start that assertion moved to `home-walkthrough.spec.ts`, which is now the only
  // e2e proof of it.
  await logSetThroughRest(page);
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
  // The plan name now renders twice on Home (`NextSessionCard`'s featured card and the
  // `.plan-admin` section below it, since `90c81d0` merged the two Home cards), so a
  // plain role query is ambiguous — `.plan-name` is unique to the featured card.
  await expect(page.locator(".plan-name", { hasText: "Home Training Plan" })).toBeVisible();
});

test("a red-flag stop goes straight home without celebrating", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);

  // Same lazy-start reasoning as the test above: log one set first so the resume key
  // exists to read, well before the red-flag stop that would otherwise clear it.
  await logSetThroughRest(page);
  const clientId = await workoutClientId(page, "A");

  await page.locator(".log-strip .strip-change").click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Stop (red flag)").check();
  await sheet.getByRole("button", { name: "Save" }).click();

  await page.waitForURL(/\/$/);
  await expect(page.locator(".celebrate-card")).toHaveCount(0);
  expect(workoutStatusOf(clientId)).toBe("stopped");
});

/**
 * Both endings used to assign the browser's location, which pushes a history entry: the
 * finished session stayed on the stack, and Back restored it from bfcache with
 * `celebrating` still true. The user tapped Back to quit and got the confetti again, over
 * a workout they had finished minutes earlier.
 *
 * `page.goBack()` is asserted to land *anywhere but* the session rather than on a specific
 * URL, because what the entry behind home is depends on how the spec got there — the
 * guarantee is about what is no longer reachable, not about what replaced it.
 */
test("back from the celebration cannot re-enter the finished session", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);

  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Finish session" }).click();
  await page.locator(".celebrate-card").getByRole("button", { name: "Back to home" }).click();
  await page.waitForURL(/\/$/);

  await page.goBack();

  expect(page.url()).not.toContain("/session/");
  await expect(page.locator(".celebrate-card")).toHaveCount(0);
  await expect(page.locator(".log-strip")).toHaveCount(0);
});

test("back from a red-flag stop cannot re-enter the stopped session", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);

  await page.locator(".log-strip .strip-change").click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Stop (red flag)").check();
  await sheet.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/$/);

  await page.goBack();

  expect(page.url()).not.toContain("/session/");
  await expect(page.locator(".log-strip")).toHaveCount(0);
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
