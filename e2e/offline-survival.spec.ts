/**
 * ARCHITECTURE §9: a workout survives a full browser kill — where `sessionStorage` (and
 * with it, phase 4's whole resume mechanism) is gone too. IndexedDB is what delivers
 * that; this spec is the proof, on a `launchPersistentContext` backed by a real
 * user-data directory rather than the `offline` project's default (ephemeral) context,
 * since only a persistent context's storage survives the context actually closing.
 *
 * Runs against the `offline` project's built server (`E2E_BUILT_BASE_URL`) directly,
 * bypassing the `page`/`context` fixtures entirely — this needs its own context
 * lifecycle, closed and reopened mid-test, which those fixtures don't offer.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { E2E_BUILT_BASE_URL, E2E_PLAN_SLUG } from "./env";
import { dismissPreSessionPrompt, logSetThroughRest, setLogsOf, workoutClientId } from "./helpers";

test("a browser kill mid-session survives via IndexedDB, not just a reload", async () => {
  test.setTimeout(60_000);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-e2e-persistent-"));

  try {
    let context = await chromium.launchPersistentContext(userDataDir, {
      baseURL: E2E_BUILT_BASE_URL,
      viewport: { width: 360, height: 800 },
    });

    let clientId: string;
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`/plan/${E2E_PLAN_SLUG}/session/D`);
      await dismissPreSessionPrompt(page);
      await expect(page.locator(".log-strip")).toBeVisible();

      // Log one set of the first exercise (Goblet squat, 3 sets prescribed — one set
      // does not finish it, so it stays the open exercise; the skip below must target a
      // *different* exercise explicitly, or it lands on this same one).
      await logSetThroughRest(page);

      // Skip a different exercise — a second kind of state (`skippedExercises`) that
      // must also survive, not just the ledger.
      await page.locator(".exercise-head", { hasText: "Dumbbell floor press" }).click();
      await page.locator(".log-strip .strip-change").click();
      const sheet = page.locator(".sheet");
      await expect(sheet).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
      await expect(sheet).toHaveCount(0);

      clientId = await workoutClientId(page, "D");
      expect(setLogsOf(clientId).length, "one set must be recorded before the kill").toBe(1);
    } finally {
      // The kill: close the context entirely, exactly what phase 4's `sessionStorage`
      // could not survive.
      await context.close();
    }

    // Reopen against the same user-data directory — a fresh browser process, the same
    // on-disk IndexedDB.
    context = await chromium.launchPersistentContext(userDataDir, {
      baseURL: E2E_BUILT_BASE_URL,
      viewport: { width: 360, height: 800 },
    });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`/plan/${E2E_PLAN_SLUG}/session/D`);
      await expect(page.locator(".log-strip")).toBeVisible();

      // The set survived: one logged row, on the exercise it actually belongs to — not
      // re-armed empty, and not swallowed by the *other* exercise's skip.
      await expect(
        page.locator(".exercise", { hasText: "Goblet squat" }).locator(".ledger-row.logged"),
      ).toHaveCount(1);

      // The skip survived on its own exercise, distinct from the one with the set — the
      // runner did not reopen it, and its own collapsed row says so (`ExerciseCard`'s
      // headline reads "Skipped" only when `isSkipped` is true).
      await expect(page.locator(".exercise", { hasText: "Dumbbell floor press" })).toContainText(
        "Skipped",
      );

      // The cursor survived: still on the same workout row, not a second one.
      expect(
        await workoutClientId(page, "D"),
        "the reopened context must resume the same workout, not start a second",
      ).toBe(clientId);
    } finally {
      await context.close();
    }
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("visibilitychange flushes a queued write — the phone-lock proxy", async ({
  page,
  context,
}) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/D`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  await context.setOffline(true);

  const strip = page.locator(".log-strip .strip-set");
  const before = await strip.innerText();
  await page.locator('.log-strip button[data-difficulty="medium"]').click();
  await expect(strip).not.toHaveText(before);
  await expect(page.locator(".sync-banner")).toBeVisible();

  // Reconnect without a browser `online` event — `context.setOffline(false)` doesn't
  // synthesize one in Chromium — so the only thing that can flush the queue from here is
  // the `visibilitychange` listener `startSyncLoop` registers (`client.svelte.ts`).
  await context.setOffline(false);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  await expect(page.locator(".sync-banner")).toHaveCount(0, { timeout: 15_000 });

  const clientId = await workoutClientId(page, "D");
  expect(setLogsOf(clientId)).toHaveLength(1);
});
