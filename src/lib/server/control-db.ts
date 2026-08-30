/**
 * `control.db` — the one shared database (ARCHITECTURE §3): users, the OIDC
 * subject → user id mapping, server-side sessions, and short-lived OIDC
 * authorization state. Nothing personal lives here: no names, no emails. The
 * identity key is the `sub` claim, never email (§4).
 *
 * All training data stays in the per-user `gain.db`; this file only knows that
 * user `<id>` exists and when they last logged in.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { newId } from "../db/ulid";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

type ControlMigration = { version: number; name: string; sql: string };

const MIGRATIONS: ControlMigration[] = [
  {
    version: 1,
    name: "control-foundation",
    sql: `
      CREATE TABLE control_user (
        id            TEXT PRIMARY KEY,
        oidc_sub      TEXT NOT NULL UNIQUE,
        created_at    TEXT NOT NULL,
        last_login_at TEXT NOT NULL
      );

      CREATE TABLE session (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL REFERENCES control_user(id) ON DELETE CASCADE,
        created_at        TEXT NOT NULL,
        last_seen_at      TEXT NOT NULL,
        expires_at        TEXT NOT NULL,
        access_token      TEXT,
        access_expires_at TEXT,
        refresh_token     TEXT,
        id_token          TEXT
      );
      CREATE INDEX idx_session_user ON session (user_id);

      CREATE TABLE oidc_state (
        state         TEXT PRIMARY KEY,
        code_verifier TEXT NOT NULL,
        nonce         TEXT NOT NULL,
        return_to     TEXT NOT NULL DEFAULT '/',
        created_at    TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "admin-and-generation",
    sql: `
      -- The operator needs a human-readable label to aim a reset at; a list of
      -- ULIDs forces the identification step out into Authentik, unchecked
      --. This narrows "nothing personal in control.db" to "no training
      -- data in control.db" — see ARCHITECTURE §4.
      ALTER TABLE control_user ADD COLUMN display_label TEXT;

      -- Bumped by a reset. The offline outbox carries the generation it was
      -- filled under, so ops from before a wipe are rejected wholesale rather
      -- than flushing back in and quarantining forever.
      ALTER TABLE control_user ADD COLUMN data_generation INTEGER NOT NULL DEFAULT 0;

      -- Admin-ness is a property of the session, not the user: it is recomputed
      -- from the IdP's groups at login and on every token refresh, so there is no
      -- stored privilege that can disagree with Authentik.
      ALTER TABLE session ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
    `,
  },
];

const TRACKING_TABLE = `
CREATE TABLE IF NOT EXISTS _control_migration (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TEXT NOT NULL
)`;

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type ControlUser = {
  id: string;
  oidc_sub: string;
  created_at: string;
  last_login_at: string;
  /** Operator-facing label only (§4) — never an identity key. */
  display_label: string | null;
  /** Bumped by an admin reset; the offline outbox is stamped with it. */
  data_generation: number;
};

export type SessionRow = {
  id: string;
  user_id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  access_token: string | null;
  access_expires_at: string | null;
  refresh_token: string | null;
  id_token: string | null;
  /** SQLite has no boolean: 0 or 1. Re-derived from the IdP's groups, never stored on the user. */
  is_admin: number;
};

export type OidcStateRow = {
  state: string;
  code_verifier: string;
  nonce: string;
  return_to: string;
  created_at: string;
};

export type ControlDb = {
  db: Database.Database;
  dbPath: string;
  close(): void;
};

// ---------------------------------------------------------------------------
// Opening + migration
// ---------------------------------------------------------------------------

/** Open (and if necessary create) `<dataDir>/control.db`, migrating forward. */
export function openControlDb(dataDir: string, now: Date): ControlDb {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "control.db");
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(TRACKING_TABLE);
  const applied = new Set<number>(
    db
      .prepare("SELECT version FROM _control_migration")
      .all()
      .map((row) => (row as { version: number }).version),
  );
  const insert = db.prepare(
    "INSERT INTO _control_migration (version, name, applied_at) VALUES (?, ?, ?)",
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      insert.run(migration.version, migration.name, now.toISOString());
    })();
  }

  return { db, dbPath, close: () => db.close() };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function findUserBySub(control: ControlDb, oidcSub: string): ControlUser | undefined {
  return control.db.prepare("SELECT * FROM control_user WHERE oidc_sub = ?").get(oidcSub) as
    ControlUser | undefined;
}

export function getUserById(control: ControlDb, userId: string): ControlUser | undefined {
  return control.db.prepare("SELECT * FROM control_user WHERE id = ?").get(userId) as
    ControlUser | undefined;
}

/**
 * First successful login creates the row (§4). The user id — a ULID, never the
 * email or the sub — doubles as the directory name under `users/`.
 */
export function createUser(control: ControlDb, oidcSub: string, now: Date): ControlUser {
  const user: ControlUser = {
    id: newId(),
    oidc_sub: oidcSub,
    created_at: now.toISOString(),
    last_login_at: now.toISOString(),
    display_label: null,
    data_generation: 0,
  };
  control.db
    .prepare(
      "INSERT INTO control_user (id, oidc_sub, created_at, last_login_at) VALUES (?, ?, ?, ?)",
    )
    .run(user.id, user.oidc_sub, user.created_at, user.last_login_at);
  return user;
}

/** Every registered user, most recently active first — the admin list's source. */
export function listUsers(control: ControlDb): ControlUser[] {
  return control.db
    .prepare("SELECT * FROM control_user ORDER BY last_login_at DESC")
    .all() as ControlUser[];
}

/**
 * The label the operator identifies this user by, rewritten on every login from
 * `preferred_username ?? email ?? name`. Display only — never an identity key (§4).
 */
export function setDisplayLabel(control: ControlDb, userId: string, label: string | null): void {
  control.db.prepare("UPDATE control_user SET display_label = ? WHERE id = ?").run(label, userId);
}

/** Invalidate everything the client queued under the old generation. Returns the new one. */
export function bumpDataGeneration(control: ControlDb, userId: string): number {
  const row = control.db
    .prepare(
      "UPDATE control_user SET data_generation = data_generation + 1 WHERE id = ? " +
        "RETURNING data_generation",
    )
    .get(userId) as { data_generation: number } | undefined;
  if (!row) throw new Error(`No such user: ${userId}`);
  return row.data_generation;
}

export function getDataGeneration(control: ControlDb, userId: string): number {
  const row = control.db
    .prepare("SELECT data_generation FROM control_user WHERE id = ?")
    .get(userId) as { data_generation: number } | undefined;
  return row?.data_generation ?? 0;
}

export function touchUserLogin(control: ControlDb, userId: string, now: Date): void {
  control.db
    .prepare("UPDATE control_user SET last_login_at = ? WHERE id = ?")
    .run(now.toISOString(), userId);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** A fresh opaque session id: 32 random bytes, hex. */
export function newSessionId(): string {
  return crypto.randomBytes(32).toString("hex");
}

export type NewSessionTokens = {
  access_token: string | null;
  access_expires_at: string | null;
  refresh_token: string | null;
  id_token: string | null;
};

export function createSession(
  control: ControlDb,
  input: {
    userId: string;
    now: Date;
    idleMs: number;
    tokens: NewSessionTokens;
    isAdmin: boolean;
  },
): SessionRow {
  const session: SessionRow = {
    id: newSessionId(),
    user_id: input.userId,
    created_at: input.now.toISOString(),
    last_seen_at: input.now.toISOString(),
    expires_at: new Date(input.now.getTime() + input.idleMs).toISOString(),
    access_token: input.tokens.access_token,
    access_expires_at: input.tokens.access_expires_at,
    refresh_token: input.tokens.refresh_token,
    id_token: input.tokens.id_token,
    is_admin: input.isAdmin ? 1 : 0,
  };
  control.db
    .prepare(
      `INSERT INTO session (
         id, user_id, created_at, last_seen_at, expires_at,
         access_token, access_expires_at, refresh_token, id_token, is_admin
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      session.id,
      session.user_id,
      session.created_at,
      session.last_seen_at,
      session.expires_at,
      session.access_token,
      session.access_expires_at,
      session.refresh_token,
      session.id_token,
      session.is_admin,
    );
  return session;
}

/** The session row if it exists and has not expired; expired rows are deleted. */
export function getSession(
  control: ControlDb,
  sessionId: string,
  now: Date,
): SessionRow | undefined {
  const row = control.db.prepare("SELECT * FROM session WHERE id = ?").get(sessionId) as
    SessionRow | undefined;
  if (!row) return undefined;
  if (row.expires_at <= now.toISOString()) {
    deleteSession(control, sessionId);
    return undefined;
  }
  return row;
}

/** Sliding expiry: push `expires_at` out to now + idleMs. */
export function extendSession(
  control: ControlDb,
  sessionId: string,
  now: Date,
  idleMs: number,
): void {
  control.db
    .prepare("UPDATE session SET last_seen_at = ?, expires_at = ? WHERE id = ?")
    .run(now.toISOString(), new Date(now.getTime() + idleMs).toISOString(), sessionId);
}

export function storeRefreshedTokens(
  control: ControlDb,
  sessionId: string,
  tokens: NewSessionTokens,
): void {
  control.db
    .prepare(
      `UPDATE session
       SET access_token = ?, access_expires_at = ?, refresh_token = ?, id_token = ?
       WHERE id = ?`,
    )
    .run(
      tokens.access_token,
      tokens.access_expires_at,
      tokens.refresh_token,
      tokens.id_token,
      sessionId,
    );
}

/** Re-stamp a live session's operator flag after a token refresh re-read the groups. */
export function setSessionAdmin(control: ControlDb, sessionId: string, isAdmin: boolean): void {
  control.db
    .prepare("UPDATE session SET is_admin = ? WHERE id = ?")
    .run(isAdmin ? 1 : 0, sessionId);
}

export function deleteSession(control: ControlDb, sessionId: string): void {
  control.db.prepare("DELETE FROM session WHERE id = ?").run(sessionId);
}

/**
 * Sign this user out everywhere. The first step of a reset: nothing
 * authenticated can write once their sessions are gone.
 */
export function deleteSessionsForUser(control: ControlDb, userId: string): number {
  return control.db.prepare("DELETE FROM session WHERE user_id = ?").run(userId).changes;
}

/** Housekeeping — drop sessions whose sliding window has fully elapsed. */
export function purgeExpiredSessions(control: ControlDb, now: Date): number {
  const result = control.db
    .prepare("DELETE FROM session WHERE expires_at <= ?")
    .run(now.toISOString());
  return result.changes;
}

// ---------------------------------------------------------------------------
// OIDC authorization state (PKCE verifier + nonce, ~10 minute lifetime)
// ---------------------------------------------------------------------------

export function putOidcState(
  control: ControlDb,
  row: { state: string; codeVerifier: string; nonce: string; returnTo: string; now: Date },
): void {
  control.db
    .prepare(
      `INSERT INTO oidc_state (state, code_verifier, nonce, return_to, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(row.state, row.codeVerifier, row.nonce, row.returnTo, row.now.toISOString());
}

/** Read-once: the row is deleted as it is taken (CSRF protection). */
export function takeOidcState(control: ControlDb, state: string): OidcStateRow | undefined {
  const row = control.db.prepare("SELECT * FROM oidc_state WHERE state = ?").get(state) as
    OidcStateRow | undefined;
  if (row) control.db.prepare("DELETE FROM oidc_state WHERE state = ?").run(state);
  return row;
}

/** Drop authorization states older than `maxAgeMs`. */
export function purgeOidcState(control: ControlDb, now: Date, maxAgeMs: number): number {
  const cutoff = new Date(now.getTime() - maxAgeMs).toISOString();
  const result = control.db.prepare("DELETE FROM oidc_state WHERE created_at < ?").run(cutoff);
  return result.changes;
}
