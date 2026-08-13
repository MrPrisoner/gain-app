/**
 * ARCHITECTURE §4: a 401 mid-session must never cost the user a set. The gate answers a
 * non-navigation request with 401 rather than a 303 precisely so `/api/sync` can hit
 * this path without a redirect turning the queued POST into a body-discarding GET — this
 * spec is the proof that the client side honours that contract: the banner appears, the
 * write stays in the outbox, and the queue drains once the session is good again.
 *
 * `GAIN_DEV_USER` bypass mode (every other spec's auth story, see
 * `session-runner.spec.ts`) always answers `locals.user`, with no cookie to expire — so a
 * *real* expired session cannot be produced against this harness at all. This spec
 * intercepts `/api/sync` directly and forces the 401 itself, which tests exactly the
 * client behaviour this spec is about (a 401 response, regardless of why the server sent
 * one) without needing a real auth failure to produce it.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import { dismissPreSessionPrompt, logSetThroughRest, setLogsOf, workoutClientId } from "./helpers";

test("a 401 mid-session holds the queue and shows the banner, never discarding a set", async ({
  page,
}) => {
  test.setTimeout(30_000);

  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  // Set 1 syncs normally, before the interception below exists. Goblet squat declares
  // `rest_sec`, so this fires and dismisses a rest overlay — `logSetThroughRest`, not a
  // raw click, or the overlay sits on top of the strip and blocks set 2 below.
  await logSetThroughRest(page);

  const clientId = await workoutClientId(page, "A");
  await expect
    .poll(() => setLogsOf(clientId).length, "set 1 must sync before the 401 is introduced")
    .toBe(1);

  // From here on, every /api/sync call looks like an expired session.
  await page.route("**/api/sync", async (route) => {
    await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
  });

  await logSetThroughRest(page);

  // The banner appears — and the set it is telling the user about is still right there.
  await expect(page.locator(".sync-banner")).toContainText("Signed out");
  await expect(page.locator(".sync-banner")).toContainText("Reconnect to sync");
  await expect(page.locator(".exercise.open .ledger-row.logged")).toHaveCount(2);

  // Losing a workout to a token expiry is unacceptable (§4) — the set that hit the 401
  // must still be in the outbox, not silently applied or silently dropped, until sync
  // actually succeeds.
  expect(
    setLogsOf(clientId).length,
    "set 2 must not have reached the database while every sync attempt 401s",
  ).toBe(1);

  // Restore the session: stop intercepting, and let the fix in client.svelte.ts's
  // needs-auth handling prove itself — nothing here reloads the page or calls anything
  // new, the queue has to recover entirely on its own scheduled retry.
  await page.unroute("**/api/sync");

  await expect(page.locator(".sync-banner")).toHaveCount(0, { timeout: 20_000 });
  expect(setLogsOf(clientId)).toHaveLength(2);
});
