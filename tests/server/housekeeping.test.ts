/**
 * The periodic purge (`src/lib/server/housekeeping.ts`), which `hooks.server.ts` runs at
 * startup and then once a day on a bare `setInterval`.
 *
 * The interval is the reason this needs its own module and its own test. A callback that
 * throws inside a `setInterval` has no caller to catch it: it reaches Node as an
 * `uncaughtException` and takes the process down. The purge writes to `control.db`, so a
 * read-only remount or an I/O error — exactly what `/healthz` exists to report as a 503 —
 * would instead kill the container that was supposed to report it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSession,
  createUser,
  openControlDb,
  putOidcState,
  type ControlDb,
} from "../../src/lib/server/control-db";
import { runHousekeeping } from "../../src/lib/server/housekeeping";

const NOW = new Date("2026-09-08T08:00:00Z");

describe("runHousekeeping", () => {
  let dataDir: string;
  let control: ControlDb;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-housekeeping-test-"));
    control = openControlDb(dataDir, NOW);
  });

  afterEach(() => {
    control.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("purges expired sessions and stale authorization state", () => {
    const past = new Date(NOW.getTime() - 60_000);
    const user = createUser(control, "sub-housekeeping", past);
    // Idle window of nothing, so the session is already expired at NOW.
    createSession(control, {
      userId: user.id,
      now: past,
      idleMs: 0,
      tokens: {
        access_token: "a",
        access_expires_at: past.toISOString(),
        refresh_token: "r",
        id_token: "i",
      },
      isAdmin: false,
    });
    putOidcState(control, {
      state: "abandoned",
      nonce: "n",
      codeVerifier: "v",
      returnTo: "/",
      now: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
    });

    runHousekeeping(control, NOW);

    expect(control.db.prepare("SELECT COUNT(*) AS n FROM session").get()).toEqual({ n: 0 });
    expect(control.db.prepare("SELECT COUNT(*) AS n FROM oidc_state").get()).toEqual({ n: 0 });
  });

  it("survives a database it cannot write to, rather than killing the process", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // A closed handle is the cheapest real I/O failure: `better-sqlite3` throws on
    // `prepare`, the same way a read-only remount does on the write.
    control.close();

    expect(() => runHousekeeping(control, NOW)).not.toThrow();
    expect(errors).toHaveBeenCalled();

    control = openControlDb(dataDir, NOW);
  });
});
