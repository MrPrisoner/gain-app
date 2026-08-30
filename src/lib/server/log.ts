/**
 * The one place a route may log.
 *
 * `no-console` is an error everywhere except `src/lib/server/**` and `hooks.server.ts`
 * (see `eslint.config.js`) — the pure core has no business writing to a stream, and a
 * stray `console.log` in it is almost always a leftover. A route that genuinely needs to
 * record a server-side failure calls this rather than widening that rule to every route
 * file, which would give up the check for the sake of one call site.
 *
 * Server-side only, by construction: `$lib/server/**` cannot be imported by anything that
 * reaches the browser, so nothing logged here can leak into a page.
 */
export function logServerError(message: string, cause: unknown): void {
  console.error(`[gain] ${message}`, cause);
}

/**
 * One line per request, logged from `hooks.server.ts`'s `handle` after `resolve()` (or
 * after the gate refuses, whichever answers first) — so every response GAIN sends gets a
 * line, not just the ones a route chose to log. Before this the only account of what a
 * user was doing before something broke was the stack trace itself, which is not always
 * enough (review 2026-08-27, E6).
 */
export function logRequest(fields: {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  userId: string | null;
}): void {
  console.log(
    `[gain] ${fields.method} ${fields.path} ${fields.status} ${fields.durationMs}ms ` +
      `user=${fields.userId ?? "-"}`,
  );
}

/**
 * An error that escaped every route and reached SvelteKit's own `handleError` hook —
 * distinct from `logServerError`, which is a route choosing to record a failure it caught
 * and turned into a clean `fail()`. This one fires for what nothing caught. `errorId` is
 * also what the user sees on `+error.svelte`, so a report that names it is traceable back
 * to this exact line without asking the user for anything else.
 */
export function logUnhandledError(
  fields: { errorId: string; method: string; path: string; userId: string | null },
  cause: unknown,
): void {
  console.error(
    `[gain] unhandled error id=${fields.errorId} ${fields.method} ${fields.path} ` +
      `user=${fields.userId ?? "-"}`,
    cause,
  );
}
