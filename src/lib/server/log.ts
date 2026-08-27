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
