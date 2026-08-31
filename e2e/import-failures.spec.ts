/**
 * `/import`'s failure screens (review 2026-08-27, U3). CLAUDE.md's invariant is "every
 * failed import produces a pasteable report — not just contract violations", and the
 * parser side of that was already thoroughly tested (`tests/parse.test.ts`'s seven
 * `ParseFailureKind` variants) while the *screen* that renders those reports had no
 * coverage of any kind — no e2e ever rendered a parse failure, the pasted-bundle
 * explanation (UI §11), or the blocking-revision report, and `blockingReport`
 * (now `$lib/import/blocking-report.ts`, `tests/import/blocking-report.test.ts`) lived
 * where no unit test could reach it.
 *
 * Three scenarios, one spec, because they share the same page and the same "did the
 * report actually reach the clipboard" assertion style — granting clipboard permissions
 * up front so `copyText`'s primary path (not its download fallback) is what gets proven:
 *
 * 1. A document with no fenced ```gain-plan block at all (`missing_block`) — the generic
 *    "Nothing was imported" report, addressed to the AI, copyable.
 * 2. A pasted export bundle — UI §11's specific wrong-document explanation,
 *    which gets no field paths and no copy action, since sending a bundle back to the
 *    chat would only confuse it.
 * 3. A blocking revision: re-submitting the fixture's own v1 document as a "revision" of
 *    the v1 already on the account fails the round-trip's version-increment rule
 *    (`src/lib/diff/diff.ts`) without needing a second fixture — and proves
 *    `blockingReport`'s wiring into the route, not just its own formatting.
 *
 * Scenario 3 needs its own seeded account (`importFailureDevUserFor`, `e2e/env.ts`) for
 * the same reason `revisionDevUserFor` does: importing anything changes account state,
 * and `fullyParallel: true` runs this spec across all three viewport projects at once.
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { importFailureDevUserFor, seededDataDir } from "./env";
import { assertNoHorizontalOverflow } from "./helpers";
import { seedFixturePlan } from "./seed";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const V1_FIXTURE_PATH = path.join(process.cwd(), "fixtures/plans/home-training-v1.md");
const v1Source = fs.readFileSync(V1_FIXTURE_PATH, "utf8");

async function clipboardText(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test("a document with no contract block gets a pasteable, copyable report", async ({ page }) => {
  await page.goto("/import");
  // The empty paste box, before anything else happens — `/import` is the app's primary
  // input and was the largest surface with no overflow check of any kind.
  await assertNoHorizontalOverflow(page);
  await page
    .getByPlaceholder("Paste the plan document here…")
    .fill("Just some prose, no fenced block anywhere in here.");
  await page.getByRole("button", { name: "Check the plan" }).click();

  await expect(page.getByRole("heading", { name: "Nothing was imported" })).toBeVisible();
  const report = page.locator(".report");
  await expect(report).toContainText("GAIN could not import this plan document");
  await expect(report).toContainText("No fenced ```gain-plan block was found");

  // The pasted text stays in the box (UI §11: a failed import must not feel
  // like a wall) rather than being cleared out from under the user.
  await expect(page.getByPlaceholder("Paste the plan document here…")).toHaveValue(
    "Just some prose, no fenced block anywhere in here.",
  );

  // A report is a wide monospace block of field paths — exactly the shape that pushes a
  // 360 px screen sideways if it is not allowed to scroll inside its own container.
  await assertNoHorizontalOverflow(page);

  const copyButton = page.getByRole("button", { name: "Copy report for the AI" });
  await copyButton.click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await clipboardText(page)).toBe(await report.innerText());
});

test("a pasted export bundle gets the wrong-document explanation, with no report to copy", async ({
  page,
}) => {
  await page.goto("/import");
  await page
    .getByPlaceholder("Paste the plan document here…")
    .fill(
      [
        "# GAIN Export",
        "",
        "## 1. The current plan",
        "## 2. Progress summary",
        "## 3. Raw logs",
        "## 4. How to return an updated plan",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "Check the plan" }).click();

  await expect(
    page.getByRole("heading", { name: "That is a GAIN export, not a plan" }),
  ).toBeVisible();
  await expect(page.getByText("Export bundles are what GAIN hands")).toBeVisible();

  // Never a field-path report and never a copy-back-to-the-AI action for this case
  // (UI §11) — the fix is the user pasting the right document, not the AI's.
  await expect(page.locator(".report")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy report for the AI" })).toHaveCount(0);

  await assertNoHorizontalOverflow(page);
});

test("a revision that fails the version-increment rule blocks commit and its report is copyable", async ({
  page,
}, testInfo) => {
  const devUser = importFailureDevUserFor(testInfo.project.name);
  seedFixturePlan(seededDataDir(), devUser);
  await page.setExtraHTTPHeaders({ "x-gain-e2e-user": devUser });

  await page.goto("/import");
  await page.getByPlaceholder("Paste the plan document here…").fill(v1Source);
  await page.getByRole("button", { name: "Check the plan" }).click();

  await expect(page.getByRole("heading", { name: "Review the revision" })).toBeVisible();
  await expect(page.getByText("This revision cannot be imported yet")).toBeVisible();
  await expect(
    page.getByText(/version must be greater than the current stored version/),
  ).toBeVisible();

  // Blocked, so commit can never be reached — `ready` requires zero blocking problems.
  await expect(page.getByRole("button", { name: "Commit revision" })).toBeDisabled();

  // The review screen is the widest shape on the route — full-width `<select>`s, the
  // `<details>` diff groups and the warnings panel — and UI §12 named it as the
  // one most likely to break at 360 px.
  await assertNoHorizontalOverflow(page);

  const copyButton = page.getByRole("button", { name: "Copy for the AI" });
  await copyButton.click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await clipboardText(page);
  expect(copied).toContain(
    'GAIN could not accept version 1 of "home-training" as a revision of version 1.',
  );
  expect(copied).toContain("- version must be greater than the current stored version");
});
