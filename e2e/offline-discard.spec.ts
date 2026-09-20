// e2e/offline-discard.spec.ts
/**
 * ARCHITECTURE §4's quarantine invariant, exercised against discard specifically: a
 * discard queued offline must purge everything else already queued for that workout
 * (`$lib/sync/client.svelte.ts`'s `discardWorkout`, "the purge runs first"), and it must
 * replay cleanly even when the server has never heard of the workout at all — the case
 * that would quarantine forever if replay threw `NotYetError` instead of treating an
 * unknown workout as already discarded (`$lib/sync/replay.ts`).
 *
 * Runs against the `offline` project's own server — a real `node build`, because
 * `$service-worker`'s precache manifest is empty under `vite dev` (see
 * `offline-session.spec.ts`'s header for the full reasoning, including why Home is
 * visited online twice before going offline).
 *
 * **Every navigation while offline in this file is client-side** (a link click inside
 * the already-running app), never `page.goto`/`page.reload`. A hard, top-level
 * navigation under `context.setOffline(true)` is genuinely flaky in this harness —
 * observed directly, both as `net::ERR_ABORTED` on `page.reload()` and, intermittently,
 * on `page.goto()` to the very same URL — because Chromium's offline network emulation
 * can abort a main-frame navigation before the service worker's `fetch` handler ever
 * gets to answer it from cache, where a page's own `fetch()` for a sub-resource (a
 * client-side navigation's `__data.json`) is not affected the same way. No other offline
 * spec in this repo hard-navigates while offline either — this file follows that
 * established pattern rather than fighting it. The consequence: Home's own
 * `__data.json` has to be cached by an *online* client-side round trip before either
 * test's offline visit to it, exactly like `precacheSessions` already guarantees for a
 * session route — a hard `page.goto("/")`/`page.reload()` caches the rendered document,
 * not the separate data payload a same-route client-side navigation later asks for.
 *
 * The first test reaches Home for the first time *before* going offline (logging two
 * sets, then a client-side nav back via the wordmark link), so that one visit both
 * shows the workout as open with an accurate count and caches Home's data for later.
 * Discarding then happens on that same, already-mounted page — no navigation at all —
 * which is what keeps the in-page reactive removal (`confirmDiscard`'s optimistic
 * filter) the thing under test rather than a second round trip. `confirmDiscard` itself
 * calls `invalidateAll()` after queuing the discard, which refetches Home's data via the
 * exact same offline-served-from-cache path a manual reload would use — since the
 * discard op is already in the outbox by the time that call fires (`await
 * discardWorkout(...)` precedes it), the assertion right after confirming already proves
 * `pendingDiscardIds` filters the row the (stale, cached) server data still reports as
 * open, with no separate reload step needed.
 *
 * The second test never has an online, post-sync Home visit at all: its workout never
 * once reaches the server, so it needs one throwaway online round trip into session A
 * and back out via the wordmark (nothing is written by opening and immediately leaving
 * — lazy start) purely to warm Home's data cache before going offline; the real,
 * countable session happens after. Home's client-side merge (`mergeUnfinished`) then
 * reads its *only* copy of that workout from the local `client_id` pointer, and
 * `session.setCount` is `undefined` for exactly that reason
 * (`UnfinishedSessionCard.svelte`'s `setLabel`) — "not yet synced", never a set count.
 *
 * Both tests assert on Home's aggregate "every open workout" state, so this file gets its
 * own dedicated account (`E2E_OFFLINE_DISCARD_USER`) rather than sharing `E2E_DEV_USER` —
 * `offline-survival.spec.ts` and `offline-auth.spec.ts` both deliberately leave a workout
 * open on that shared account, which would otherwise contaminate the assertions here —
 * and both tests drive session A against that one account, so they run
 * `test.describe.configure({ mode: "serial" })` rather than risk the two racing each
 * other the way `fullyParallel: true` (playwright.config.ts) otherwise would.
 */

import { expect, test } from "@playwright/test";
import { E2E_OFFLINE_DISCARD_USER, E2E_PLAN_SLUG, seededDataDir } from "./env";
import { clearOpenWorkouts } from "./seed";
import {
  dismissPreSessionPrompt,
  logSetThroughRest,
  outboxRecords,
  waitForPrecached,
  workoutClientId,
  workoutCountFor,
} from "./helpers";

const SESSION_NAME = "Squat, Press & Row";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  // Both tests end by discarding what they opened, so this is normally a no-op — but an
  // attempt that fails partway through leaves an open workout behind, and CI's retry
  // would then re-run the file against an account these whole-account assertions cannot
  // describe. Same reasoning as `unfinished-session.spec.ts`.
  clearOpenWorkouts(seededDataDir(), E2E_OFFLINE_DISCARD_USER);
  await page.setExtraHTTPHeaders({ "x-gain-e2e-user": E2E_OFFLINE_DISCARD_USER });
});

test("discarding offline purges locally and replays on reconnect", async ({ page, context }) => {
  test.setTimeout(60_000);

  // -- Online: two visits, exactly like `offline-session.spec.ts` — the first registers
  // and activates the service worker, the second is what the now-active worker actually
  // caches opportunistically.
  await page.goto("/");
  await page.locator(".list-toggle").click();
  await expect(page.locator(".session-toggle", { hasText: SESSION_NAME })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);

  await page.reload();
  await page.locator(".list-toggle").click();
  await expect(page.locator(".session-toggle", { hasText: SESSION_NAME })).toBeVisible();
  await waitForPrecached(page, `/plan/${E2E_PLAN_SLUG}/session/A/__data.json`);

  // -- Start session A online, log two sets, and wait for the outbox to hold nothing more
  // for this workout — proof the server has it before this test relies on that.
  await page.locator(".session-toggle", { hasText: SESSION_NAME }).click();
  await page.locator(".session-link").click();
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();
  await logSetThroughRest(page);
  await logSetThroughRest(page);

  const clientId = await workoutClientId(page, "A");
  await expect
    .poll(
      async () =>
        (await outboxRecords(page)).filter((r) => r.op.workoutClientId === clientId).length,
      { timeout: 20_000 },
    )
    .toBe(0);
  expect(workoutCountFor(clientId, E2E_OFFLINE_DISCARD_USER)).toBe(1);

  // -- Back to Home, still online, via the wordmark link (client-side — see the module
  // comment for why nothing here is a hard `page.goto`/`page.reload`). This is also what
  // caches Home's own data for the offline reactive-refresh below: a hard navigation to
  // "/" caches the rendered document, not the separate payload a same-route
  // client-side navigation asks for.
  await page.locator("a.wordmark").click();
  await expect(page.getByText("2 sets logged")).toBeVisible();

  // -- Go offline, then discard from this same, already-mounted page — no navigation.
  await context.setOffline(true);

  await page.getByRole("button", { name: "Discard" }).click();
  await page.getByRole("button", { name: "Discard session" }).click();

  // `confirmDiscard` awaits `discardWorkout` (which appends the op to the outbox) before
  // calling `invalidateAll()`, so the card disappearing here is already proof that a
  // fresh (offline, cache-served) refetch of Home's data — still reporting the workout
  // as open — got filtered by `pendingDiscardIds`, not just that the earlier optimistic
  // removal stuck.
  await expect(page.getByText("2 sets logged")).toHaveCount(0);

  // -- The outbox holds exactly one op for this workout, and it is the discard — the
  // purge removed the `start` and both `set` ops that were already queued for it.
  // Polled rather than read once: `.click()` resolves once the DOM event dispatches, not
  // once `confirmDiscard`'s own `await discardWorkout(...)` (an IndexedDB write) has
  // actually landed.
  await expect
    .poll(async () =>
      (await outboxRecords(page))
        .filter((r) => r.op.workoutClientId === clientId)
        .map((r) => r.op.kind),
    )
    .toEqual(["discard"]);

  // -- Reconnect, and let the flush drain the queue. `context.setOffline(false)` does not
  // synthesize a browser `online` event in Chromium (`offline-survival.spec.ts`'s own
  // note), so the flush attempted while still offline is otherwise only retried on
  // whatever backoff it scheduled for itself, which this test has no reason to wait out.
  // Dispatching `visibilitychange` is the same nudge `offline-survival.spec.ts` uses for
  // the identical gap.
  await context.setOffline(false);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".sync-banner")).toHaveCount(0, { timeout: 20_000 });

  expect(workoutCountFor(clientId, E2E_OFFLINE_DISCARD_USER)).toBe(0);

  // -- Nothing quarantined: `bannerText` (`$lib/sync/banner.ts`) always says so when
  // `quarantined > 0`, so the banner's absence just above already proves there is
  // none — and the outbox holds nothing more for this workout either.
  expect((await outboxRecords(page)).filter((r) => r.op.workoutClientId === clientId)).toEqual([]);
});

test("discarding a session that never synced leaves nothing behind", async ({ page, context }) => {
  test.setTimeout(60_000);

  // -- Online, twice, to register and then populate the precache — same reasoning as the
  // test above and `offline-session.spec.ts`'s header.
  await page.goto("/");
  await page.locator(".list-toggle").click();
  await expect(page.locator(".session-toggle", { hasText: SESSION_NAME })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);

  await page.reload();
  await page.locator(".list-toggle").click();
  await expect(page.locator(".session-toggle", { hasText: SESSION_NAME })).toBeVisible();
  await waitForPrecached(page, `/plan/${E2E_PLAN_SLUG}/session/A/__data.json`);

  // -- One throwaway online round trip into the session and straight back out via the
  // wordmark — nothing is written by opening and immediately leaving (lazy start), but
  // it is what caches Home's own data for the client-side nav back to it while offline
  // below (see the module comment: a hard navigation to "/" would cache the document,
  // not this payload).
  await page.locator(".session-toggle", { hasText: SESSION_NAME }).click();
  await page.locator(".session-link").click();
  await page.locator("a.wordmark").click();
  await expect(page.getByRole("link", { name: /^Start / })).toBeVisible();

  // -- Go offline BEFORE the real, countable session ever starts. Everything from here —
  // start, the set, the discard — is minted and queued with no server ever having heard
  // of the workout at all.
  await context.setOffline(true);

  // The list accordion collapses on every fresh mount of Home (a client-side nav here
  // counts as one) — reopen it before `.session-toggle` is reachable again.
  await page.locator(".list-toggle").click();
  await expect(page.locator(".session-toggle", { hasText: SESSION_NAME })).toBeVisible();
  await page.locator(".session-toggle", { hasText: SESSION_NAME }).click();
  await page.locator(".session-link").click();
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();
  await logSetThroughRest(page);

  const clientId = await workoutClientId(page, "A");
  expect(
    (await outboxRecords(page)).some((r) => r.op.workoutClientId === clientId),
    "the set must have queued locally before the discard",
  ).toBe(true);

  // Back to Home, still offline, client-side — served from the cache the throwaway
  // round trip above warmed. Home's only knowledge of this workout is the local
  // `client_id` pointer — the server has never heard of it, so the card names no set
  // count at all (`setCount` is `undefined`, not `0`).
  await page.locator("a.wordmark").click();
  await expect(page.getByText("not yet synced")).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await page.getByRole("button", { name: "Discard session" }).click();
  await expect(page.getByText("not yet synced")).toHaveCount(0);

  // -- Only the discard is left queued — the purge removed the `start` and the `set`
  // before either ever reached a server that has no row to discard in the first place.
  // Polled for the same reason as the first test: the card disappearing is synchronous
  // UI state, not proof the outbox append has landed yet.
  await expect
    .poll(async () =>
      (await outboxRecords(page))
        .filter((r) => r.op.workoutClientId === clientId)
        .map((r) => r.op.kind),
    )
    .toEqual(["discard"]);

  // -- Reconnect: the server answers a discard for a workout it never heard of the same
  // way it answers one it has (`$lib/sync/replay.ts` treats "unknown" as "already
  // discarded") — this is the case that would quarantine forever under the wrong replay
  // semantics.
  await context.setOffline(false);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".sync-banner")).toHaveCount(0, { timeout: 20_000 });

  expect(workoutCountFor(clientId, E2E_OFFLINE_DISCARD_USER)).toBe(0);
  // Nothing quarantined: the banner's absence just above already proves it (`bannerText`
  // always says so when `quarantined > 0`), and the outbox holds nothing more either.
  expect((await outboxRecords(page)).filter((r) => r.op.workoutClientId === clientId)).toEqual([]);
});
