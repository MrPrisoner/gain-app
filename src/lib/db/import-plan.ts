/**
 * The import writer (ARCHITECTURE §8): a validated plan document becomes an
 * immutable `plan_version` plus the structured rows that drive the app.
 *
 * - The verbatim `source_md` goes to disk at `plans/<plan.slug>/v<N>.md` and is
 *   never modified afterwards; the DB stores the relative path (§3, §11).
 * - The contract is stored as `contract_json` — the faithful serialization of the
 *   validated contract — and the structured tables are derived from it.
 * - `exercise_def` identity is stable across versions: known slugs keep their id,
 *   new slugs get one. Charts join on `exercise_def_id` (§5).
 * - Everything happens in one transaction. The version guard (CONTRACT §7:
 *   `version` must be greater than the current stored version) is checked first.
 */

import fs from "node:fs";
import path from "node:path";
// Type-only: `Database.Statement`. Constructing a database is confined to the three
// files the `no-restricted-imports` rule in eslint.config.js allows a value import in.
import type Database from "better-sqlite3";
import type {
  ExerciseDef,
  GainContract,
  IntOrRange,
  LoadConfig,
  MetricDef,
  MetricScope,
  Prescription,
} from "../contract/schema";
import { deriveExerciseName } from "../contract/schema";
import type { ParsedPlan } from "../parse/parser";
import { newId } from "./ulid";
import type { UserDb } from "./user-db";

export type ImportCounts = {
  sessions: number;
  blocks: number;
  exercises: number;
  prescriptions: number;
  loads: number;
  metrics: number;
};

export type ImportPlanSuccess = {
  ok: true;
  plan_id: string;
  plan_version_id: string;
  plan_slug: string;
  version_no: number;
  /** True when this plan slug had no previous version in this database. */
  first_import: boolean;
  /** Absolute path of the verbatim source document on disk. */
  source_path: string;
  counts: ImportCounts;
};

export type ImportPlanFailure =
  | {
      ok: false;
      kind: "version_not_newer";
      message: string;
      current_version: number;
      incoming_version: number;
    }
  | {
      ok: false;
      kind: "invalid_rename";
      message: string;
      from: string;
      to: string;
    };

export type ImportPlanResult = ImportPlanSuccess | ImportPlanFailure;

/** One accepted rename from the import review: the stored slug, and what it becomes. */
export type ExerciseRename = { from: string; to: string };

export type ImportPlanInput = {
  /** A successfully parsed plan document (`parsePlanDocument` returned ok). */
  parsed: ParsedPlan;
  /** Injected clock — the deterministic-core rule. */
  now: Date;
  /**
   * Renames accepted at the import review. Each maps a slug that exists in this
   * database onto a slug the incoming document declares, so the existing
   * exercise_def carries its history forward instead of a second one being minted.
   */
  renames?: readonly ExerciseRename[];
};

/** Relative to the user directory; matches the §3 layout. */
export function sourceRelPath(planSlug: string, versionNo: number): string {
  return path.join("plans", planSlug, `v${versionNo}.md`);
}

/**
 * Validate the accepted renames against both sides before anything is written.
 *
 * Returns the failure to report, or `undefined` when every mapping is coherent.
 * Every check is a way for the review's choices to have gone stale between the
 * review and the commit — the document is re-parsed in between, so a mapping can
 * legitimately no longer make sense by the time it arrives here.
 */
function validateRenames(
  db: UserDb["db"],
  planId: string,
  contract: GainContract,
  renames: readonly ExerciseRename[],
): ImportPlanFailure | undefined {
  const incoming = new Set(contract.exercises.map((e) => e.id));
  const seenFrom = new Set<string>();
  const seenTo = new Set<string>();
  const exists = db.prepare("SELECT 1 FROM exercise_def WHERE plan_id = ? AND slug = ?");

  for (const { from, to } of renames) {
    const bad = (message: string): ImportPlanFailure => ({
      ok: false,
      kind: "invalid_rename",
      message,
      from,
      to,
    });

    if (from === to) return bad(`rename \`${from}\` to \`${to}\` maps a slug onto itself`);
    if (seenFrom.has(from)) return bad(`\`${from}\` is mapped more than once`);
    if (seenTo.has(to)) return bad(`two exercises are both mapped onto \`${to}\``);
    seenFrom.add(from);
    seenTo.add(to);

    if (!exists.get(planId, from)) {
      return bad(`\`${from}\` is not an exercise in this plan, so there is no history to carry`);
    }
    if (incoming.has(from)) {
      return bad(
        `\`${from}\` is still declared in the incoming plan, so it was not renamed — remove the mapping or ask the AI to drop the slug`,
      );
    }
    if (!incoming.has(to)) {
      return bad(
        `the incoming plan does not declare \`${to}\`, so there is nothing to rename onto`,
      );
    }
    if (exists.get(planId, to)) {
      return bad(
        `\`${to}\` already has its own history in this plan and cannot absorb another movement's`,
      );
    }
  }

  return undefined;
}

/**
 * Rewrite one exercise_def's slug, and the one denormalised copy of it.
 *
 * `deviation.substitute_exercise_slug` is the only slug in the schema stored as
 * loose text rather than reached through `exercise_def_id`, so it is the only
 * column that goes stale on its own. The join through `plan_version` is not
 * decoration: `workout` keys on `plan_version_id`, and without it a rename in one
 * plan would rewrite an identically-named slug's deviations in another.
 */
function applyRenames(db: UserDb["db"], planId: string, renames: readonly ExerciseRename[]): void {
  const renameDef = db.prepare("UPDATE exercise_def SET slug = ? WHERE plan_id = ? AND slug = ?");
  const renameSubstitute = db.prepare(
    `UPDATE deviation SET substitute_exercise_slug = ?
      WHERE substitute_exercise_slug = ?
        AND workout_id IN (SELECT w.id FROM workout w
                             JOIN plan_version pv ON pv.id = w.plan_version_id
                            WHERE pv.plan_id = ?)`,
  );

  for (const { from, to } of renames) {
    renameDef.run(to, planId, from);
    renameSubstitute.run(to, from, planId);
  }
}

/**
 * Write a parsed plan into the user's database and file tree.
 *
 * All-or-nothing, across both stores. SQLite can roll itself back but cannot
 * un-write a file, so the document is staged next to its destination and renamed
 * into place only once the transaction has committed; if the transaction throws,
 * the staged file is removed and the file tree is exactly as it was. `rename` is
 * atomic within a directory, so no reader ever sees a half-written document.
 *
 * The transaction is IMMEDIATE: the version guard reads `MAX(version_no)` and the
 * insert depends on it, and a deferred transaction would let two concurrent
 * imports both pass the guard before either wrote.
 */
export function importPlan(userDb: UserDb, input: ImportPlanInput): ImportPlanResult {
  const { db } = userDb;
  const contract = input.parsed.contract;
  const { plan } = contract;
  const nowIso = input.now.toISOString();

  // -- Resolve or create the plan row.
  const existingPlan = db
    .prepare("SELECT id, slug, name FROM plan WHERE slug = ?")
    .get(plan.slug) as { id: string; slug: string; name: string } | undefined;

  const planId = existingPlan?.id ?? newId();

  // -- Version guard (CONTRACT §7).
  if (existingPlan) {
    const row = db
      .prepare("SELECT MAX(version_no) AS v FROM plan_version WHERE plan_id = ?")
      .get(planId) as { v: number | null };
    const currentVersion = row.v ?? 0;
    if (plan.version <= currentVersion) {
      return {
        ok: false,
        kind: "version_not_newer",
        message: `incoming version ${plan.version} is not greater than the stored version ${currentVersion} of plan \`${plan.slug}\` — a revision must increment \`version\` (CONTRACT §5 rule 6)`,
        current_version: currentVersion,
        incoming_version: plan.version,
      };
    }
  }

  const renames = input.renames ?? [];
  if (existingPlan && renames.length > 0) {
    const invalid = validateRenames(db, planId, contract, renames);
    if (invalid) return invalid;
  }

  const planVersionId = newId();
  const relPath = sourceRelPath(plan.slug, plan.version);
  const absPath = path.join(userDb.userDir, relPath);

  const counts = countRows(contract);

  // -- Verbatim source staged beside its destination, byte-for-byte.
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const stagedPath = `${absPath}.${newId()}.staged`;
  fs.writeFileSync(stagedPath, input.parsed.source_md, "utf8");

  try {
    db.transaction(() => {
      // -- Plan row.
      if (existingPlan) {
        db.prepare("UPDATE plan SET name = ? WHERE id = ?").run(plan.name, planId);
      } else {
        db.prepare("INSERT INTO plan (id, slug, name, created_at) VALUES (?, ?, ?, ?)").run(
          planId,
          plan.slug,
          plan.name,
          nowIso,
        );
      }

      // -- Flip is_current, then insert the new version.
      db.prepare("UPDATE plan_version SET is_current = 0 WHERE plan_id = ?").run(planId);
      db.prepare(
        `INSERT INTO plan_version (
           id, plan_id, version_no, based_on_version, source_path, context_md,
           contract_json, changelog_json, block_length_weeks, session_target_min,
           scheduling_json, progression_json, safety_json, imported_at, is_current
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ).run(
        planVersionId,
        planId,
        plan.version,
        plan.based_on_version,
        relPath,
        input.parsed.context_md,
        JSON.stringify(contract),
        plan.changelog ? JSON.stringify(plan.changelog) : null,
        plan.block_length_weeks ?? null,
        plan.session_target_min ?? null,
        contract.scheduling ? JSON.stringify(contract.scheduling) : null,
        contract.progression ? JSON.stringify(contract.progression) : null,
        contract.safety ? JSON.stringify(contract.safety) : null,
        nowIso,
      );

      // Renames run before the upsert. After it, a fresh exercise_def has already
      // been minted for the new slug and the history is already split, so a rename
      // applied afterwards would only be repairing damage this transaction caused.
      if (renames.length > 0) applyRenames(db, planId, renames);

      // -- Catalogue identity: stable exercise_defs, then per-version properties.
      const defIdBySlug = upsertExerciseDefs(db, planId, plan.version, contract.exercises);
      insertVersionExercises(db, planVersionId, defIdBySlug, contract.exercises);

      // -- Sessions → blocks → prescriptions.
      insertSessions(db, planVersionId, defIdBySlug, contract);

      // -- Loads and metrics.
      insertLoads(db, planVersionId, contract.loads);
      insertMetrics(db, planVersionId, contract);
    }).immediate();

    // The database has committed; the document can now become visible.
    fs.renameSync(stagedPath, absPath);
  } catch (err) {
    fs.rmSync(stagedPath, { force: true });
    throw err;
  }

  return {
    ok: true,
    plan_id: planId,
    plan_version_id: planVersionId,
    plan_slug: plan.slug,
    version_no: plan.version,
    first_import: !existingPlan,
    source_path: absPath,
    counts,
  };
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

function upsertExerciseDefs(
  db: UserDb["db"],
  planId: string,
  versionNo: number,
  exercises: readonly ExerciseDef[],
): Map<string, string> {
  const select = db.prepare("SELECT id FROM exercise_def WHERE plan_id = ? AND slug = ?");
  const insert = db.prepare(
    `INSERT INTO exercise_def (id, plan_id, slug, name, first_seen_version, last_seen_version)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const update = db.prepare("UPDATE exercise_def SET name = ?, last_seen_version = ? WHERE id = ?");

  const defIdBySlug = new Map<string, string>();

  for (const exercise of exercises) {
    const displayName = exercise.name ?? deriveExerciseName(exercise.id);
    const existing = select.get(planId, exercise.id) as { id: string } | undefined;

    if (existing) {
      update.run(displayName, versionNo, existing.id);
      defIdBySlug.set(exercise.id, existing.id);
    } else {
      const id = newId();
      insert.run(id, planId, exercise.id, displayName, versionNo, versionNo);
      defIdBySlug.set(exercise.id, id);
    }
  }

  return defIdBySlug;
}

function insertVersionExercises(
  db: UserDb["db"],
  planVersionId: string,
  defIdBySlug: Map<string, string>,
  exercises: readonly ExerciseDef[],
): void {
  const insert = db.prepare(
    `INSERT INTO version_exercise (
       plan_version_id, exercise_def_id, name, type, per_side, load_ref,
       rest_min_s, rest_max_s, note, conditional, condition_text, substitutes_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const exercise of exercises) {
    const defId = defIdBySlug.get(exercise.id);
    if (!defId) throw new Error(`unreachable: no exercise_def id for slug ${exercise.id}`);

    const rest = rangeParts(exercise.rest_sec);
    insert.run(
      planVersionId,
      defId,
      exercise.name ?? null,
      exercise.type ?? "reps",
      exercise.per_side ? 1 : 0,
      exercise.load ?? null,
      rest.min,
      rest.max,
      exercise.note ?? null,
      exercise.conditional ? 1 : 0,
      exercise.condition ?? null,
      exercise.substitutes ? JSON.stringify(exercise.substitutes) : null,
    );
  }
}

function insertSessions(
  db: UserDb["db"],
  planVersionId: string,
  defIdBySlug: ReadonlyMap<string, string>,
  contract: GainContract,
): void {
  const insertSession = db.prepare(
    `INSERT INTO version_session (plan_version_id, key, name, order_no, note)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertBlock = db.prepare(
    `INSERT INTO version_block (
       plan_version_id, session_key, key, name, type, rounds,
       rest_min_s, rest_max_s, tracking, note, order_no
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPrescription = db.prepare(
    `INSERT INTO prescription (
       id, plan_version_id, session_key, block_key, exercise_def_id, order_no,
       sets_min, sets_max, reps_min, reps_max, duration_min_s, duration_max_s,
       load_ref, rest_min_s, rest_max_s, note,
       conditional, condition_text, substitutes_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const session of contract.sessions) {
    insertSession.run(
      planVersionId,
      session.key,
      session.name,
      session.order,
      session.note ?? null,
    );

    session.blocks.forEach((block, blockIndex) => {
      const rest = rangeParts(block.rest_sec);
      insertBlock.run(
        planVersionId,
        session.key,
        block.key,
        block.name,
        block.type ?? "sequence",
        block.rounds ?? null,
        rest.min,
        rest.max,
        block.tracking ?? "full",
        block.note ?? null,
        blockIndex + 1,
      );

      block.exercises.forEach((prescription: Prescription, prescriptionIndex: number) => {
        const defId = defIdBySlug.get(prescription.id);
        if (!defId) {
          throw new Error(`unreachable: prescription references unknown slug ${prescription.id}`);
        }

        const sets = rangeParts(prescription.sets);
        const reps = rangeParts(prescription.reps);
        const duration = rangeParts(prescription.duration_sec);
        const prescriptionRest = rangeParts(prescription.rest_sec);

        insertPrescription.run(
          newId(),
          planVersionId,
          session.key,
          block.key,
          defId,
          prescriptionIndex + 1,
          sets.min,
          sets.max,
          reps.min,
          reps.max,
          duration.min,
          duration.max,
          prescription.load ?? null,
          prescriptionRest.min,
          prescriptionRest.max,
          prescription.note ?? null,
          prescription.conditional === undefined ? null : prescription.conditional ? 1 : 0,
          prescription.condition ?? null,
          prescription.substitutes ? JSON.stringify(prescription.substitutes) : null,
        );
      });
    });
  }
}

function insertLoads(db: UserDb["db"], planVersionId: string, loads: readonly LoadConfig[]): void {
  const insert = db.prepare(
    `INSERT INTO load_config (plan_version_id, ref, label, default_kg, is_bodyweight, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const load of loads) {
    insert.run(
      planVersionId,
      load.ref,
      load.label,
      load.default_kg ?? null,
      load.is_bodyweight ? 1 : 0,
      load.note ?? null,
    );
  }
}

function insertMetrics(db: UserDb["db"], planVersionId: string, contract: GainContract): void {
  if (!contract.metrics) return;

  const insert = db.prepare(
    `INSERT INTO metric_def (
       plan_version_id, scope, key, label, type, min, max, options_json, prompt_when, optional
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const scope of ["set", "exercise", "session"] as const satisfies readonly MetricScope[]) {
    const list = contract.metrics[scope];
    if (!list) continue;
    for (const metric of list) {
      insertMetric(insert, planVersionId, scope, metric);
    }
  }
}

function insertMetric(
  insert: Database.Statement,
  planVersionId: string,
  scope: MetricScope,
  metric: MetricDef,
): void {
  insert.run(
    planVersionId,
    scope,
    metric.key,
    metric.label,
    metric.type,
    metric.min ?? null,
    metric.max ?? null,
    metric.options ? JSON.stringify(metric.options) : null,
    metric.prompt_when ?? null,
    metric.optional ? 1 : 0,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rangeParts(value: IntOrRange | undefined): { min: number | null; max: number | null } {
  if (value === undefined) return { min: null, max: null };
  if (typeof value === "number") return { min: value, max: value };
  return { min: value[0], max: value[1] };
}

function countRows(contract: GainContract): ImportCounts {
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
    sessions: contract.sessions.length,
    blocks,
    exercises: contract.exercises.length,
    prescriptions,
    loads: contract.loads.length,
    metrics,
  };
}
