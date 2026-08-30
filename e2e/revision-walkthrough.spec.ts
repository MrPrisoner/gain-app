/**
 * Phase 8's own "done when": CLAUDE.md's "Exercise slugs are load-bearing" invariant
 * names the whole risk this phase closes — if a revised plan returns `goblet-squat` as
 * `gobletsquat` and GAIN treats that as a new exercise instead of the same one renamed,
 * every chart and progression calculation keyed on the slug splits in two, nothing
 * errors, and the loss is unrecoverable. Every earlier phase-8 unit and integration test
 * verifies one piece of the mechanism that prevents that — the rename write path, the
 * diff presentation, the `/import` route's disposition handling — but none of them
 * proves the full loop end to end. This spec does: log a set under the old slug, import
 * a revision that renames it, choose the rename in the review UI, commit, and confirm
 * the Progress screen shows that same logged set under the NEW slug (and that the OLD
 * slug no longer has anything to show at all, per the exercise-occurrences lookup being
 * keyed off the plan's *current* contract). The final navigation is the only assertion
 * in the whole suite that would catch a real end-to-end split.
 *
 * `fixtures/plans/home-training-v2.md` (authored for phase 8's own diff/rename tests)
 * renames `goblet-squat` to `gobletsquat` and `rear-delt-reverse-fly` to
 * `prone-reverse-fly`, and drops `hammer-curl` outright — three departed slugs, so three
 * disposition rows. `goblet-squat` -> `gobletsquat` is an exact-normalization match (the
 * diff engine's rename heuristic strips punctuation before comparing), so it arrives
 * pre-selected in the review UI; the other two arrive blank and have to be chosen by
 * hand, which is what keeps the commit button disabled until this spec answers them.
 *
 * This spec needs its own isolated dev user (`revisionDevUserFor`, `e2e/env.ts`) rather
 * than `E2E_DEV_USER` or `home-walkthrough.spec.ts`'s users: importing a revision changes
 * the account's current plan version, and `fullyParallel: true` runs this file
 * concurrently across all three viewport projects, so a shared account would let one
 * project's import land mid-assertion of another (the same hazard `homeDevUserFor`
 * exists for — see its doc comment). The seed
 * itself happens here, in the spec, via `seedFixturePlan` directly — not in
 * `global-setup.ts` — since nothing else needs this user provisioned ahead of time.
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG, revisionDevUserFor, seededDataDir } from "./env";
import { dismissPreSessionPrompt, finishSession, logSetThroughRest, openExercise } from "./helpers";
import { seedFixturePlan } from "./seed";

const V2_FIXTURE_PATH = path.join(process.cwd(), "fixtures/plans/home-training-v2.md");

test("a logged goblet-squat set survives a rename to gobletsquat, end to end through import and review", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);

  const devUser = revisionDevUserFor(testInfo.project.name);
  seedFixturePlan(seededDataDir(), devUser);
  await page.setExtraHTTPHeaders({ "x-gain-e2e-user": devUser });

  // --- Log a goblet-squat set in session A (v1's own catalogue slug). Goblet squat is
  // the first tracked exercise in session A's main block, so it opens by default —
  // nothing here needs the warm-up pills, which never gate the working blocks. This is
  // also this account's very first-ever set, so the strip pre-fills reps from the
  // prescription's own lower bound (8) and weight from the goblet load's `default_kg`
  // (10) rather than from any prior history. ---
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Goblet squat");
  await logSetThroughRest(page);

  const loggedText = await openExercise(page)
    .locator(".ledger-row.logged .led-actual")
    .first()
    .innerText();
  const weightMatch = loggedText.match(/(\d+(?:\.\d+)?)\s*kg/);
  const repsMatch = loggedText.match(/^(\d+)/);
  expect(weightMatch, `expected a weight in the logged set "${loggedText}"`).not.toBeNull();
  expect(repsMatch, `expected reps in the logged set "${loggedText}"`).not.toBeNull();
  const weightKg = weightMatch![1];
  const reps = repsMatch![1];

  await page.getByRole("button", { name: "End session" }).click();
  await finishSession(page);
  await expect(page).toHaveURL(/\/$/);

  // --- Baseline: the set is visible on the OLD slug's progress detail before any
  // revision exists. Read the actual value off the chart's point, not just the chart's
  // presence — a Sparkline renders its <svg> container in every state, populated or not
  // (CLAUDE.md's phase-7 review note), so only the point's own reading proves data.
  // `window=full` matters here for the *second* navigation below: the detail page
  // defaults to the "since current version" window (`src/lib/export/windows.ts`), and
  // once v2 is committed that window starts at v2's import time — after this set was
  // logged — so the default would exclude it and this spec would be asserting on an
  // empty chart by accident rather than proving anything. Passed on both navigations for
  // symmetry, though it is only load-bearing on the post-rename one. ---
  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress/exercises/A/goblet-squat?window=full`);
  const baselinePoint = page.locator(".hit");
  await expect(baselinePoint).toHaveCount(1);
  await expect(baselinePoint).toHaveAttribute(
    "aria-label",
    new RegExp(`^${weightKg} kg on \\d{4}-\\d{2}-\\d{2} × ${reps} reps$`),
  );

  // --- Import v2: paste, check, and land on the review screen. ---
  await page.goto("/import");
  const v2Source = fs.readFileSync(V2_FIXTURE_PATH, "utf8");
  await page.getByPlaceholder("Paste the plan document here…").fill(v2Source);
  await page.getByRole("button", { name: "Check the plan" }).click();

  await expect(page.getByRole("heading", { name: "Review the revision" })).toBeVisible();
  await expect(page.getByText("What the AI says changed")).toBeVisible();

  const targetsSummary = page.locator("summary", { hasText: "Targets changed" });
  await expect(targetsSummary).toBeVisible();
  const targetsCount = Number(await targetsSummary.locator(".count").innerText());
  expect(targetsCount, "Targets changed should report a nonzero count").toBeGreaterThan(0);

  await expect(page.locator(".row")).toHaveCount(3);

  // --- The commit button is disabled before every disposition has an answer.
  // goblet-squat -> gobletsquat is an exact-normalization match and arrives
  // pre-selected; rear-delt-reverse-fly and hammer-curl arrive blank, which is enough on
  // its own to keep the button disabled here. ---
  const commitButton = page.getByRole("button", { name: "Commit revision" });
  await expect(commitButton).toBeDisabled();

  await page.getByLabel("What happened to Goblet squat?").selectOption("rename:gobletsquat");
  await page
    .getByLabel("What happened to Rear-delt reverse fly (prone)?")
    .selectOption("rename:prone-reverse-fly");
  await page.getByLabel("What happened to Hammer curl?").selectOption("removed");

  await expect(commitButton).toBeEnabled();
  await commitButton.click();
  await page.waitForURL(/\/$/);

  // --- The assertion the whole phase exists for: the set logged under the OLD slug is
  // visible on the NEW slug's progress detail, by its actual value. ---
  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress/exercises/A/gobletsquat?window=full`);
  const renamedPoint = page.locator(".hit");
  await expect(renamedPoint).toHaveCount(1);
  await expect(renamedPoint).toHaveAttribute(
    "aria-label",
    new RegExp(`^${weightKg} kg on \\d{4}-\\d{2}-\\d{2} × ${reps} reps$`),
  );

  // --- And the OLD slug no longer shows a second, separate series for that data. Its
  // exercise-occurrence lookup is keyed off the plan's *current* contract (`src/lib/
  // progress/exercise-series.ts`'s `exerciseOccurrences`), and goblet-squat no longer
  // appears there at all once the rename has committed — so this 404s rather than
  // rendering an empty or orphaned chart, which is stronger evidence of "no split" than
  // an empty chart would be. ---
  const oldSlugResponse = await page.goto(
    `/plan/${E2E_PLAN_SLUG}/progress/exercises/A/goblet-squat`,
  );
  expect(oldSlugResponse?.status()).toBe(404);
  await expect(page.locator(".status")).toHaveText("404");
});
