/**
 * The offline half of lazy start: a session opened with no connection queues nothing, and
 * reconnecting therefore syncs nothing.
 *
 * Runs against the `offline` project's real `node build` server, because
 * `$service-worker`'s precache manifest is empty under `vite dev`. The navigation shape —
 * two online visits to Home, then a client-side navigation into the session rather than a
 * `page.goto` — is copied from `offline-session.spec.ts`; read its header for why each of
 * those is required rather than incidental. In particular: the session list
 * (`SessionOverrideList.svelte`'s `listOpen`) is a collapsed accordion by default, so
 * `.list-toggle` has to be opened before `.session-toggle` is reachable, and that has to
 * happen again after the reload since remounting the component collapses it again. The
 * actual navigating element is `.session-link`, revealed only once `.session-toggle` is
 * expanded — there is no plain named link to click.
 *
 * Unlike `offline-session.spec.ts`, this spec never calls `dismissPreSessionPrompt` —
 * peeking means staying on the "Before you start" screen, exactly like the online
 * `peek-session.spec.ts` (Task 3) does.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import { outboxRecords, waitForPrecached } from "./helpers";

const SESSION_NAME = "Squat, Press & Row";

test("a session opened offline and never logged queues nothing", async ({ page, context }) => {
  test.setTimeout(60_000);

  // -- Online, first visit: registers and activates the service worker. Open the
  // (default-collapsed) session list and confirm the toggle is visible before relying on
  // the worker being ready.
  await page.goto("/");
  await page.locator(".list-toggle").click();
  await expect(page.locator(".session-toggle", { hasText: SESSION_NAME })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);

  // -- Online, second visit (a reload — remounts the component, so the accordion collapses
  // again): open the list again, confirm the toggle again, then wait for the session
  // route's data to actually be precached.
  await page.reload();
  await page.locator(".list-toggle").click();
  await expect(page.locator(".session-toggle", { hasText: SESSION_NAME })).toBeVisible();
  await waitForPrecached(page, `/plan/${E2E_PLAN_SLUG}/session/A/__data.json`);

  // -- Go offline.
  await context.setOffline(true);

  // -- Reach the session via a client-side navigation: click the (already-open,
  // same-page) session-toggle to expand the accordion and reveal the "Start session"
  // link, then click that link. Never dismiss the pre-session prompt — peeking means
  // staying on "Before you start".
  await page.locator(".session-toggle", { hasText: SESSION_NAME }).click();
  await page.locator(".session-link").click();
  await expect(page.getByRole("heading", { name: "Before you start" })).toBeVisible();

  expect(await outboxRecords(page), "opening a session must queue nothing").toEqual([]);

  await context.setOffline(false);
  await page.goto("/");

  expect(await outboxRecords(page), "reconnecting must find nothing to send").toEqual([]);
});
