// e2e/unfinished-session.spec.ts
/**
 * Home surfaces an abandoned workout, lets it be resumed within the twelve-hour window
 * or discarded outright, and refuses to resume it past that window (`$lib/session/
 * workout-age.ts`, `$lib/db/home.ts`, `UnfinishedSessionCard.svelte`,
 * `DiscardSessionSheet.svelte`).
 *
 * This is whole-account state — Home lists *every* open workout on the plan
 * (`openWorkoutsForPlan`), and only one is ever promoted to the primary slot
 * (`partitionUnfinished`) — so it runs as its own dedicated bypass user per viewport
 * project (`unfinishedSessionDevUserFor`), the same reasoning as `home-walkthrough.spec.ts`.
 * The three tests also run serial: the second and third seed a workout row directly into
 * the database rather than through the browser, and running them concurrently with the
 * first (which starts a real session and leaves it open mid-test) would put more than one
 * open workout on the account at once — exactly the ambiguity `partitionUnfinished`
 * exists to resolve for the *user*, not for a test's locator.
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth setup beyond
 * the `x-gain-e2e-user` header that selects this file's own account.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG, seededDataDir, unfinishedSessionDevUserFor } from "./env";
import {
  dismissPreSessionPrompt,
  logSetThroughRest,
  openExercise,
  assertNoHorizontalOverflow,
  setLogsOf,
  workoutClientId,
  workoutCountFor,
} from "./helpers";
import { clearOpenWorkouts, seedStaleWorkout } from "./seed";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }, testInfo) => {
  // Each test's assertions are about *every* open workout on the account, so each one
  // needs an account with none — including the third test, which deliberately leaves two
  // behind, and including a CI retry, which re-runs this file from the top with the
  // previous attempt's rows still there. See `clearOpenWorkouts`.
  clearOpenWorkouts(seededDataDir(), unfinishedSessionDevUserFor(testInfo.project.name));
  await page.setExtraHTTPHeaders({
    "x-gain-e2e-user": unfinishedSessionDevUserFor(testInfo.project.name),
  });
});

test("an abandoned session is surfaced, resumable, and discardable", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const devUser = unfinishedSessionDevUserFor(testInfo.project.name);

  // -- Start session A, log two sets, leave without finishing (no "End session", no
  // navigation to a celebration) — this is what leaves `completed_at` null.
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();
  await logSetThroughRest(page);
  await logSetThroughRest(page);
  const clientId = await workoutClientId(page, "A");

  // -- Home surfaces it. The count is what proves data reached the card — every shell in
  // this app renders unconditionally (CLAUDE.md), so asserting on the container alone
  // would pass even with nothing logged.
  await page.goto("/");
  await expect(page.getByText("2 sets logged")).toBeVisible();
  // Hydration must be settled before the click below: the server-rendered HTML alone
  // already satisfies every assertion up to here, so nothing above this line proves the
  // client JS has attached its handlers yet (same race `home-walkthrough.spec.ts` notes
  // for its own expander click).
  await page.waitForLoadState("networkidle");

  // -- The rotation did not advance: the promoted card's Resume link still names A, and
  // the ordinary NextSessionCard ("Start <key>") is gone — replaced, not stacked above it.
  await expect(page.getByRole("link", { name: /Resume A/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Start / })).toHaveCount(0);

  // -- The "choose a different session" picker survived the replacement.
  await expect(page.getByRole("button", { name: /different session/i })).toBeVisible();

  // -- Resume: the ledger comes back with both sets, and no second workout row was minted
  // for the same client id.
  await page.getByRole("link", { name: /Resume A/ }).click();
  await expect(page.locator(".log-strip")).toBeVisible();
  await expect(openExercise(page).locator(".ledger-row.logged")).toHaveCount(2);
  expect(workoutCountFor(clientId, devUser), "resuming must not start a second workout row").toBe(
    1,
  );

  // -- Back to Home, discard it.
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Discard" }).click();
  await page.getByRole("button", { name: "Discard session" }).click();

  // -- The card and the rows are both gone. `discardWorkout` (`$lib/sync/client.svelte.ts`)
  // queues the op and returns without waiting for the round trip (`void flushNow(...)`),
  // so the UI updating is not proof the server has applied it yet — poll rather than
  // read the database once.
  await expect(page.getByText("2 sets logged")).toHaveCount(0);
  await expect.poll(() => setLogsOf(clientId, devUser).length).toBe(0);
  expect(workoutCountFor(clientId, devUser)).toBe(0);

  await assertNoHorizontalOverflow(page);
});

test("a session older than the resume window offers only discard", async ({ page }, testInfo) => {
  const devUser = unfinishedSessionDevUserFor(testInfo.project.name);
  const startedAtMs = Date.now() - 30 * 60 * 60 * 1000;
  const clientId = seedStaleWorkout(seededDataDir(), devUser, E2E_PLAN_SLUG, "A", startedAtMs);

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Not promoted (`resumable: false`), so it renders as the slim, aged-out-style card —
  // `.slim` is exactly the class this card gets when `promoted` is false.
  const card = page.locator(".card.unfinished.slim");
  await expect(card.locator(".status-label")).toHaveText("left unfinished");
  await expect(card.getByRole("button", { name: "Discard" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Resume/ })).toHaveCount(0);

  // The ordinary next-session suggestion is still offered below it — resumability, not
  // "any open workout exists at all", is what replaces `NextSessionCard`.
  await expect(page.getByRole("link", { name: /^Start / })).toBeVisible();

  // "Offers only discard" is a claim about what the button *does*, not only what is
  // visible — prove it actually removes the row.
  await card.getByRole("button", { name: "Discard" }).click();
  await page.getByRole("button", { name: "Discard session" }).click();
  await expect(page.locator(".card.unfinished")).toHaveCount(0);
  // Same async gap as the first test's discard: the queued op is not applied yet just
  // because the UI updated.
  await expect.poll(() => workoutCountFor(clientId, devUser)).toBe(0);
});

test("starting a session past the window mints a new workout", async ({ page }, testInfo) => {
  const devUser = unfinishedSessionDevUserFor(testInfo.project.name);
  const startedAtMs = Date.now() - 30 * 60 * 60 * 1000;
  const staleClientId = seedStaleWorkout(seededDataDir(), devUser, E2E_PLAN_SLUG, "A", startedAtMs);

  // The stale local resume pointer a real device would still be holding onto — set via
  // `addInitScript` so it is in place before the runner's own effect reads `localStorage`
  // on first render, rather than racing it with a `page.evaluate` after `goto` resolves
  // (same reasoning as `session-runner-theme.spec.ts`'s theme override).
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => localStorage.setItem(key, value),
    { key: `gain:workout:${E2E_PLAN_SLUG}:A`, value: staleClientId },
  );

  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();
  await logSetThroughRest(page);

  const freshClientId = await workoutClientId(page, "A");
  expect(freshClientId, "a fresh id must be minted, not the stale pointer reused").not.toBe(
    staleClientId,
  );

  // Two workout rows exist for session A: the stale one, untouched, and the new one. The
  // fresh row's own `set` op is queued and flushed fire-and-forget (`logWrite`), so its
  // arrival is polled rather than assumed the instant the strip updates.
  await expect.poll(() => workoutCountFor(freshClientId, devUser)).toBe(1);
  expect(workoutCountFor(staleClientId, devUser)).toBe(1);
});
