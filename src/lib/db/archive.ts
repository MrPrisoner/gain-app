/**
 * Archiving a plan (ROADMAP, "Loose ends"; semantics settled 2026-08-23).
 *
 * Archiving is **reversible and read-only, not deletion**. An archived plan drops off
 * the active Home list and refuses to start new sessions or accept a revision; its
 * history, progress, export and version browsing all stay open, marked archived.
 * Nothing here touches a `workout`, a `set_log` or a `plan_version` — the only column
 * that moves is `plan.archived_at`, so unarchiving restores exactly the state that was
 * there before, and the user's logged history is never at risk.
 *
 * `now` is injected like every other write in this directory, so the write path is
 * deterministic under test.
 */

import type { UserDb } from "./user-db";

/**
 * Mark a plan archived. Returns false when the slug is unknown, or when the plan is
 * already archived — an idempotent second archive must not overwrite the original
 * timestamp, which is the only record of when it happened.
 */
export function archivePlan(userDb: UserDb, slug: string, now: Date): boolean {
  const result = userDb.db
    .prepare("UPDATE plan SET archived_at = ? WHERE slug = ? AND archived_at IS NULL")
    .run(now.toISOString(), slug);
  return result.changes > 0;
}

/** Bring an archived plan back. Returns false when the slug is unknown or already active. */
export function unarchivePlan(userDb: UserDb, slug: string): boolean {
  const result = userDb.db
    .prepare("UPDATE plan SET archived_at = NULL WHERE slug = ? AND archived_at IS NOT NULL")
    .run(slug);
  return result.changes > 0;
}
