/**
 * Read helpers for the per-user database: plans, versions, contracts, and the
 * verbatim source documents on disk.
 */

import fs from "node:fs";
import path from "node:path";
import type { GainContract } from "../contract/schema";
import type { UserDb } from "./user-db";

export type PlanRow = {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  archived_at: string | null;
};

export type PlanVersionRow = {
  id: string;
  plan_id: string;
  version_no: number;
  based_on_version: number | null;
  /** Relative to the user directory. */
  source_path: string;
  context_md: string;
  contract_json: string;
  changelog_json: string | null;
  block_length_weeks: number | null;
  session_target_min: number | null;
  scheduling_json: string | null;
  progression_json: string | null;
  safety_json: string | null;
  imported_at: string;
  is_current: 0 | 1;
};

export function getPlanBySlug(userDb: UserDb, slug: string): PlanRow | undefined {
  return userDb.db.prepare("SELECT * FROM plan WHERE slug = ?").get(slug) as PlanRow | undefined;
}

export function listPlans(userDb: UserDb): PlanRow[] {
  return userDb.db.prepare("SELECT * FROM plan ORDER BY created_at").all() as PlanRow[];
}

/** The version currently marked `is_current` for a plan, if any. */
export function getCurrentVersion(userDb: UserDb, planId: string): PlanVersionRow | undefined {
  return userDb.db
    .prepare("SELECT * FROM plan_version WHERE plan_id = ? AND is_current = 1")
    .get(planId) as PlanVersionRow | undefined;
}

export function listVersions(userDb: UserDb, planId: string): PlanVersionRow[] {
  return userDb.db
    .prepare("SELECT * FROM plan_version WHERE plan_id = ? ORDER BY version_no")
    .all(planId) as PlanVersionRow[];
}

/** Deserialize a stored contract. The JSON was written by `importPlan`. */
export function contractOfVersion(version: PlanVersionRow): GainContract {
  return JSON.parse(version.contract_json) as GainContract;
}

/** The verbatim source document of a version, read from disk (§11). */
export function readSourceMd(userDb: UserDb, version: PlanVersionRow): string {
  return fs.readFileSync(path.join(userDb.userDir, version.source_path), "utf8");
}

/**
 * The body of the user's default AI-instruction template — Section 0 of an export
 * (ARCHITECTURE §11). Seeded from `templates/default-ai-instructions.md` at provisioning
 * and user-editable from phase 8; undefined when nothing is marked default, which the
 * caller resolves by falling back to the bundled asset rather than exporting a bundle
 * with no task in it.
 */
export function getDefaultTemplate(userDb: UserDb): string | undefined {
  const row = userDb.db
    .prepare("SELECT body_md FROM ai_template WHERE is_default = 1 ORDER BY updated_at LIMIT 1")
    .get() as { body_md: string } | undefined;
  return row?.body_md;
}

/** The stable `exercise_def.id` for a catalogue slug, or undefined if never imported. */
export function getExerciseDefIdBySlug(
  userDb: UserDb,
  planId: string,
  slug: string,
): string | undefined {
  const row = userDb.db
    .prepare("SELECT id FROM exercise_def WHERE plan_id = ? AND slug = ?")
    .get(planId, slug) as { id: string } | undefined;
  return row?.id;
}
