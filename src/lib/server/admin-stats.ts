/**
 * Per-user aggregates for the operator screen (spec §5) — and the only module in GAIN
 * that opens a `gain.db` belonging to someone other than the requesting user.
 *
 * That concentration is the design. ARCHITECTURE §4's promise is that no code path
 * reads another user's training data; keeping every cross-user read in one file makes
 * that a property of a module boundary rather than a rule every future feature has to
 * remember. **Nothing here may return a row from a content table.** Only `COUNT(*)`,
 * `MAX(...)` and file sizes leave this module, and `tests/server/admin-stats.test.ts`
 * asserts it.
 *
 * The `readonly` open is defence in depth rather than the guarantee itself: a read-only
 * connection to a WAL database throws `SQLITE_CANTOPEN` when no `-shm` exists and it
 * cannot create one — reachable for a user provisioned but never written to — so there
 * is a fallback, and the query surface above is what actually holds the line.
 *
 * Handles are opened per request and closed in a `finally`. `getUserDbFor` is
 * deliberately not used: it would hand admin code a writable handle to every user's
 * data and fill the process-wide cache with users the operator merely looked at.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ControlUser } from "./control-db";

export type UserStats = {
  userId: string;
  displayLabel: string | null;
  oidcSub: string;
  createdAt: string;
  lastLoginAt: string;
  /** False when this user has logged in but no `gain.db` exists yet. */
  provisioned: boolean;
  plans: number;
  planVersions: number;
  workoutsStarted: number;
  workoutsFinished: number;
  setLogs: number;
  lastWorkoutAt: string | null;
  /** Recursive size of `users/<id>/`, so plan documents and archived exports count. */
  diskBytes: number;
};

type Counts = Omit<
  UserStats,
  "userId" | "displayLabel" | "oidcSub" | "createdAt" | "lastLoginAt" | "diskBytes"
>;

const EMPTY: Counts = {
  provisioned: false,
  plans: 0,
  planVersions: 0,
  workoutsStarted: 0,
  workoutsFinished: 0,
  setLogs: 0,
  lastWorkoutAt: null,
};

export function statsForUsers(dataDir: string, users: readonly ControlUser[]): UserStats[] {
  return users.map((user) => {
    const userDir = path.join(dataDir, "users", user.id);
    return {
      userId: user.id,
      displayLabel: user.display_label,
      oidcSub: user.oidc_sub,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      diskBytes: directorySize(userDir),
      ...countsFor(path.join(userDir, "gain.db")),
    };
  });
}

function countsFor(dbPath: string): Counts {
  if (!fs.existsSync(dbPath)) return EMPTY;

  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    // See the module comment: a cold WAL database cannot always be opened read-only.
    db = new Database(dbPath, { fileMustExist: true });
  }

  try {
    return {
      provisioned: true,
      plans: count(db, "SELECT COUNT(*) AS n FROM plan"),
      planVersions: count(db, "SELECT COUNT(*) AS n FROM plan_version"),
      workoutsStarted: count(db, "SELECT COUNT(*) AS n FROM workout"),
      workoutsFinished: count(
        db,
        "SELECT COUNT(*) AS n FROM workout WHERE completed_at IS NOT NULL",
      ),
      setLogs: count(db, "SELECT COUNT(*) AS n FROM set_log"),
      lastWorkoutAt:
        (db.prepare("SELECT MAX(started_at) AS t FROM workout").get() as { t: string | null }).t ??
        null,
    };
  } finally {
    db.close();
  }
}

function count(db: Database.Database, sql: string): number {
  return (db.prepare(sql).get() as { n: number }).n;
}

/** Recursive byte total. Symlinks are counted by their own size, never followed. */
function directorySize(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += directorySize(full);
    } else {
      try {
        total += fs.lstatSync(full).size;
      } catch {
        // Raced with a reset. A missing file contributes nothing.
      }
    }
  }
  return total;
}
