/**
 * ARCHITECTURE §4 and §9: a session can be chosen, started, logged and
 * finished with no connection at all, and the data crosses both the offline boundary and
 * the sync boundary intact once reconnected.
 *
 * This runs against the `offline` project's own server — a real `node build`, because
 * `$service-worker`'s `build` manifest is empty under `vite dev` and the precache this
 * spec depends on would be a no-op there (`playwright.config.ts`).
 *
 * The session route is reached by a client-side navigation from an already-loaded home
 * page, not a fresh `page.goto` to the session URL directly. The service worker only
 * explicitly precaches `__data.json` — the route's *data* — not the session page's own
 * HTML, which is nowhere in `$service-worker`'s `build`/`files` arrays and is only ever
 * cached opportunistically on a real online visit. A hard navigation offline to a page
 * that was never visited would 404 out to the `/offline` fallback; a client-side
 * navigation from a page whose JS is already running only needs the route's data, which
 * is exactly what `precacheSessions` puts in the cache.
 *
 * The home page is visited twice online, for the same reason: a service worker never
 * controls the request that first loads and registers it (`clients.claim()` only takes
 * control of the tab going forward, it does not retroactively cache that first request),
 * so the very first `/` of this test's run is never cached by `networkFirst`'s
 * opportunistic `cache.put`. A second, ordinary visit — which is what any returning user
 * genuinely has, since their service worker was installed on a previous visit — is what
 * lets `networkFirst` cache the page network-first visits actually populate.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import {
  dismissPreSessionPrompt,
  finishSession,
  logSetThroughRest,
  waitForPrecached,
} from "./helpers";

const SESSION_NAME = "Squat, Press & Row";

test("a full session can be started, logged and finished entirely offline", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);

  // -- Online: the first visit registers and activates the service worker. The session
  // list is a collapsed accordion (`SessionOverrideList.svelte`'s `listOpen`, default
  // closed): open it before any `.session-toggle` is reachable.
  await page.goto("/");
  await page.locator(".list-toggle").click();
  await expect(page.locator(".session-toggle", { hasText: SESSION_NAME })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);

  // -- ...the second is what the now-active worker actually caches, opportunistically —
  // matching a real returning user, whose worker isn't installing for the first time.
  // The reload remounts the component, so the accordion is collapsed again.
  await page.reload();
  await page.locator(".list-toggle").click();
  await expect(page.locator(".session-toggle", { hasText: SESSION_NAME })).toBeVisible();
  await waitForPrecached(page, `/plan/${E2E_PLAN_SLUG}/session/A/__data.json`);

  // -- Go offline.
  await context.setOffline(true);

  // -- Reach the session via a client-side navigation from the already-loaded shell —
  // see the module comment for why this can't be a fresh `page.goto` to the session URL.
  // The session summary is an accordion (`+page.svelte`'s `toggleSession`): expand it to
  // reveal the "Start session" link, which is what actually navigates. The list itself is
  // still open from the reload above, since this is the same page, not a new navigation.
  await page.locator(".session-toggle", { hasText: SESSION_NAME }).click();
  await page.locator(".session-link").click();
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  // Every write below is local — nothing here should ever surface the error banner.
  await expect(page.locator(".action-error")).toHaveCount(0);

  // -- Log two sets of the first exercise.
  await logSetThroughRest(page);
  await logSetThroughRest(page);

  // -- A deviation, offline: skip the currently open exercise.
  await page.locator(".log-strip .strip-change").click();
  const sheet = page.locator(".sheet");
  await expect(sheet).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(sheet).toHaveCount(0);

  await expect(page.locator(".action-error")).toHaveCount(0);

  // -- Wrap-up, offline.
  await page.getByRole("button", { name: "End session" }).click();
  await finishSession(page);

  // Home renders offline too, now that the second online visit above cached it. The plan
  // name now renders twice on Home (`NextSessionCard`'s featured card and the
  // `.plan-admin` section below it, since `90c81d0` merged the two Home cards), so a
  // plain role query is ambiguous — `.plan-name` is unique to the featured card.
  await expect(page.locator(".plan-name", { hasText: "Home Training Plan" })).toBeVisible();

  // -- Reconnect, and let the outbox drain.
  await context.setOffline(false);
  await expect(page.locator(".sync-banner")).toHaveCount(0, { timeout: 20_000 });

  // -- The proof that matters: the sets crossed both the offline boundary and the sync
  // boundary intact, visible through the export bundle exactly as a reviewing AI would
  // read it.
  await page.goto(`/plan/${E2E_PLAN_SLUG}/export`);
  await page.getByRole("button", { name: "Generate the export" }).click();
  await expect(page.getByRole("heading", { name: "Paste this into your AI chat" })).toBeVisible();

  const bundle = await page.locator("textarea.doc").inputValue();
  expect(bundle).toContain("### Per-exercise progression");
  expect(bundle).not.toContain("No sets logged in this window.");
});
