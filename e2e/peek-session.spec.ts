/**
 * Opening a session to look at it must leave nothing behind.
 *
 * The runner used to write a `start` op on mount, so a session someone opened and never
 * trained became a `workout` row with `status = 'partial'`. The History row was the least
 * of it: `suggestNextSession` counts any workout as an attempt and advances its rotation
 * cursor, and the export's Adherence table counts it as a Partial — a wrong claim about
 * the user reaching the reviewing AI, which is the harm this spec exists to hold shut.
 *
 * Its own per-project dev user, because the suggested-next-session assertion is
 * whole-account state — see `peekDevUserFor`. Not seeded in `global-setup.ts`: nothing
 * else needs this user provisioned ahead of time, so — like `revisionDevUserFor` and
 * `quarantineDevUserFor` — the seed happens here in the spec via `seedFixturePlan`
 * directly.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG, peekDevUserFor, seededDataDir } from "./env";
import { assertNoHorizontalOverflow } from "./helpers";
import { seedFixturePlan } from "./seed";

test("opening a session and logging nothing leaves no workout and does not advance the rotation", async ({
  page,
}, testInfo) => {
  const devUser = peekDevUserFor(testInfo.project.name);
  seedFixturePlan(seededDataDir(), devUser);
  await page.setExtraHTTPHeaders({ "x-gain-e2e-user": devUser });

  // -- What Home suggests before anything is opened.
  await page.goto("/");
  const suggestion = page.getByRole("link", { name: /^Start / });
  await expect(suggestion).toBeVisible();
  const before = await suggestion.textContent();

  // -- Open the suggested session, look at it, and leave without logging a thing.
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await expect(page.getByRole("heading", { name: "Before you start" })).toBeVisible();
  await assertNoHorizontalOverflow(page);

  // Nothing is persisted, so there is no resume key either — the whole point is that a
  // second visit is a fresh session, not a resumed one.
  const storedKey = await page.evaluate(
    (k) => localStorage.getItem(k),
    `gain:workout:${E2E_PLAN_SLUG}:A`,
  );
  expect(storedKey, "a session that was only looked at must store no workout key").toBeNull();

  // And nothing is queued for sync.
  const queued = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const request = indexedDB.open("gain-sync", 1);
        request.onsuccess = () => {
          const db = request.result;
          const all = db.transaction("outbox").objectStore("outbox").getAll();
          all.onsuccess = () => resolve((all.result as unknown[]).length);
          all.onerror = () => resolve(-1);
        };
        request.onerror = () => resolve(-1);
      }),
  );
  expect(queued, "a session that was only looked at must queue no ops").toBe(0);

  // -- Home is where it was: same suggestion, and no history row to show for it.
  await page.goto("/");
  await expect(suggestion).toHaveText(before ?? "");

  await page.goto(`/plan/${E2E_PLAN_SLUG}/history`);
  await expect(page.getByText("No workouts logged yet")).toBeVisible();
});
