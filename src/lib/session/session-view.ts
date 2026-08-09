/**
 * A session's blocks and exercises, resolved from the stored contract with every
 * prescription-level override applied over its catalogue default (CONTRACT: catalogue
 * declares defaults, a prescription's own fields override them for that occurrence
 * only). Pure — everything here operates on a `GainContract` already in memory
 * (`contractOfVersion`), no I/O.
 */

import { deriveExerciseName } from "../contract/schema";
import type {
  Block,
  ExerciseDef,
  GainContract,
  IntOrRange,
  LoadConfig,
  MetricDef,
  Prescription,
} from "../contract/schema";

export type ResolvedExercise = {
  slug: string;
  name: string;
  type: "reps" | "time";
  perSide: boolean;
  loadRef: string | undefined;
  restSec: IntOrRange | undefined;
  conditional: boolean;
  condition: string | undefined;
  substitutes: string[];
  sets: IntOrRange;
  reps: IntOrRange | undefined;
  durationSec: IntOrRange | undefined;
  note: string | undefined;
};

export type ResolvedBlock = {
  key: string;
  name: string;
  type: "sequence" | "rounds";
  rounds: number | undefined;
  /** Rounds blocks only: rest BETWEEN rounds. */
  restSec: IntOrRange | undefined;
  tracking: "full" | "checkoff";
  note: string | undefined;
  exercises: ResolvedExercise[];
};

export type ResolvedSession = {
  key: string;
  name: string;
  order: number;
  note: string | undefined;
  blocks: ResolvedBlock[];
};

export function resolveSession(
  contract: GainContract,
  sessionKey: string,
): ResolvedSession | undefined {
  const session = contract.sessions.find((s) => s.key === sessionKey);
  if (!session) return undefined;

  const catalogue = new Map(contract.exercises.map((e) => [e.id, e]));

  return {
    key: session.key,
    name: session.name,
    order: session.order,
    note: session.note,
    blocks: session.blocks.map((block) => resolveBlock(block, catalogue)),
  };
}

function resolveBlock(block: Block, catalogue: ReadonlyMap<string, ExerciseDef>): ResolvedBlock {
  return {
    key: block.key,
    name: block.name,
    type: block.type ?? "sequence",
    rounds: block.rounds,
    restSec: block.rest_sec,
    tracking: block.tracking ?? "full",
    note: block.note,
    exercises: block.exercises.map((rx) => resolveExercise(rx, catalogue)),
  };
}

function resolveExercise(
  rx: Prescription,
  catalogue: ReadonlyMap<string, ExerciseDef>,
): ResolvedExercise {
  const def = catalogue.get(rx.id);
  if (!def) {
    throw new Error(
      `resolveSession: \`${rx.id}\` is not in the exercise catalogue — the contract validator should already have rejected this document`,
    );
  }

  return {
    slug: rx.id,
    name: def.name ?? deriveExerciseName(rx.id),
    type: def.type ?? "reps",
    perSide: def.per_side === true,
    loadRef: rx.load ?? def.load,
    restSec: rx.rest_sec ?? def.rest_sec,
    conditional: rx.conditional ?? def.conditional ?? false,
    condition: rx.condition ?? def.condition,
    substitutes: rx.substitutes ?? def.substitutes ?? [],
    sets: rx.sets ?? 1,
    reps: rx.reps,
    durationSec: rx.duration_sec,
    note: rx.note ?? def.note,
  };
}

export function resolveLoad(
  contract: GainContract,
  ref: string | undefined,
): LoadConfig | undefined {
  if (ref === undefined) return undefined;
  return contract.loads.find((l) => l.ref === ref);
}

export function sessionMetrics(
  contract: GainContract,
  promptWhen?: "start" | "end" | "next_morning",
): MetricDef[] {
  const list = contract.metrics?.session ?? [];
  return promptWhen === undefined ? list : list.filter((m) => m.prompt_when === promptWhen);
}

export function setMetrics(contract: GainContract): MetricDef[] {
  return contract.metrics?.set ?? [];
}

export function exerciseMetrics(contract: GainContract): MetricDef[] {
  return contract.metrics?.exercise ?? [];
}

/**
 * UI-DECISIONS §6: draw the ranged-set minimum only, then offer "Add the optional Nth
 * set" up to the declared max. `addedSets` is how many optional sets the user has
 * already tapped to add this exercise, this workout.
 */
export function visibleSetCount(
  sets: IntOrRange,
  addedSets: number,
): { shown: number; canAddMore: boolean } {
  const [min, max] = typeof sets === "number" ? [sets, sets] : sets;
  const shown = Math.min(min + Math.max(0, addedSets), max);
  return { shown, canAddMore: shown < max };
}

/**
 * UI-DECISIONS §4: rest appears only where the contract declares `rest_sec`, and never
 * between exercises in a checkoff block (no sets logged at all) or a rounds block (rest
 * there is between rounds, handled by `restBetweenRounds`).
 */
export function restForSet(
  block: ResolvedBlock,
  exercise: ResolvedExercise,
): IntOrRange | undefined {
  if (block.tracking === "checkoff") return undefined;
  if (block.type === "rounds") return undefined;
  return exercise.restSec;
}

/**
 * Rest between rounds of a `type: rounds` block — never after the final round, and
 * never in a checkoff block (rounds blocks are never checkoff in practice, but the
 * guard mirrors `restForSet`'s).
 */
export function restBetweenRounds(
  block: ResolvedBlock,
  completedRound: number,
): IntOrRange | undefined {
  if (block.type !== "rounds" || block.tracking === "checkoff") return undefined;
  if (block.rounds !== undefined && completedRound >= block.rounds) return undefined;
  return block.restSec;
}

/**
 * Renders an `IntOrRange` for display: a fixed value as-is, a `[min, max]` pair as
 * `min–max` (en dash, U+2013 — not a hyphen, and never the raw `min,max` you get from
 * interpolating a tuple directly). An optional unit is appended after the number(s),
 * e.g. `formatRange([20, 40], "sec")` → `"20–40 sec"`.
 */
export function formatRange(value: IntOrRange, unit?: string): string {
  const core = typeof value === "number" ? `${value}` : `${value[0]}–${value[1]}`;
  return unit ? `${core} ${unit}` : core;
}

/**
 * The type-appropriate reps/duration value for an exercise — `reps` for type `reps`,
 * `durationSec` for type `time` — formatted with `formatRange` (duration gets a `sec`
 * unit suffix, reps doesn't). CONTRACT (schema.ts:525-553): a type `reps` exercise
 * always has `reps` set and a type `time` exercise always has `durationSec` set — the
 * contract validator rejects any document where that's not true, same precedent as
 * `resolveExercise`'s catalogue-lookup guard above — so this throws rather than
 * silently falling back, on the same "unreachable in practice, fail loud if it ever
 * isn't" basis. Shared by every call site that needs this value, so they can't drift
 * into inconsistent error handling for the same invariant.
 */
export function formatRepsOrDuration(
  exercise: Pick<ResolvedExercise, "type" | "reps" | "durationSec">,
): string {
  const targetValue = exercise.type === "time" ? exercise.durationSec : exercise.reps;
  if (targetValue === undefined) {
    throw new Error(
      `formatRepsOrDuration: a type \`${exercise.type}\` exercise must have its ` +
        `${exercise.type === "time" ? "duration_sec" : "reps"} set — the contract ` +
        `validator should already have rejected this document`,
    );
  }
  return formatRange(targetValue, exercise.type === "time" ? "sec" : undefined);
}

/**
 * The full prescription target line shown wherever an exercise's set/rep (or
 * set/duration) target is displayed — `3 × 8–12`, `2 × 20–40 sec per side`,
 * `2–3 × 10–15`.
 */
export function formatTarget(
  exercise: Pick<ResolvedExercise, "type" | "sets" | "reps" | "durationSec" | "perSide">,
): string {
  const line = `${formatRange(exercise.sets)} × ${formatRepsOrDuration(exercise)}`;
  return exercise.perSide ? `${line} per side` : line;
}
