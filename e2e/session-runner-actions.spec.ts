/**
 * Form-action failure handling (AGENTS.md, "What the phase-4 review changed"): an action must
 * never bare-`throw` on a missing required field — before this task, `requireText`
 * (`+page.server.ts`) threw a plain `Error`, which SvelteKit turns into an unhandled
 * 500 and `+error.svelte` replaces the whole in-progress runner. This test drives the
 * real HTTP contract of `?/logSet` (no `use:enhance`/JS in the loop, so it exercises
 * SvelteKit's non-JS form-action fallback: a POST with `Accept: text/html` re-renders
 * the *same* route with the action's `fail()` status) and asserts a missing
 * `workout_id` degrades to a 400 with a message, not a 500 replacing the page.
 *
 * `GAIN_DEV_USER` bypass mode (see `session-runner.spec.ts`) means no auth/cookie setup
 * is needed: every request to the dev server already carries a `locals.user`.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG, E2E_SESSION_KEYS } from "./env";

test("?/logSet with an empty workout_id fails with 400 and a message, not a 500", async ({
  request,
}) => {
  const response = await request.post(
    `/plan/${E2E_PLAN_SLUG}/session/${E2E_SESSION_KEYS[0]}?/logSet`,
    {
      headers: { accept: "text/html" },
      form: {
        workout_id: "",
        exercise_slug: "goblet-squat",
        set_no: "1",
        reps: "8",
        client_id: "e2e-logset-missing-workout-id",
      },
    },
  );

  expect(response.status()).toBe(400);

  const body = await response.text();
  expect(body).toContain("missing required form field");
  expect(body).toContain("workout_id");

  // The runner shell itself must still have rendered — not +error.svelte swallowing the
  // whole page (this request has no `workout_id`, i.e. no `?/start` round-trip preceded
  // it, so the runner correctly shows its own gated "starting" state —
  // but that is still the real runner, not the error boundary).
  expect(body).toContain("runner-head");
  expect(body).not.toContain("error-page");
  expect(body).not.toContain("Something went wrong");
});
