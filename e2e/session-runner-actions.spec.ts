/**
 * Form-action failure handling (CLAUDE.md, "Rules learned the hard way"): an action must
 * never bare-`throw` on a missing required field — before this task, `requireText`
 * (`+page.server.ts`) threw a plain `Error`, which SvelteKit turns into an unhandled
 * 500 and `+error.svelte` replaces the whole in-progress runner. This test drives the
 * real HTTP contract of `?/start` (no `use:enhance`/JS in the loop, so it exercises
 * SvelteKit's non-JS form-action fallback: a POST with `Accept: text/html` re-renders
 * the *same* route with the action's `fail()` status) and asserts a missing `client_id`
 * degrades to a 400 with a message, not a 500 replacing the page.
 *
 * `?/logSet`, `?/logMetric`, `?/logDeviation` and `?/finish` are gone — every real write
 * goes through the outbox and `/api/sync` instead — so `?/start`, kept as the read-only
 * fallback-hydration path, is the only action left on this route to demonstrate the
 * invariant against.
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth/cookie setup
 * is needed: every request to the dev server already carries a `locals.user`.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG, E2E_SESSION_KEYS } from "./env";

test("?/start with an empty client_id fails with 400 and a message, not a 500", async ({
  request,
}) => {
  const response = await request.post(
    `/plan/${E2E_PLAN_SLUG}/session/${E2E_SESSION_KEYS[0]}?/start`,
    {
      headers: { accept: "text/html" },
      form: { client_id: "" },
    },
  );

  expect(response.status()).toBe(400);

  const body = await response.text();
  expect(body).toContain("missing required form field");
  expect(body).toContain("client_id");

  // The runner shell itself must still have rendered — not +error.svelte swallowing the
  // whole page.
  expect(body).toContain("runner-head");
  expect(body).not.toContain("error-page");
  expect(body).not.toContain("Something went wrong");
});
