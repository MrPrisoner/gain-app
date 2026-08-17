/**
 * Phase 7a's "done when" (docs/superpowers/specs/2026-08-15-phase-7a-home-design.md):
 * Home suggests the right next session, an activity can be logged, and a finished
 * workout gets exactly one next-morning prompt, the following day, never again once
 * answered.
 *
 * `test.use({ timezoneId: "UTC" })` makes the fake-clock arithmetic below exact: both
 * the workout's `completed_at` and the "yesterday" it is compared against are pinned to
 * noon UTC, so no local offset can push either across a date boundary.
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth setup here.
 *
 * This is the one spec that asserts on whole-account state (the suggested next session
 * and the full activity list have no `client_id` to scope by) rather than its own
 * workout, so it runs as its own dedicated bypass user (`homeDevUserFor`) instead of the
 * one every other spec shares — otherwise a concurrently-run spec finishing an unrelated
 * session would land in between and change what "next" means here (`docs/ROADMAP.md`,
 * "Loose ends"). `x-gain-e2e-user` (`src/hooks.server.ts`) is how a single running dev
 * server tells this browser context apart from every other.
 *
 * One user per *project*, not one shared across all three: `test.use()` cannot vary by
 * project (it is static config, evaluated once for every project that runs this file),
 * so the header is set from `testInfo.project.name` inside the test body instead, before
 * the first navigation — the same three viewport projects would otherwise run this file
 * concurrently against one account and race each other exactly like the bug this file
 * exists to avoid.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG, homeDevUserFor } from "./env";
import {
  activitiesOf,
  assertNoHorizontalOverflow,
  dismissPreSessionPrompt,
  finishSession,
} from "./helpers";

test.use({ timezoneId: "UTC" });

test("home suggests the next session, logs an activity, and asks the next-morning prompt once", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);

  const devUser = homeDevUserFor(testInfo.project.name);
  await page.setExtraHTTPHeaders({ "x-gain-e2e-user": devUser });

  const realNow = new Date();
  const yesterdayNoon = new Date(realNow);
  yesterdayNoon.setUTCDate(realNow.getUTCDate() - 1);
  yesterdayNoon.setUTCHours(12, 0, 0, 0);

  // Finish session A under a clock fixed to yesterday, so the workout's completed_at
  // (the client's own clock, ops.ts) lands on a date the next-morning prompt can
  // recognise as "yesterday" once the clock is restored below. Ending immediately
  // (rather than logging every set) is enough — nothing here is testing the runner.
  await page.clock.setFixedTime(yesterdayNoon);
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();
  await page.getByRole("button", { name: "End session" }).click();
  await finishSession(page);
  await expect(page).toHaveURL(/\/$/);

  // Restore the real clock — "yesterday" only means anything relative to today — and
  // reload so both the server load and the client's next-morning windowing see it.
  await page.clock.setFixedTime(new Date());
  await page.reload();

  // --- Suggested next session: A was just done, B is next in [A, B, C, D]. ---
  await expect(page.locator(".next-session .suggested-key")).toHaveText("B");

  // --- Next-morning prompt: due, answerable once, then gone for good. ---
  await expect(page.locator(".next-morning")).toBeVisible();
  await page.locator(".next-morning .scale-cell").first().click();
  await expect(page.locator(".next-morning")).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".next-morning")).toHaveCount(0);

  // --- Activity logging: a new kind, submitted through the sheet. ---
  // Hydration must be settled before this click: the chip-add button's handler lives
  // in ActivityStrip's client-side state, and nothing above this line actually depends
  // on hydration having finished (the reload's `.next-morning` absence is true from
  // the server-rendered HTML alone). Same fix as `export-walkthrough.spec.ts`'s
  // "rejects a window it does not offer" test, which hit the identical race.
  await page.waitForLoadState("networkidle");
  await page.locator(".activity-strip .chip-add").click();
  await page.getByPlaceholder("e.g. squash").fill("Squash");
  await page.getByRole("button", { name: "Log it" }).click();
  await expect(page.locator(".sheet-backdrop")).toHaveCount(0);

  const activities = activitiesOf(devUser);
  expect(activities.some((a) => a.kind === "squash")).toBe(true);

  await page.reload();
  await expect(page.locator(".activity-strip .chip", { hasText: "squash" })).toBeVisible();

  await assertNoHorizontalOverflow(page);
});
