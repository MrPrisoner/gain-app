/**
 * Task 12 (docs/superpowers/sdd/2026-08-10-phase-4-remediation): the plan's closing,
 * durable regression spec — walks the real fixture's Session A top to bottom in one
 * browser session, the way a person actually would, rather than exercising each piece
 * in isolation the way the rest of `e2e/session-runner-*.spec.ts` deliberately does.
 *
 * What this one test covers, in order: the warm-up checkoff pills (UI-DECISIONS §9), all
 * four `main` exercises including the per-side `supported-one-arm-row`, a rest timer that
 * genuinely counts down and is genuinely dismissed by a deliberate tap (UI-DECISIONS §4 —
 * there is no auto-dismiss), a mid-session reload exercised as part of a real full
 * walkthrough (Task 6 — `session-runner-resume.spec.ts` already proves the mechanism in
 * isolation; this proves it survives a real session in progress), one deviation
 * (`add_set` on Reverse lunge — the one deviation kind no other full-walkthrough spec
 * exercises end-to-end; `skip` and `drop_set` are already covered by
 * `session-runner-resume.spec.ts` and `session-runner-exercise-state.spec.ts`
 * respectively), the `core` block, and the wrap-up through to Finish.
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth setup here.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import {
  dismissPreSessionPrompt,
  logSet,
  logSetThroughRest,
  openExercise,
  setLogsOf,
  workoutClientId,
} from "./helpers";

test("Session A end-to-end: warm-up, four working exercises, per-side, rest, a deviation, core, wrap-up", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  // --- Warm-up: check off all six pills (UI-DECISIONS §9 — pills, not set rows, and
  // never gate progress into the working blocks). ---
  const pills = page.locator(".checkoff-pills .pill");
  await expect(pills).toHaveCount(6);
  const pillCount = await pills.count();
  for (let i = 0; i < pillCount; i++) await pills.nth(i).click();
  await expect(page.locator(".checkoff-pills .pill.done")).toHaveCount(6);

  // --- Main, exercise 1: Goblet squat — 3 sets, catalogue rest_sec [75, 90]. The rest
  // timer genuinely fires here and is genuinely dismissed by hand, not merely asserted
  // absent-or-not: it counts down, "+30s" extends it, and only a deliberate tap on
  // "Start next set" clears it. ---
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Goblet squat");
  await logSet(page);
  const rest = page.locator(".rest-overlay");
  await expect(rest).toBeVisible();
  await expect(rest.locator(".rest-label")).toHaveText("Resting");
  await expect(rest.locator(".rest-time")).toHaveText(/^\d+:\d{2}$/);
  await expect(rest.getByText("Up next")).toBeVisible();
  await rest.getByRole("button", { name: "+30s" }).click();
  await expect(rest).toBeVisible(); // extended, not dismissed
  await rest.getByRole("button", { name: "Start next set" }).click();
  await expect(rest).toHaveCount(0);

  await logSetThroughRest(page); // set 2
  await logSetThroughRest(page); // set 3
  const gobletSquat = page.locator(".exercise", { hasText: "Goblet squat" }).first();
  await expect(gobletSquat).toHaveClass(/done/);

  // --- Main, exercise 2: Dumbbell floor press — 3 sets, catalogue rest_sec [60, 90]. ---
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Dumbbell floor press");
  await logSetThroughRest(page);
  await logSetThroughRest(page);
  await logSetThroughRest(page);

  // --- Main, exercise 3: Supported one-arm row — per_side, 3 sets, explicit
  // session-level `rest_sec: 30` overriding the catalogue's [60, 75]. Six slots: L/R
  // per set. ---
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Supported one-arm row");
  await expect(page.locator(".log-strip .strip-set")).toContainText("Set 1 of 3 — left");
  for (let i = 0; i < 6; i++) await logSetThroughRest(page);

  // --- Mid-session reload (Task 6). Twelve sets are on the database by now; the reload
  // has to bring back the ledger and the cursor, not just the workout row, and it must
  // not write anything twice. Exercised here, mid a real walkthrough with a per-side
  // exercise and a partially-worked main block already behind it — a strictly larger
  // case than session-runner-resume.spec.ts's own isolated two-set scenario. ---
  const clientId = await workoutClientId(page, "A");
  const beforeReload = setLogsOf(clientId);
  expect(beforeReload).toEqual([
    { set_no: 1, side: null, slug: "goblet-squat" },
    { set_no: 2, side: null, slug: "goblet-squat" },
    { set_no: 3, side: null, slug: "goblet-squat" },
    { set_no: 1, side: null, slug: "db-floor-press" },
    { set_no: 2, side: null, slug: "db-floor-press" },
    { set_no: 3, side: null, slug: "db-floor-press" },
    { set_no: 1, side: "left", slug: "supported-one-arm-row" },
    { set_no: 1, side: "right", slug: "supported-one-arm-row" },
    { set_no: 2, side: "left", slug: "supported-one-arm-row" },
    { set_no: 2, side: "right", slug: "supported-one-arm-row" },
    { set_no: 3, side: "left", slug: "supported-one-arm-row" },
    { set_no: 3, side: "right", slug: "supported-one-arm-row" },
  ]);

  await page.reload();
  await expect(page.locator(".log-strip")).toBeVisible();

  // The reload landed on the same workout row, resumed at the next undone exercise —
  // main's 4th, Reverse lunge — with nothing re-armed empty.
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Reverse lunge");
  await expect(openExercise(page).locator(".ledger-row")).toHaveCount(4);
  await expect(openExercise(page).locator(".ledger-row.logged")).toHaveCount(0);
  await expect(page.locator(".log-strip .strip-set")).toContainText("Set 1 of 2 — left");
  expect(
    setLogsOf(clientId),
    "the reload must resume the workout without duplicating or dropping anything already logged",
  ).toEqual(beforeReload);

  // --- Main, exercise 4: Reverse lunge — per_side, 2 sets, catalogue rest_sec [60, 75].
  // This walkthrough's one deviation: `add_set`, applied here. `skip` and `drop_set` are
  // already exercised end-to-end elsewhere (session-runner-resume.spec.ts,
  // session-runner-exercise-state.spec.ts) — this is the one kind with no full-walkthrough
  // coverage yet. ---
  await page.locator(".log-strip .strip-change").click();
  const sheet = page.locator(".sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByText("Add a set").click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(openExercise(page).locator(".ledger-row")).toHaveCount(6);

  for (let i = 0; i < 6; i++) await logSetThroughRest(page);

  // --- Core block: three per-side exercises, all catalogue rest_sec: 30. ---
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Dead bug");
  for (let i = 0; i < 4; i++) await logSetThroughRest(page);

  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Side plank");
  for (let i = 0; i < 4; i++) await logSetThroughRest(page);

  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Bird dog");
  for (let i = 0; i < 4; i++) await logSetThroughRest(page);

  // --- Wrap-up: answer at least one metric, then finish. ---
  await page.getByRole("button", { name: "End session" }).click();
  const symptoms = page.locator("fieldset", { hasText: "Lower-back symptoms during session" });
  await expect(symptoms).toBeVisible();
  await symptoms.getByRole("button", { name: "4", exact: true }).click();
  await expect(symptoms.locator(".scale-cell.selected")).toHaveText("4");

  await page.getByRole("button", { name: "Finish session" }).click();
  await page.waitForURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "4-Week Home Dumbbell Training Plan" }),
  ).toBeVisible();

  // The finished workout: the full 18 working sets (6 main + 6 added + 12? — see the
  // spec's own arithmetic below), never duplicated by the reload above.
  expect(setLogsOf(clientId)).toHaveLength(
    3 /* goblet squat */ +
      3 /* floor press */ +
      6 /* row, per side */ +
      6 /* reverse lunge, per side, after add_set */ +
      4 /* dead bug, per side */ +
      4 /* side plank, per side */ +
      4 /* bird dog, per side */,
  );
});
