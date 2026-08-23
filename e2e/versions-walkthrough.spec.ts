/**
 * Old plan versions stay browsable (ROADMAP, "Loose ends"; ARCHITECTURE §8).
 *
 * The "done when" is byte-identity: the v1 document opens from the UI and reads exactly
 * as it was imported, after a v2 has replaced it as current. That is the same
 * never-paraphrase guarantee the golden round-trip test protects on the export side,
 * asserted here through the browser — a `.trim()` or a stray newline anywhere between
 * the row on disk and the textarea would be invisible to every other test in the suite.
 *
 * Its own per-project dev user (`versionsDevUserFor`, `e2e/env.ts`): importing a
 * revision changes the account's current version, and `fullyParallel: true` runs this
 * file concurrently across all three viewport projects.
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG, seededDataDir, versionsDevUserFor } from "./env";
import { assertNoHorizontalOverflow } from "./helpers";
import { seedFixturePlan } from "./seed";

const V1_FIXTURE_PATH = path.join(process.cwd(), "fixtures/plans/home-training-v1.md");
const V2_FIXTURE_PATH = path.join(process.cwd(), "fixtures/plans/home-training-v2.md");

test("v1's document opens byte-identical after a v2 has replaced it", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);

  const devUser = versionsDevUserFor(testInfo.project.name);
  seedFixturePlan(seededDataDir(), devUser);
  await page.setExtraHTTPHeaders({ "x-gain-e2e-user": devUser });

  // --- Import v2, answering every disposition the rename review requires. The three
  // departed slugs and their dispositions are documented in
  // `e2e/revision-walkthrough.spec.ts`, which is where that machinery is under test —
  // here they are only the cost of getting a second version to exist. ---
  await page.goto("/import");
  await page
    .getByPlaceholder("Paste the plan document here…")
    .fill(fs.readFileSync(V2_FIXTURE_PATH, "utf8"));
  await page.getByRole("button", { name: "Check the plan" }).click();
  await expect(page.getByRole("heading", { name: "Review the revision" })).toBeVisible();

  await page.getByLabel("What happened to Goblet squat?").selectOption("rename:gobletsquat");
  await page
    .getByLabel("What happened to Rear-delt reverse fly (prone)?")
    .selectOption("rename:prone-reverse-fly");
  await page.getByLabel("What happened to Hammer curl?").selectOption("removed");
  await page.getByRole("button", { name: "Commit revision" }).click();
  await page.waitForURL(/\/$/);

  // --- Reached from the Home plan card, beside Export, Progress and History. ---
  await page.getByRole("link", { name: "Plan versions" }).click();
  await expect(page).toHaveURL(new RegExp(`/plan/${E2E_PLAN_SLUG}/versions$`));

  // Newest first, with the current one marked.
  const entries = page.locator(".versions > li");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0).locator(".no")).toHaveText("v2");
  await expect(entries.nth(0).locator(".badge")).toHaveText(/current/);
  await expect(entries.nth(1).locator(".no")).toHaveText("v1");
  await expect(entries.nth(1).locator(".badge")).toHaveCount(0);
  // The AI's own changelog is what makes the list readable rather than a list of dates.
  await expect(entries.nth(0).locator(".changelog li").first()).not.toBeEmpty();
  await assertNoHorizontalOverflow(page);

  // --- The assertion the item exists for. ---
  await entries.nth(1).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/plan/${E2E_PLAN_SLUG}/versions/1$`));

  const rendered = await page.locator("textarea.doc").inputValue();
  expect(rendered).toBe(fs.readFileSync(V1_FIXTURE_PATH, "utf8"));
  await assertNoHorizontalOverflow(page);

  // --- The current version replays verbatim too. Worth its own assertion: v2 is the
  // one whose text also feeds the export's Section 1, so a divergence here would mean
  // the two paths had stopped agreeing about what "verbatim" means. ---
  await page.goto(`/plan/${E2E_PLAN_SLUG}/versions/2`);
  await expect(page.locator("textarea.doc")).toHaveValue(fs.readFileSync(V2_FIXTURE_PATH, "utf8"));

  // A version that was never imported is a 404, not an empty page pretending to be one.
  const missing = await page.goto(`/plan/${E2E_PLAN_SLUG}/versions/7`);
  expect(missing?.status()).toBe(404);
});
