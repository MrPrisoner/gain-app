/**
 * Import review (ARCHITECTURE §8): the same pipeline for every import, with the
 * diff step present only when there is something to compare against.
 *
 * - First import of a plan slug → summary only ("4 sessions, 26 exercises,
 *   49 prescriptions"). There is no diff to review when nothing exists yet.
 * - Revision import → the phase-1 diff engine compares the incoming contract
 *   against the stored current version: changed targets, added/removed
 *   exercises, unmatched slugs flagged as possible renames.
 *
 * `prepareImportReview` never writes; it is the read-only half that the import
 * UI presents before `importPlan` commits.
 */

import type { GainContract } from "../contract/schema";
import type { ContractDiff } from "../diff/diff";
import { diffContracts } from "../diff/diff";
import type { ParsedPlan } from "../parse/parser";
import type { ImportCounts } from "./import-plan";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "./read";
import type { UserDb } from "./user-db";

export type ImportReview =
  | {
      kind: "first_import";
      plan_slug: string;
      plan_name: string;
      version_no: number;
      counts: ImportCounts;
    }
  | {
      kind: "revision";
      plan_slug: string;
      plan_id: string;
      previous_version: number;
      new_version: number;
      diff: ContractDiff;
    };

/**
 * Decide what the user should see before committing this import.
 *
 * Note the deliberate absence of a version guard here: the guard belongs to
 * `importPlan`, and the review of an old version is still informative.
 */
export function prepareImportReview(userDb: UserDb, parsed: ParsedPlan): ImportReview {
  const contract = parsed.contract;
  const plan = getPlanBySlug(userDb, contract.plan.slug);

  if (!plan) {
    return firstImportReview(contract);
  }

  const current = getCurrentVersion(userDb, plan.id);
  if (!current) {
    // A plan row with no version cannot happen through importPlan. Treat the
    // incoming document as a first import rather than fail on corrupt state.
    return firstImportReview(contract);
  }

  return {
    kind: "revision",
    plan_slug: contract.plan.slug,
    plan_id: plan.id,
    previous_version: current.version_no,
    new_version: contract.plan.version,
    diff: diffContracts(contractOfVersion(current), contract),
  };
}

function firstImportReview(contract: GainContract): ImportReview {
  let blocks = 0;
  let prescriptions = 0;
  for (const session of contract.sessions) {
    blocks += session.blocks.length;
    for (const block of session.blocks) prescriptions += block.exercises.length;
  }
  const metrics = contract.metrics
    ? (contract.metrics.set?.length ?? 0) +
      (contract.metrics.exercise?.length ?? 0) +
      (contract.metrics.session?.length ?? 0)
    : 0;

  return {
    kind: "first_import",
    plan_slug: contract.plan.slug,
    plan_name: contract.plan.name,
    version_no: contract.plan.version,
    counts: {
      sessions: contract.sessions.length,
      blocks,
      exercises: contract.exercises.length,
      prescriptions,
      loads: contract.loads.length,
      metrics,
    },
  };
}
