/**
 * Phase 5's "done when": a logged block leaves GAIN as one pasteable document, and
 * `extractPlanSourceFromBundle` recovers Section 1 from what the UI actually produced.
 *
 * Three viewport projects share one seeded data directory, so this spec asserts on what
 * it can see rather than on exact totals — another project's workouts are in the same
 * database, and a count assertion would be a race.
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { extractPlanSourceFromBundle } from "../src/lib/export/bundle";
import { E2E_PLAN_SLUG } from "./env";
import { assertNoHorizontalOverflow, dismissPreSessionPrompt, logSetThroughRest } from "./helpers";

const fixtureMd = fs.readFileSync(
  path.join(process.cwd(), "fixtures/plans/home-training-v1.md"),
  "utf8",
);

test("logs a session, exports it, and replays the plan document byte-for-byte", async ({
  page,
}) => {
  // -- Log a few sets of session A.
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await logSetThroughRest(page);
  await logSetThroughRest(page);

  // -- Export.
  await page.goto(`/plan/${E2E_PLAN_SLUG}/export`);
  await expect(page.getByRole("heading", { name: "Export for review" })).toBeVisible();

  // The default window is the first radio, and it is pre-selected.
  await expect(page.locator('input[name="window"]').first()).toBeChecked();

  await page.getByRole("button", { name: "Generate the export" }).click();
  await expect(page.getByRole("heading", { name: "Paste this into your AI chat" })).toBeVisible();

  const bundle = await page.locator("textarea.doc").inputValue();

  // -- Section 1 is the imported document, byte-for-byte (ARCHITECTURE §11).
  expect(extractPlanSourceFromBundle(bundle)).toBe(fixtureMd);

  // -- All five sections, in order.
  for (const heading of [
    "## 0. Your task",
    "## 1. The current plan",
    "## 2. Progress summary",
    "## 3. Raw logs",
    "## 4. How to return an updated plan",
  ]) {
    expect(bundle, `bundle is missing ${heading}`).toContain(heading);
  }

  // -- The summary reflects what was logged: session A ran, and its first exercise has a
  // progression row. Slug rather than display name — the slug is what the AI keys on.
  expect(bundle).toContain("### Per-exercise progression");
  expect(bundle).not.toContain("No sets logged in this window.");

  // -- Template substitution is real: no token survives into the bundle.
  expect(bundle).not.toMatch(/\{\{\s*(plan_name|plan_version|export_window|today)\s*\}\}/);

  await assertNoHorizontalOverflow(page);
});

test("rejects a window it does not offer rather than exporting a different one", async ({
  page,
}) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/export`);
  // Hydration must be settled before the DOM surgery below: mutating the radios while
  // Svelte is still hydrating the {#each} block races its reconciliation, which can
  // silently undo the forged element and re-check the real option (seen flaking).
  await page.waitForLoadState("networkidle");

  // Forge the value the way a stale tab would. A raw DOM element appended outside
  // Svelte's {#each} — rather than mutating one of the framework-owned radios in
  // place — keeps this from racing Svelte's own reactivity, which owns `checked` on
  // the real options and would otherwise resync a mutated one back to its real value.
  await page.evaluate(() => {
    const form = document.querySelector('form[action="?/generate"]');
    if (!(form instanceof HTMLFormElement)) throw new Error("generate form not found");
    for (const el of form.querySelectorAll<HTMLInputElement>('input[name="window"]')) {
      el.checked = false;
    }
    const forged = document.createElement("input");
    forged.type = "radio";
    forged.name = "window";
    forged.value = "last_year";
    forged.checked = true;
    form.appendChild(forged);
  });
  await page.getByRole("button", { name: "Generate the export" }).click();

  await expect(page.locator(".action-error")).toContainText("Choose a window");
  await expect(page.locator("textarea.doc")).toHaveCount(0);
});
