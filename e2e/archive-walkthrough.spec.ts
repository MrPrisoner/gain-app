/**
 * Plan archiving, end to end. Semantics settled 2026-08-23.
 *
 * The point of the walkthrough is the asymmetry, and it is only convincing in a
 * browser: the plan leaves the active list into a collapsed Archived group, its history
 * still opens from there, the session runner refuses, and unarchiving puts it back
 * exactly where it was. The read routes staying open is the load-bearing half — before
 * this feature landed, `export`, `history` and `progress` all 404'd on `archived_at`,
 * so a button shipped against those guards would have made archiving a silent,
 * unrecoverable loss of the user's own logged history.
 *
 * Its own per-project dev user (`archiveDevUserFor`, `e2e/env.ts`): every assertion here
 * is about what the whole Home screen lists, so a shared account — or the same spec
 * running concurrently in the other two viewport projects, which `fullyParallel: true`
 * guarantees — would see another run's archive land mid-assertion.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG, archiveDevUserFor, seededDataDir } from "./env";
import { assertNoHorizontalOverflow, dismissPreSessionPrompt } from "./helpers";
import { seedFixturePlan } from "./seed";

test("a plan archives off Home, keeps its history, refuses a session, and comes back", async ({
  page,
}, testInfo) => {
  const devUser = archiveDevUserFor(testInfo.project.name);
  seedFixturePlan(seededDataDir(), devUser);
  await page.setExtraHTTPHeaders({ "x-gain-e2e-user": devUser });

  // --- The plan is active: its card is on Home and the session runner opens. ---
  await page.goto("/");
  const planCard = page.locator(".plan-admin");
  await expect(planCard).toHaveCount(1);
  await expect(page.locator(".archived-group")).toHaveCount(0);

  // --- Archive it from the card. ---
  await page.getByRole("button", { name: "Archive plan" }).click();

  await expect(page.locator(".plan-admin")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Everything is archived" })).toBeVisible();

  // --- It lands in a collapsed group: the links inside are not reachable until the
  // group is opened, which is what "collapsed" has to mean to be worth asserting. ---
  const group = page.locator(".archived-group");
  await expect(group).toBeVisible();
  await expect(group).not.toHaveAttribute("open", /.*/);
  const historyLink = group.getByRole("link", { name: "History" });
  await expect(historyLink).toBeHidden();

  await group.locator("summary").click();
  await expect(historyLink).toBeVisible();
  await assertNoHorizontalOverflow(page);

  // --- Its history still opens, marked archived. This is the assertion the whole
  // feature turns on. ---
  await historyLink.click();
  await expect(page.getByRole("heading", { name: /history$/ })).toBeVisible();
  await expect(page.locator(".archived")).toContainText("Archived");

  // --- Export and versions too. ---
  await page.goto(`/plan/${E2E_PLAN_SLUG}/export`);
  await expect(page.getByRole("heading", { name: "Export for review" })).toBeVisible();
  await expect(page.locator(".archived")).toContainText("Archived");

  await page.goto(`/plan/${E2E_PLAN_SLUG}/versions`);
  await expect(page.getByRole("link", { name: /^v1/ })).toBeVisible();

  // --- Starting a new session is the one thing it refuses. ---
  const sessionResponse = await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  expect(sessionResponse?.status()).toBe(404);
  await expect(page.locator(".status")).toHaveText("404");

  // --- Unarchive puts it back exactly where it was. ---
  await page.goto("/");
  await page.locator(".archived-group summary").click();
  await page.getByRole("button", { name: "Unarchive" }).click();

  await expect(page.locator(".plan-admin")).toHaveCount(1);
  await expect(page.locator(".archived-group")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Everything is archived" })).toHaveCount(0);

  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();
});
