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
import { newId } from "./ulid";

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

export type SeedTemplate = {
  name: string;
  body_md: string;
  is_default?: boolean;
};

export type ProvisionOptions = {
  /** Injected clock — the deterministic-core rule applies to provisioning too. */
  now: Date;
  /**
   * AI instruction templates to seed when the user has none. Phase 3 passes the
   * bundled `templates/default-ai-instructions.md` here (ARCHITECTURE §4).
   */
  seedTemplates?: readonly SeedTemplate[];
};

/**
 * Open (and if necessary create) a user's database and directory tree.
 *
 * Idempotent: opening an existing user runs migrations forward and returns the
 * same handle. Seeding only happens when `ai_template` is empty.
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

  if (options.seedTemplates && options.seedTemplates.length > 0) {
    seedTemplatesIfEmpty(db, options.seedTemplates, options.now);
  }

  return {
    db,
    userDir,
    dbPath,
    close: () => db.close(),
  };
}

function seedTemplatesIfEmpty(
  db: Database.Database,
  templates: readonly SeedTemplate[],
  now: Date,
): void {
  const count = db.prepare("SELECT COUNT(*) AS n FROM ai_template").get() as { n: number };
  if (count.n > 0) return;

  const insert = db.prepare(
    "INSERT INTO ai_template (id, name, body_md, is_default, updated_at) VALUES (?, ?, ?, ?, ?)",
  );

  db.transaction(() => {
    for (const template of templates) {
      insert.run(
        newId(),
        template.name,
        template.body_md,
        template.is_default ? 1 : 0,
        now.toISOString(),
      );
    }
  })();
}
