/**
 * The periodic purge of everything in `control.db` that has outlived its use
 * (ARCHITECTURE §3, §4). `hooks.server.ts` runs it once at startup and then once a day.
 *
 * It is its own module for one reason: the daily run is a `setInterval` callback, and a
 * `setInterval` callback has no caller. Anything it throws reaches Node as an
 * `uncaughtException` and takes the process down — so a storage fault that `/healthz` is
 * built to report as a 503 would instead kill the container before it could report
 * anything, hours after the request traffic that would have made the fault obvious. A
 * failed purge is a real problem and is logged as one, but it is never worth the process.
 */

import { purgeExpiredSessions, purgeOidcState, type ControlDb } from "./control-db";

/**
 * How long an untaken `oidc_state` row is kept. The rows carry a 10-minute lifetime of
 * their own (`control-db.ts`); this covers the ones that were never taken back at all —
 * an abandoned login — which never expire on their own otherwise.
 */
const OIDC_STATE_MAX_AGE_MS = 60 * 60 * 1000;

export function runHousekeeping(control: ControlDb, now: Date): void {
  try {
    purgeExpiredSessions(control, now);
    purgeOidcState(control, now, OIDC_STATE_MAX_AGE_MS);
  } catch (err) {
    // `session` rows hold plaintext refresh tokens, so a purge that keeps failing is
    // worth investigating — hence a log line rather than a silent swallow.
    console.error("[gain] housekeeping failed:", err instanceof Error ? err.message : err);
  }
}
