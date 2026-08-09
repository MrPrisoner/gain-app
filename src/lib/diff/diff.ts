/**
 * The diff engine: two contract versions in, a structured diff out.
 *
 * Pure data, no UI (ARCHITECTURE §8, §12). The import pipeline shows this to the
 * user at revision time; the golden test only needs that it exists and is pure.
 *
 * Slugs are load-bearing and their failure mode is silent, so rename detection is
 * first-class: any slug removed from the catalogue is compared against every added
 * slug, and near-matches are surfaced as possible renames (CONTRACT §7 warnings).
 */

import type {
  Block,
  ExerciseDef,
  GainContract,
  IntOrRange,
  LoadConfig,
  MetricDef,
  MetricScope,
  Prescription,
} from "../contract/schema";
import { deriveExerciseName } from "../contract/schema";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Structural equality that ignores object-key order (array order still matters). */
export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i, ...new Array<number>(n)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = curr;
  }
  return prev[n] ?? 0;
}

/** `Goblet-Squat` / `goblet_squat` / `db-goblet-squat` → comparable core. */
function normalizeSlug(slug: string): string {
  return slug.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Diff types
// ---------------------------------------------------------------------------

export type FieldChange = { field: string; from: unknown; to: unknown };

export type RenameCandidate = { from: string; to: string; reason: string };

export type PrescriptionDiff = {
  session: string;
  block: string;
  id: string;
  status: "added" | "removed" | "changed";
  /** Empty unless `status` is `changed`. */
  changes: FieldChange[];
};

export type ContractDiff = {
  before: { slug: string; version: number };
  after: { slug: string; version: number };
  /** Problems that block an import (CONTRACT §7): version not incremented, slug changed. */
  blocking: string[];
  /** Non-blocking warnings (CONTRACT §7): possible renames, orphaned history, ... */
  warnings: string[];
  plan: {
    slug_changed: boolean;
    version_incremented: boolean;
    name: FieldChange | null;
    changelog: readonly string[];
  };
  loads: {
    added: LoadConfig[];
    removed: LoadConfig[];
    changed: Array<{ ref: string; changes: FieldChange[] }>;
  };
  exercises: {
    added: ExerciseDef[];
    removed: ExerciseDef[];
    changed: Array<{ id: string; changes: FieldChange[] }>;
    possible_renames: RenameCandidate[];
    /** Catalogue entries referenced by no prescription and no substitutes list. */
    unreferenced: string[];
  };
  sessions: {
    added: string[];
    removed: string[];
    changed: Array<{ key: string; changes: FieldChange[] }>;
    blocks: Array<{
      session: string;
      added: string[];
      removed: string[];
      changed: Array<{ key: string; changes: FieldChange[] }>;
    }>;
  };
  prescriptions: PrescriptionDiff[];
  metrics: {
    added: Array<{ scope: MetricScope; def: MetricDef }>;
    removed: Array<{ scope: MetricScope; def: MetricDef }>;
    changed: Array<{ scope: MetricScope; key: string; changes: FieldChange[] }>;
  };
  scheduling_changed: boolean;
  progression_changed: boolean;
  safety_changed: boolean;
};

// ---------------------------------------------------------------------------
// Field-level comparison
// ---------------------------------------------------------------------------

function fieldChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of fields) {
    const from = before[field];
    const to = after[field];
    if (!deepEqual(from, to)) {
      changes.push({ field, from: from ?? null, to: to ?? null });
    }
  }
  return changes;
}

/** Bare integers and `[n, n]` ranges mean the same thing; compare semantically. */
function normRange(value: IntOrRange | undefined): [number, number] | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? [value, value] : [value[0], value[1]];
}

function prescriptionChanges(before: Prescription, after: Prescription): FieldChange[] {
  const changes: FieldChange[] = [];

  // sets defaults to 1.
  const setsBefore = normRange(before.sets) ?? [1, 1];
  const setsAfter = normRange(after.sets) ?? [1, 1];
  if (!deepEqual(setsBefore, setsAfter)) {
    changes.push({ field: "sets", from: before.sets ?? null, to: after.sets ?? null });
  }

  for (const field of ["reps", "duration_sec", "rest_sec"] as const) {
    const from = normRange(before[field]);
    const to = normRange(after[field]);
    if (!deepEqual(from, to)) {
      changes.push({ field, from: before[field] ?? null, to: after[field] ?? null });
    }
  }

  for (const field of ["load", "note", "conditional", "condition", "substitutes"] as const) {
    const from = before[field];
    const to = after[field];
    if (!deepEqual(from, to)) {
      changes.push({ field, from: from ?? null, to: to ?? null });
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Rename detection
// ---------------------------------------------------------------------------

function findRenameCandidates(removed: ExerciseDef[], added: ExerciseDef[]): RenameCandidate[] {
  const candidates: RenameCandidate[] = [];
  for (const r of removed) {
    for (const a of added) {
      const rn = normalizeSlug(r.id);
      const an = normalizeSlug(a.id);

      if (rn === an) {
        candidates.push({
          from: r.id,
          to: a.id,
          reason:
            "identical once punctuation is ignored — history will split unless the original id is restored",
        });
        continue;
      }

      const distance = levenshtein(rn, an);
      if (distance > 0 && distance <= 2) {
        candidates.push({
          from: r.id,
          to: a.id,
          reason: `very similar slugs (edit distance ${distance} after normalization)`,
        });
        continue;
      }

      const rName = r.name ?? deriveExerciseName(r.id);
      const aName = a.name ?? deriveExerciseName(a.id);
      if (rName === aName) {
        candidates.push({ from: r.id, to: a.id, reason: "same display name" });
      }
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// The diff
// ---------------------------------------------------------------------------

export function diffContracts(before: GainContract, after: GainContract): ContractDiff {
  const blocking: string[] = [];
  const warnings: string[] = [];

  // -- plan identity and versioning (CONTRACT §5 rules 5–7, §7 validation).
  const slugChanged = before.plan.slug !== after.plan.slug;
  const versionIncremented = after.plan.version > before.plan.version;
  if (slugChanged) {
    blocking.push(
      `plan.slug changed from \`${before.plan.slug}\` to \`${after.plan.slug}\` — plan.slug never changes, even across a total rewrite (round-trip rule 5)`,
    );
  }
  if (!versionIncremented) {
    blocking.push(
      `version must be greater than the current stored version — before: ${before.plan.version}, after: ${after.plan.version} (increment by exactly one, round-trip rule 6)`,
    );
  }
  if (after.plan.based_on_version !== before.plan.version) {
    warnings.push(
      `based_on_version is ${after.plan.based_on_version ?? "null"} but the version being revised is ${before.plan.version} (round-trip rule 6)`,
    );
  }

  const planNameChange =
    before.plan.name === after.plan.name
      ? null
      : { field: "name", from: before.plan.name, to: after.plan.name };

  // -- loads, keyed by ref.
  const loadsBefore = new Map(before.loads.map((l) => [l.ref, l]));
  const loadsAfter = new Map(after.loads.map((l) => [l.ref, l]));
  const loadsDiff = {
    added: after.loads.filter((l) => !loadsBefore.has(l.ref)),
    removed: before.loads.filter((l) => !loadsAfter.has(l.ref)),
    changed: after.loads
      .filter((l) => {
        const b = loadsBefore.get(l.ref);
        return (
          b !== undefined &&
          fieldChanges(b, l, ["label", "default_kg", "is_bodyweight", "note"]).length > 0
        );
      })
      .map((l) => {
        const b = loadsBefore.get(l.ref);
        return {
          ref: l.ref,
          changes: fieldChanges(b as unknown as Record<string, unknown>, l, [
            "label",
            "default_kg",
            "is_bodyweight",
            "note",
          ]),
        };
      }),
  };

  // -- exercises, keyed by id.
  const exercisesBefore = new Map(before.exercises.map((e) => [e.id, e]));
  const exercisesAfter = new Map(after.exercises.map((e) => [e.id, e]));
  const removedExercises = before.exercises.filter((e) => !exercisesAfter.has(e.id));
  const addedExercises = after.exercises.filter((e) => !exercisesBefore.has(e.id));
  const possibleRenames = findRenameCandidates(removedExercises, addedExercises);

  const exerciseFields = [
    "name",
    "type",
    "per_side",
    "load",
    "rest_sec",
    "note",
    "conditional",
    "condition",
    "substitutes",
  ] as const;

  const changedExercises = after.exercises
    .filter((e) => {
      const b = exercisesBefore.get(e.id);
      return b !== undefined && fieldChanges(b, e, exerciseFields).length > 0;
    })
    .map((e) => {
      const b = exercisesBefore.get(e.id);
      return {
        id: e.id,
        changes: fieldChanges(b as unknown as Record<string, unknown>, e, exerciseFields),
      };
    });

  for (const r of removedExercises) {
    warnings.push(
      `slug \`${r.id}\` from the previous version is absent — possible rename or removal; its history is retained but will split if it was renamed`,
    );
  }
  for (const c of possibleRenames) {
    warnings.push(`possible rename: \`${c.from}\` → \`${c.to}\` (${c.reason})`);
  }

  // Which catalogue entries does the AFTER version reference?
  const referenced = new Set<string>();
  for (const session of after.sessions) {
    for (const block of session.blocks) {
      for (const ex of block.exercises) {
        referenced.add(ex.id);
        ex.substitutes?.forEach((s) => referenced.add(s));
      }
    }
  }
  for (const def of after.exercises) {
    def.substitutes?.forEach((s) => referenced.add(s));
  }
  const unreferenced = after.exercises.map((e) => e.id).filter((id) => !referenced.has(id));
  for (const id of unreferenced) {
    warnings.push(
      `catalogue entry \`${id}\` is referenced by no prescription and no substitutes list`,
    );
  }

  // -- sessions and blocks, keyed by session key / block key.
  const sessionsBefore = new Map(before.sessions.map((s) => [s.key, s]));
  const sessionsAfter = new Map(after.sessions.map((s) => [s.key, s]));

  const sessionFields = ["name", "order", "note"] as const;
  const blockFields = ["name", "type", "rounds", "rest_sec", "tracking", "note"] as const;

  const sessionsDiff: ContractDiff["sessions"] = {
    added: after.sessions.filter((s) => !sessionsBefore.has(s.key)).map((s) => s.key),
    removed: before.sessions.filter((s) => !sessionsAfter.has(s.key)).map((s) => s.key),
    changed: [],
    blocks: [],
  };

  for (const afterSession of after.sessions) {
    const beforeSession = sessionsBefore.get(afterSession.key);
    if (!beforeSession) continue;

    const sChanges = fieldChanges(beforeSession, afterSession, sessionFields);
    if (sChanges.length > 0) {
      sessionsDiff.changed.push({ key: afterSession.key, changes: sChanges });
    }

    const blocksBefore = new Map<string, Block>(beforeSession.blocks.map((b) => [b.key, b]));
    const blocksAfter = new Map<string, Block>(afterSession.blocks.map((b) => [b.key, b]));

    const blockDiff: {
      session: string;
      added: string[];
      removed: string[];
      changed: Array<{ key: string; changes: FieldChange[] }>;
    } = {
      session: afterSession.key,
      added: afterSession.blocks.filter((b) => !blocksBefore.has(b.key)).map((b) => b.key),
      removed: beforeSession.blocks.filter((b) => !blocksAfter.has(b.key)).map((b) => b.key),
      changed: [],
    };

    for (const afterBlock of afterSession.blocks) {
      const beforeBlock = blocksBefore.get(afterBlock.key);
      if (!beforeBlock) continue;
      const bChanges = fieldChanges(beforeBlock, afterBlock, blockFields);
      if (bChanges.length > 0) {
        blockDiff.changed.push({ key: afterBlock.key, changes: bChanges });
      }
    }

    if (blockDiff.added.length + blockDiff.removed.length + blockDiff.changed.length > 0) {
      sessionsDiff.blocks.push(blockDiff);
    }
  }

  // -- prescriptions: targets, matched by (session, block, id).
  const prescriptions: PrescriptionDiff[] = [];

  const diffBlockPrescriptions = (
    sessionKey: string,
    blockKey: string,
    beforeList: Prescription[],
    afterList: Prescription[],
  ): void => {
    const ids = new Set([...beforeList.map((p) => p.id), ...afterList.map((p) => p.id)]);
    for (const id of ids) {
      const bs = beforeList.filter((p) => p.id === id);
      const as = afterList.filter((p) => p.id === id);
      const pairs = Math.min(bs.length, as.length);
      for (let i = 0; i < pairs; i++) {
        const b = bs[i];
        const a = as[i];
        if (!b || !a) continue;
        const changes = prescriptionChanges(b, a);
        if (changes.length > 0) {
          prescriptions.push({
            session: sessionKey,
            block: blockKey,
            id,
            status: "changed",
            changes,
          });
        }
      }
      for (let i = pairs; i < as.length; i++) {
        prescriptions.push({
          session: sessionKey,
          block: blockKey,
          id,
          status: "added",
          changes: [],
        });
      }
      for (let i = pairs; i < bs.length; i++) {
        prescriptions.push({
          session: sessionKey,
          block: blockKey,
          id,
          status: "removed",
          changes: [],
        });
      }
    }
  };

  // Every block on either side is diffed, including blocks (and whole sessions)
  // that exist on only one. A block present on one side alone is diffed against an
  // empty list, so its prescriptions enumerate as added or removed — the revisions
  // that restructure sessions are exactly the ones the user most needs itemised,
  // and a block-level "added" line alone does not say what landed inside it.
  for (const afterSession of after.sessions) {
    const beforeSession = sessionsBefore.get(afterSession.key);
    const beforeBlocks = new Map((beforeSession?.blocks ?? []).map((b) => [b.key, b]));
    for (const afterBlock of afterSession.blocks) {
      diffBlockPrescriptions(
        afterSession.key,
        afterBlock.key,
        beforeBlocks.get(afterBlock.key)?.exercises ?? [],
        afterBlock.exercises,
      );
    }
  }

  for (const beforeSession of before.sessions) {
    const afterSession = sessionsAfter.get(beforeSession.key);
    const afterBlocks = new Map((afterSession?.blocks ?? []).map((b) => [b.key, b]));
    for (const beforeBlock of beforeSession.blocks) {
      // Blocks on both sides were handled above; only the removed ones remain.
      if (afterBlocks.has(beforeBlock.key)) continue;
      diffBlockPrescriptions(beforeSession.key, beforeBlock.key, beforeBlock.exercises, []);
    }
  }

  // -- metrics, per scope, keyed by key.
  const metricsDiff: ContractDiff["metrics"] = { added: [], removed: [], changed: [] };
  const metricFields = [
    "label",
    "type",
    "min",
    "max",
    "options",
    "optional",
    "prompt_when",
  ] as const;

  for (const scope of ["set", "exercise", "session"] as const) {
    const beforeDefs = new Map((before.metrics?.[scope] ?? []).map((m) => [m.key, m]));
    const afterDefs = new Map((after.metrics?.[scope] ?? []).map((m) => [m.key, m]));

    for (const def of afterDefs.values()) {
      if (!beforeDefs.has(def.key)) metricsDiff.added.push({ scope, def });
    }
    for (const def of beforeDefs.values()) {
      if (!afterDefs.has(def.key)) {
        metricsDiff.removed.push({ scope, def });
        warnings.push(
          `metric key \`${def.key}\` (${scope} scope) has disappeared — its history is orphaned`,
        );
      }
    }
    for (const def of afterDefs.values()) {
      const b = beforeDefs.get(def.key);
      if (!b) continue;
      const changes = fieldChanges(b, def, metricFields);
      if (changes.length > 0) metricsDiff.changed.push({ scope, key: def.key, changes });
    }
  }

  return {
    before: { slug: before.plan.slug, version: before.plan.version },
    after: { slug: after.plan.slug, version: after.plan.version },
    blocking,
    warnings,
    plan: {
      slug_changed: slugChanged,
      version_incremented: versionIncremented,
      name: planNameChange,
      changelog: after.plan.changelog ?? [],
    },
    loads: loadsDiff,
    exercises: {
      added: addedExercises,
      removed: removedExercises,
      changed: changedExercises,
      possible_renames: possibleRenames,
      unreferenced,
    },
    sessions: sessionsDiff,
    prescriptions,
    metrics: metricsDiff,
    scheduling_changed: !deepEqual(before.scheduling ?? null, after.scheduling ?? null),
    progression_changed: !deepEqual(before.progression ?? null, after.progression ?? null),
    safety_changed: !deepEqual(before.safety ?? null, after.safety ?? null),
  };
}

/** Convenience for tests and summaries: the number of prescription target changes. */
export function countChangedTargets(diff: ContractDiff): number {
  return diff.prescriptions.filter((p) => p.status === "changed").length;
}
