import fs from "node:fs";
import { json } from "@sveltejs/kit";
import { getControlDb } from "$lib/server/app-state";
import { getConfig } from "$lib/server/config";

/**
 * Health endpoint for Portainer/uptime checks (ARCHITECTURE §3). Deliberately
 * outside the auth gate — hooks.server.ts lets `/healthz` through untouched.
 *
 * It exercises the data directory rather than returning a constant. A static `ok`
 * exercises nothing at all: `isPublicPath` short-circuits before any database access and
 * `startup()` is `started`-guarded, so a container whose storage had failed still
 * answered 200 while every new user's page 500'd — and both the Docker `HEALTHCHECK` and
 * Portainer poll this (`r.ok`, so a 503 correctly fails both), meaning nothing restarted
 * and nothing alerted.
 *
 * That failure is harder to notice than it sounds, because already-active users keep
 * working through it: their database handle is already in `app-state.ts`'s process-wide
 * cache. It presents as new and uncached users breaking while existing sessions carry on.
 *
 * The writability check is the load-bearing half, and it is load-bearing for a reason
 * worth not rediscovering: an `access(W_OK)` on the data directory catches a read-only
 * remount, a vanished volume and a permissions change, whereas the obvious check — a
 * `SELECT 1` against `control.db` — does **not**. Verified by making the data directory
 * unreadable under a running server: the query still succeeded, because SQLite was
 * reading through a file descriptor opened at startup and revoking a directory's
 * permissions does not revoke an open fd. It answered 200 while the app 500'd, which is
 * precisely the bug. The `SELECT 1` is kept anyway — it costs nothing and covers a
 * corrupted or closed handle, which the `access` check cannot see — but it is the second
 * line, not the first.
 *
 * What this still does not catch is a full disk: nothing cheap does, and a check that
 * writes a probe file on every poll is not cheap. It also deliberately does not walk
 * per-user databases, which would make its cost grow with the user count — the one thing
 * a poll-every-30s endpoint must not do.
 */
export function GET() {
  try {
    fs.accessSync(getConfig().dataDir, fs.constants.R_OK | fs.constants.W_OK);
    getControlDb().db.prepare("SELECT 1").get();
  } catch (err) {
    // The cause goes to the container log, not to the response. This endpoint is outside
    // the auth gate by design, and `err.message` carries the absolute path and the errno
    // (`EACCES: permission denied, access '/data'`) — neither of which either consumer
    // reads: the Docker `HEALTHCHECK` and Portainer both look at `r.ok` and nothing else.
    console.error("[gain] healthz failed:", err);
    return json({ status: "error" }, { status: 503 });
  }
  return json({ status: "ok" });
}
