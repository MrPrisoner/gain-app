/**
 * control.db: the OIDC subject → user id mapping, server-side sessions and
 * short-lived authorization state (ARCHITECTURE §3, §4). Nothing personal.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bumpDataGeneration,
  createSession,
  createUser,
  deleteSession,
  deleteSessionsForUser,
  extendSession,
  findUserBySub,
  getDataGeneration,
  getSession,
  getUserById,
  listUsers,
  openControlDb,
  purgeExpiredSessions,
  purgeOidcState,
  putOidcState,
  setDisplayLabel,
  setSessionAdmin,
  storeRefreshedTokens,
  takeOidcState,
  touchUserLogin,
  type ControlDb,
} from "../../src/lib/server/control-db";

const NOW = new Date("2026-09-08T08:00:00Z");
const IDLE_MS = 60_000;

describe("control.db", () => {
  let dataDir: string;
  let control: ControlDb | undefined;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-control-test-"));
  });

  afterEach(() => {
    control?.close();
    control = undefined;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("opens and migrates, idempotently", () => {
    control = openControlDb(dataDir, NOW);
    expect(fs.existsSync(path.join(dataDir, "control.db"))).toBe(true);

    const rows = control.db.prepare("SELECT version, name FROM _control_migration").all() as {
      version: number;
      name: string;
    }[];
    expect(rows).toEqual([
      { version: 1, name: "control-foundation" },
      { version: 2, name: "admin-and-generation" },
    ]);

    control.close();
    control = openControlDb(dataDir, NOW);
    const again = control.db.prepare("SELECT COUNT(*) AS n FROM _control_migration").get() as {
      n: number;
    };
    expect(again.n).toBe(2);
  });

  describe("users", () => {
    it("maps an OIDC subject to a stable user id", () => {
      control = openControlDb(dataDir, NOW);
      const user = createUser(control, "sub-123", NOW);

      expect(user.oidc_sub).toBe("sub-123");
      expect(user.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i); // ULID
      expect(findUserBySub(control, "sub-123")).toEqual(user);
      expect(getUserById(control, user.id)).toEqual(user);
      expect(findUserBySub(control, "someone-else")).toBeUndefined();
    });

    it("enforces one user per subject", () => {
      control = openControlDb(dataDir, NOW);
      const db = control;
      createUser(db, "sub-123", NOW);
      expect(() => createUser(db, "sub-123", NOW)).toThrow();
    });

    it("updates last_login_at on touch", () => {
      control = openControlDb(dataDir, NOW);
      const user = createUser(control, "sub-123", NOW);
      const later = new Date("2026-09-09T10:00:00Z");
      touchUserLogin(control, user.id, later);

      expect(findUserBySub(control, "sub-123")?.last_login_at).toBe(later.toISOString());
      expect(findUserBySub(control, "sub-123")?.created_at).toBe(NOW.toISOString());
    });
  });

  describe("sessions", () => {
    it("creates and resolves a session with its tokens", () => {
      control = openControlDb(dataDir, NOW);
      const user = createUser(control, "sub-1", NOW);
      const session = createSession(control, {
        userId: user.id,
        now: NOW,
        idleMs: IDLE_MS,
        tokens: {
          access_token: "at",
          access_expires_at: new Date(NOW.getTime() + 600_000).toISOString(),
          refresh_token: "rt",
          id_token: "idt",
        },
        isAdmin: false,
      });

      expect(session.id).toMatch(/^[0-9a-f]{64}$/);
      const fetched = getSession(control, session.id, NOW);
      expect(fetched?.user_id).toBe(user.id);
      expect(fetched?.access_token).toBe("at");
      expect(fetched?.refresh_token).toBe("rt");
      expect(fetched?.id_token).toBe("idt");
    });

    it("expires sessions after the idle window and deletes them on access", () => {
      control = openControlDb(dataDir, NOW);
      const user = createUser(control, "sub-1", NOW);
      const session = createSession(control, {
        userId: user.id,
        now: NOW,
        idleMs: IDLE_MS,
        tokens: {
          access_token: null,
          access_expires_at: null,
          refresh_token: null,
          id_token: null,
        },
        isAdmin: false,
      });

      expect(getSession(control, session.id, new Date(NOW.getTime() + IDLE_MS))).toBeUndefined();
      // The expired row is gone, not merely filtered.
      const count = control.db.prepare("SELECT COUNT(*) AS n FROM session").get() as { n: number };
      expect(count.n).toBe(0);
    });

    it("extends the sliding expiry", () => {
      control = openControlDb(dataDir, NOW);
      const user = createUser(control, "sub-1", NOW);
      const session = createSession(control, {
        userId: user.id,
        now: NOW,
        idleMs: IDLE_MS,
        tokens: {
          access_token: null,
          access_expires_at: null,
          refresh_token: null,
          id_token: null,
        },
        isAdmin: false,
      });

      const later = new Date(NOW.getTime() + 30_000);
      extendSession(control, session.id, later, IDLE_MS);

      const row = getSession(control, session.id, later);
      expect(row?.expires_at).toBe(new Date(later.getTime() + IDLE_MS).toISOString());
      expect(row?.last_seen_at).toBe(later.toISOString());
    });

    it("stores refreshed tokens", () => {
      control = openControlDb(dataDir, NOW);
      const user = createUser(control, "sub-1", NOW);
      const session = createSession(control, {
        userId: user.id,
        now: NOW,
        idleMs: IDLE_MS,
        tokens: {
          access_token: "old",
          access_expires_at: null,
          refresh_token: "rt",
          id_token: null,
        },
        isAdmin: false,
      });

      storeRefreshedTokens(control, session.id, {
        access_token: "new",
        access_expires_at: "2026-09-08T08:10:00.000Z",
        refresh_token: null,
        id_token: "idt2",
      });

      const row = getSession(control, session.id, NOW);
      expect(row?.access_token).toBe("new");
      expect(row?.access_expires_at).toBe("2026-09-08T08:10:00.000Z");
      expect(row?.refresh_token).toBeNull();
      expect(row?.id_token).toBe("idt2");
    });

    it("deletes sessions explicitly and purges expired ones in bulk", () => {
      control = openControlDb(dataDir, NOW);
      const user = createUser(control, "sub-1", NOW);
      const keep = createSession(control, {
        userId: user.id,
        now: NOW,
        idleMs: IDLE_MS,
        tokens: {
          access_token: null,
          access_expires_at: null,
          refresh_token: null,
          id_token: null,
        },
        isAdmin: false,
      });
      const stale = createSession(control, {
        userId: user.id,
        now: new Date(NOW.getTime() - 2 * IDLE_MS),
        idleMs: IDLE_MS,
        tokens: {
          access_token: null,
          access_expires_at: null,
          refresh_token: null,
          id_token: null,
        },
        isAdmin: false,
      });

      deleteSession(control, keep.id);
      expect(getSession(control, keep.id, NOW)).toBeUndefined();

      expect(purgeExpiredSessions(control, NOW)).toBe(1);
      expect(getSession(control, stale.id, NOW)).toBeUndefined();
    });
  });

  describe("oidc authorization state", () => {
    it("is read-once", () => {
      control = openControlDb(dataDir, NOW);
      putOidcState(control, {
        state: "st-1",
        codeVerifier: "verifier",
        nonce: "nonce",
        returnTo: "/",
        now: NOW,
      });

      const taken = takeOidcState(control, "st-1");
      expect(taken).toMatchObject({ state: "st-1", code_verifier: "verifier", nonce: "nonce" });
      expect(takeOidcState(control, "st-1")).toBeUndefined();
    });

    it("purges old states but keeps fresh ones", () => {
      control = openControlDb(dataDir, NOW);
      putOidcState(control, {
        state: "old",
        codeVerifier: "v",
        nonce: "n",
        returnTo: "/",
        now: new Date(NOW.getTime() - 11 * 60_000),
      });
      putOidcState(control, {
        state: "fresh",
        codeVerifier: "v",
        nonce: "n",
        returnTo: "/",
        now: NOW,
      });

      expect(purgeOidcState(control, NOW, 10 * 60_000)).toBe(1);
      expect(takeOidcState(control, "fresh")).toBeDefined();
      expect(takeOidcState(control, "old")).toBeUndefined();
    });
  });

  describe("migration 002 — admin and generation columns", () => {
    it("defaults a new user to no label and generation 0", () => {
      control = openControlDb(dataDir, NOW);
      const user = createUser(control, "sub-1", NOW);
      expect(user.display_label).toBeNull();
      expect(user.data_generation).toBe(0);
    });

    it("stores and overwrites a display label", () => {
      control = openControlDb(dataDir, NOW);
      const user = createUser(control, "sub-1", NOW);
      setDisplayLabel(control, user.id, "alice");
      expect(getUserById(control, user.id)?.display_label).toBe("alice");
      setDisplayLabel(control, user.id, "alice.renamed");
      expect(getUserById(control, user.id)?.display_label).toBe("alice.renamed");
    });

    it("bumps the generation monotonically and reads it back", () => {
      control = openControlDb(dataDir, NOW);
      const user = createUser(control, "sub-1", NOW);
      expect(bumpDataGeneration(control, user.id)).toBe(1);
      expect(bumpDataGeneration(control, user.id)).toBe(2);
      expect(getDataGeneration(control, user.id)).toBe(2);
    });

    it("lists users most-recently-logged-in first", () => {
      control = openControlDb(dataDir, NOW);
      const older = createUser(control, "sub-old", new Date("2026-01-01T00:00:00Z"));
      const newer = createUser(control, "sub-new", new Date("2026-08-01T00:00:00Z"));
      expect(listUsers(control).map((u) => u.id)).toEqual([newer.id, older.id]);
    });

    it("records is_admin on the session and updates it in place", () => {
      control = openControlDb(dataDir, NOW);
      const user = createUser(control, "sub-1", NOW);
      const session = createSession(control, {
        userId: user.id,
        now: NOW,
        idleMs: IDLE_MS,
        tokens: {
          access_token: null,
          access_expires_at: null,
          refresh_token: null,
          id_token: null,
        },
        isAdmin: true,
      });
      expect(session.is_admin).toBe(1);
      setSessionAdmin(control, session.id, false);
      expect(getSession(control, session.id, NOW)?.is_admin).toBe(0);
    });

    it("deletes every session belonging to one user and no others", () => {
      control = openControlDb(dataDir, NOW);
      const a = createUser(control, "sub-a", NOW);
      const b = createUser(control, "sub-b", NOW);
      const tokens = {
        access_token: null,
        access_expires_at: null,
        refresh_token: null,
        id_token: null,
      };
      createSession(control, { userId: a.id, now: NOW, idleMs: IDLE_MS, tokens, isAdmin: false });
      createSession(control, { userId: a.id, now: NOW, idleMs: IDLE_MS, tokens, isAdmin: false });
      const kept = createSession(control, {
        userId: b.id,
        now: NOW,
        idleMs: IDLE_MS,
        tokens,
        isAdmin: false,
      });

      expect(deleteSessionsForUser(control, a.id)).toBe(2);
      expect(getSession(control, kept.id, NOW)).toBeDefined();
    });
  });
});
