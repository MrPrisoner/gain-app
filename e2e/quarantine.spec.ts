// e2e/quarantine.spec.ts
/**
 * The quarantine path, against the code that actually runs on a phone.
 *
 * `tests/sync/queue.test.ts` covers the rules, but it drives `tests/sync/memory-outbox.ts`
 * — a hand-written double. `src/lib/sync/idb.ts` is what a real session writes through,
 * and until this spec existed **no test had ever produced a quarantine at all**: both
 * failure modes CLAUDE.md's invariant names — a record deleted rather than held, or
 * `pending()` no longer filtering on state and so retrying a doomed op forever behind the
 * live ones — were reachable with a fully green suite (review 2026-08-27).
 *
 * The scenario is the real one rather than an injected record: a set is logged while the
 * device is offline, a revision renames that exercise's slug while the op is still
 * queued, and the reconnect finds an op naming a slug the plan no longer has. That op can
 * never succeed, so it must be kept, marked, and said out loud — the invariant's words
 * are that an invisible quarantined op "is exactly the data loss this whole phase exists
 * to prevent, just moved one step later."
 *
 * Runs against the dev server like the other viewport projects: `page.context()
 * .setOffline()` is enough to make `fetch("/api/sync")` fail, and nothing here navigates
 * while offline, so no service worker is needed. The specs that genuinely need one are
 * the `offline-*` files, on the built server.
 */

import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG, quarantineDevUserFor, seededDataDir } from "./env";
import {
  dismissPreSessionPrompt,
  logSet,
  openExercise,
  outboxRecords,
  setLogsOf,
  workoutClientId,
} from "./helpers";
import { importRevision, seedFixturePlan } from "./seed";

const V2_FIXTURE_PATH = path.join(process.cwd(), "fixtures/plans/home-training-v2.md");

test("an op naming a renamed-away slug is held, marked and surfaced — never dropped", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);

  // Counted so the "retried forever" half of the invariant can be asserted rather than
  // assumed — see the last block of this spec.
  let syncPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/sync")) syncPosts++;
  });

  const devUser = quarantineDevUserFor(testInfo.project.name);
  seedFixturePlan(seededDataDir(), devUser);
  await page.setExtraHTTPHeaders({ "x-gain-e2e-user": devUser });

  // --- Open session A online, so the workout itself reaches the server. Goblet squat is
  // the first tracked exercise of the main block and opens by default. ---
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();
  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Goblet squat");

  // --- Go offline and log a goblet-squat set. It lands in the ledger at the speed of
  // IndexedDB, which is the whole point, and sits in the outbox unsent. ---
  await page.context().setOffline(true);
  await logSet(page);
  await expect(openExercise(page).locator(".ledger-row.logged")).toHaveCount(1);
  await expect(page.locator(".sync-banner")).toContainText("Offline", { timeout: 10_000 });

  const queued = await outboxRecords(page);
  const queuedSet = queued.find((record) => record.op.kind === "set");
  expect(queuedSet, "the offline set must be in the outbox").toBeTruthy();
  expect(queuedSet!.op.exerciseSlug).toBe("goblet-squat");
  expect(queuedSet!.state).toBe("pending");

  // --- While that op is queued, the plan is revised: v2 renames `goblet-squat` to
  // `gobletsquat`, so `exercise_def` carries the new slug and the old one resolves to
  // nothing. The queued op now names an exercise this account does not have, which is a
  // failure no amount of retrying can fix. ---
  importRevision(seededDataDir(), devUser, V2_FIXTURE_PATH, [
    { from: "goblet-squat", to: "gobletsquat" },
    { from: "rear-delt-reverse-fly", to: "prone-reverse-fly" },
  ]);

  // --- Reconnect. The `online` event flushes on its own; nothing here reloads the page
  // or calls anything the app would not have called itself. ---
  await page.context().setOffline(false);

  // The banner is the assertion that matters most: a quarantined op the user is never
  // told about is the data loss this design exists to prevent, moved one step later.
  await expect(page.locator(".sync-banner")).toContainText("1 entry could not sync", {
    timeout: 20_000,
  });
  await expect(page.locator(".sync-banner").getByRole("button", { name: "Discard" })).toBeVisible();

  // Held, not dropped: the record is still there, marked with the server's reason.
  const afterFlush = await outboxRecords(page);
  const quarantined = afterFlush.filter((record) => record.state === "quarantined");
  expect(quarantined, "the failed op must survive in the outbox").toHaveLength(1);
  expect(quarantined[0]!.op.kind).toBe("set");
  expect(quarantined[0]!.op.exerciseSlug).toBe("goblet-squat");
  expect(quarantined[0]!.error).toContain("goblet-squat");

  // ...and never retried forever behind the ops that follow it: nothing is pending, and
  // the server never applied it under either slug.
  expect(
    afterFlush.filter((record) => record.state === "pending"),
    "a quarantined op must not stay in the pending queue",
  ).toHaveLength(0);

  // --- Never retried forever, either. `pending()` filters on state, so the next flush
  // this app would run on its own has nothing to send: a visibilitychange is the
  // strongest trigger there is (`startSyncLoop` treats it as "try now, cancel the
  // backoff"), and it must produce no request at all. Drop the state filter from
  // `idb.ts`'s `pending()` and this is the assertion that fails. ---
  const postsBeforeNudge = syncPosts;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(1_000);
  expect(syncPosts, "a quarantined op must not be sent again").toBe(postsBeforeNudge);

  // The set is genuinely absent from the database rather than half-applied: the server
  // rejected the op before any write, which is why keeping the record is the only place
  // this data still exists.
  const clientId = await workoutClientId(page, "A");
  expect(setLogsOf(clientId, devUser), "a rejected op must not have written a set").toHaveLength(0);
});
