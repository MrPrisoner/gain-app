/**
 * Per-user database provisioning (ARCHITECTURE decisions 4 and 5).
 *
 * Every user gets physical isolation: one `gain.db` plus a file directory under
 * `<dataDir>/users/<userId>/`. No cross-user query can exist because there is no
 * cross-user database. Deleting a user is `rm -rf users/<id>` (plus the control.db
 * row, which arrives with phase 3).
 *
 * ```
 * <dataDir>/
 *   users/
 *     <userId>/
 *       gain.db                # ALL of this user's training data
 *       plans/<plan.slug>/v<N>.md   # verbatim imports, never modified
 *       exports/               # generated bundles, retained for reference
 * ```
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "./migrate";

/**
 * User IDs come from the OIDC `sub` claim (phase 3). Allow the conservative
 * character set that cannot escape the user directory — provisioning must never
 * be a path-traversal vector.
 */
const USER_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

export type UserDb = {
  /** The open SQLite database. */
  db: Database.Database;
  /** Absolute path of the user's directory (`<dataDir>/users/<userId>`). */
  userDir: string;
  /** Absolute path of `gain.db`. */
  dbPath: string;
  /** Close the database. */
  close(): void;
};

export type ProvisionOptions = {
  /** Injected clock — the deterministic-core rule applies to provisioning too. */
  now: Date;
};

/**
 * Open (and if necessary create) a user's database and directory tree.
 *
 * Idempotent: opening an existing user runs migrations forward and returns the
 * same handle.
 */
export function openUserDb(dataDir: string, userId: string, options: ProvisionOptions): UserDb {
  if (!USER_ID_REGEX.test(userId)) {
    throw new Error(
      `invalid user id ${JSON.stringify(userId)} — expected 1–128 characters of [A-Za-z0-9_-]`,
    );
  }

  const userDir = path.join(dataDir, "users", userId);
  fs.mkdirSync(path.join(userDir, "plans"), { recursive: true });
  fs.mkdirSync(path.join(userDir, "exports"), { recursive: true });

  const dbPath = path.join(userDir, "gain.db");
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  migrate(db, options.now);

  return {
    db,
    userDir,
    dbPath,
    close: () => db.close(),
  };
}
