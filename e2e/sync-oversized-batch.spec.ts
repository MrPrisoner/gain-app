// e2e/sync-oversized-batch.spec.ts
/**
 * A whole-batch rejection that names no op must narrow rather than repeat.
 *
 * `/api/sync` answers a body over `MAX_SYNC_BODY_BYTES` with 413 before it has read the
 * body at all, so the response carries no `failed[]` entry and nothing reaches
 * `applyAck`. Routing that into `scheduleRetry` like any other failure meant the client
 * rebuilt the identical batch through `planBatch` and had it refused identically, for as
 * long as the tab stayed open — every op behind it held hostage, nothing quarantined,
 * nothing said. That is the one shape ARCHITECTURE §4 forbids outright, and the same
 * reasoning covers the 400 a batch failing `syncBatchSchema` whole gets back.
 *
 * `tests/sync/queue.test.ts` covers `resolvePermanentFailure`'s arithmetic. What only a
 * browser can show is that the loop it drives actually terminates against the real
 * outbox, the real `planBatch` and the real endpoint — so the server is stubbed to the
 * shape of its own cap ("more than one op is too large"), which is a size limit the two
 * queued sets can genuinely be got under, and the assertion is that they arrive.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import {
  dismissPreSessionPrompt,
  logSetThroughRest,
  outboxRecords,
  setLogsOf,
  workoutClientId,
} from "./helpers";

test("an oversized batch narrows until it fits, rather than being replayed forever", async ({
  page,
}) => {
  test.setTimeout(60_000);

  // Counted so "terminates" can be asserted rather than inferred from the sets landing.
  let syncPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/sync")) syncPosts++;
  });

  // The server's own cap, in miniature: a batch of more than one op is refused before the
  // body is read, exactly as `MAX_SYNC_BODY_BYTES` refuses one. A single op goes through
  // to the real endpoint, so everything past this route — `replayOps`, the transaction,
  // the ack — is the production path.
  await page.route("**/api/sync", async (route) => {
    const body = route.request().postDataJSON() as { ops?: unknown[] } | null;
    if ((body?.ops?.length ?? 0) > 1) {
      await route.fulfill({
        status: 413,
        contentType: "application/json",
        body: JSON.stringify({ error: "Batch is too large." }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  // Offline, so both sets queue together and leave as one batch on reconnect.
  await page.context().setOffline(true);
  await logSetThroughRest(page);
  await logSetThroughRest(page);
  await expect(page.locator(".sync-banner")).toContainText("Offline", { timeout: 10_000 });

  await page.context().setOffline(false);

  // The queue drains: the batch of two is refused, halved, and both halves apply. Before
  // `resolvePermanentFailure` this never fell, because the batch never changed shape.
  const clientId = await workoutClientId(page, "A");
  await expect.poll(() => setLogsOf(clientId).length, { timeout: 20_000 }).toBe(2);

  // Nothing was given up on: narrowing is not quarantining, and an op that can be sent in
  // a smaller batch must never be marked failed. Read from the store rather than the
  // banner — a healthy sync raises no banner at all (`$lib/sync/banner-gate.ts`), so
  // there is no element for a negative assertion to be made against.
  const records = await outboxRecords(page);
  expect(records.filter((record) => record.state === "quarantined")).toHaveLength(0);
  expect(records.filter((record) => record.state === "pending")).toHaveLength(0);

  // And it converged rather than merely making progress. Two ops need three requests —
  // the refused pair, then each on its own — so anything near the retry ceiling means the
  // narrowing is not sticking between attempts.
  expect(syncPosts, "narrowing must converge, not retry").toBeLessThanOrEqual(6);
});
