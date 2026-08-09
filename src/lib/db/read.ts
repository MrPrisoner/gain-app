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
