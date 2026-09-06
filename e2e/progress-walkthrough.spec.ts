// e2e/progress-walkthrough.spec.ts
/**
 * The hub's own durable proof. goblet-squat is prescribed in both session A ([8,12]) and
 * session D ([12,15]) of the fixture, and the redesign splits what that means: it is ONE
 * mover row, because whether squats are moving is not a per-session question, and up to
 * TWO readiness rows, because a range belongs to an occurrence. A regression in either
 * direction — a movers list that keys on (session, exercise), or a readiness list that
 * collapses to the slug — shows up here.
 *
 * The readiness half also has to be driven into a *positive* state to prove anything: an
 * always-empty "Ready to go up" section renders no heading and no list, which every
 * assertion about the rest of the hub is happy with. That is what the third test does, and
 * why it dials the reps rather than accepting the pre-fill.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG, progressReadyDevUserFor, seededDataDir } from "./env";
import {
  assertNoHorizontalOverflow,
  dismissPreSessionPrompt,
  finishSession,
  logSetThroughRest,
  openExercise,
} from "./helpers";
import { seedFixturePlan } from "./seed";
import type { Page } from "@playwright/test";

// The second test's link click depends on the first test's mover row existing —
// `fullyParallel: true` (playwright.config.ts) otherwise schedules all three tests in
// this file onto separate workers at once, and the second test would find an empty
// `.mover-list` racing the first test's still-in-flight session log.
test.describe.configure({ mode: "serial" });

/** `reps`, when given, is dialled into the strip before every set — the pre-fill starts at
 * the range's lower bound (or the last performance), which is by definition not a
 * top-of-range session, so a readiness assertion has to state the number it wants. */
async function logGobletSquat(
  page: Page,
  sessionKey: string,
  sets: number,
  reps?: number,
): Promise<void> {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/${sessionKey}`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  const pills = page.locator(".checkoff-pills .pill");
  const pillCount = await pills.count();
  for (let i = 0; i < pillCount; i++) await pills.nth(i).click();

  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Goblet squat");
  for (let i = 0; i < sets; i++) {
    if (reps !== undefined) {
      await page.locator('.log-strip input[aria-label="Reps"]').fill(String(reps));
    }
    await logSetThroughRest(page);
  }
  await page.getByRole("button", { name: "End session" }).click();
  await finishSession(page);
}

test("the hub answers what changed, and groups movements the way each section needs", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await logGobletSquat(page, "A", 3);
  await logGobletSquat(page, "D", 2);

  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress?window=all`);

  // Counts stay "at least one" rather than exact: this suite shares one seeded database
  // across three parallel viewport projects (history-walkthrough.spec.ts), so how many
  // times a session has been logged by the time this runs is not deterministic.
  await expect(page.getByRole("heading", { name: "Where you're moving" })).toBeVisible();

  // One mover row for the movement, whichever sessions it was logged in.
  const moverRows = page.locator(".mover-list li").filter({ hasText: "Goblet squat" });
  await expect(moverRows).toHaveCount(1);

  // The row's sparkline must actually be populated — Sparkline renders its <svg
  // aria-label> in the empty branch too, so the container proves nothing.
  await expect(
    page.locator('svg[aria-label="Goblet squat progress trend chart"] .dot').first(),
  ).toBeVisible();

  // The consistency strip is a real chart with real bars, not an empty well.
  await expect(
    page.locator('svg[aria-label="sessions per week bar chart"] rect').first(),
  ).toBeVisible();

  await assertNoHorizontalOverflow(page);
});

test("a mover row links to a session the movement is actually prescribed in", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress?window=all`);
  const link = page.locator(".mover-list li a").first();
  await link.click();
  // The detail route 404s on an unprescribed (session, exercise) pair, so arriving at a
  // rendered heading is the assertion.
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.getByText("not prescribed in this session")).toHaveCount(0);
});

test("a session at the top of its range surfaces in Ready to go up", async ({ page }, testInfo) => {
  test.setTimeout(90_000);

  // Its own account: readiness reads the movement's LATEST session-A workout, so on the
  // shared user a sibling project's concurrent 8-rep session would quietly replace the
  // top-of-range one this test just logged — see `progressReadyDevUserFor`.
  const devUser = progressReadyDevUserFor(testInfo.project.name);
  seedFixturePlan(seededDataDir(), devUser);
  await page.setExtraHTTPHeaders({ "x-gain-e2e-user": devUser });

  // Session A prescribes goblet-squat as `sets: 3, reps: [8, 12]`, so three sets at 12 is
  // the double-progression ready condition exactly.
  await logGobletSquat(page, "A", 3, 12);

  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress?window=all`);
  await expect(page.getByRole("heading", { name: "Ready to go up" })).toBeVisible();

  const rows = page.locator(".ready-list li");
  await expect(rows).not.toHaveCount(0);
  await expect(rows.filter({ hasText: "Goblet squat" })).toHaveCount(1);
  await expect(page.getByText("12/12/12 — ready for a load increase")).toBeVisible();

  // The headline's count is built from the same predicate as the list (`readyOccurrences`),
  // so it cannot read zero above a list with a row in it.
  await expect(
    page.locator(".headline .stat", { hasText: "ready to go up" }).locator("strong"),
  ).not.toHaveText("0");

  await assertNoHorizontalOverflow(page);
});

test("the window pills navigate and mark the current span", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress`);
  // 12w is the default and is current without any query string.
  await expect(page.locator('.window-pills a[data-window="12w"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.locator('.window-pills a[data-window="all"]').click();
  await expect(page).toHaveURL(/window=all/);
  await expect(page.locator('.window-pills a[data-window="all"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
  await assertNoHorizontalOverflow(page);
});
