/**
 * Migration runner for per-user `gain.db` databases.
 *
 * Migrations are plain SQL strings applied in version order, each exactly once,
 * tracked in `_gain_migration`. A migration either applies whole or not at all —
 * each runs inside a transaction.
 */

import type { Database } from "better-sqlite3";
import { MIGRATIONS } from "./schema";

const TRACKING_TABLE = `
CREATE TABLE IF NOT EXISTS _gain_migration (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TEXT NOT NULL
)`;

/** Apply every migration that has not yet been applied. Idempotent. */
export function migrate(db: Database, now: Date): void {
  db.exec(TRACKING_TABLE);

  const applied = new Set<number>(
    db
      .prepare("SELECT version FROM _gain_migration")
      .all()
      .map((row) => (row as { version: number }).version),
  );

  const insert = db.prepare(
    "INSERT INTO _gain_migration (version, name, applied_at) VALUES (?, ?, ?)",
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;

    db.transaction(() => {
      db.exec(migration.sql);
      insert.run(migration.version, migration.name, now.toISOString());
    })();
  }
}

/** The highest migration version applied to this database, or 0 for a fresh one. */
export function appliedSchemaVersion(db: Database): number {
  const row = db.prepare("SELECT MAX(version) AS v FROM _gain_migration").get() as
    { v: number | null } | undefined;
  return row?.v ?? 0;
}
