/**
 * "12/11/11 — one session from a load increase" (ROADMAP phase 7). Purely mechanical:
 * ready means the most recent workout carried at least as many sets as the prescription
 * asks for, and every one of them met or exceeded the range's top. Never weighs a metric
 * value (rir, symptoms_during, …) — ARCHITECTURE restricts GAIN to acting automatically
 * on `scheduling.sequence` alone, and a plan's other metric keys are free text with no
 * structural meaning the app can lean on.
 *
 * The set count is load-bearing rather than pedantry: `summary.ts` puts this verdict in
 * the export, where CLAUDE.md's invariant says the reviewing AI trusts it and does not
 * check it, so one strong set out of three prescribed must not read as a session that
 * earned more load.
 */

import type { IntOrRange } from "../contract/schema";
import type { ExerciseSeriesPoint } from "./exercise-series";

export type DoubleProgressionState =
  | { status: "no_data" }
  | { status: "in_progress"; latest: number[] }
  | { status: "ready"; latest: number[] };

export type DoubleProgressionBySide = {
  none?: DoubleProgressionState;
  left?: DoubleProgressionState;
  right?: DoubleProgressionState;
};

function isTrueRange(target: IntOrRange | undefined): target is [number, number] {
  return Array.isArray(target) && target[0] !== target[1];
}

function upperBound(target: [number, number]): number {
  return target[1];
}

/**
 * How many sets have to be at the top of the range before "ready" — the **lower** bound
 * of a ranged prescription. `sets: [2, 3]` (the fixture's session-D goblet squat) means
 * the plan itself sanctions two, so two at the top of the range has earned the load;
 * requiring three would leave a user who reliably does two reading "in progress" forever,
 * which is a silent wrong answer in the opposite direction.
 */
function requiredSetCount(prescribedSets: IntOrRange): number {
  return Array.isArray(prescribedSets) ? Math.min(...prescribedSets) : prescribedSets;
}

function valueOf(
  set: { reps?: number; duration_s?: number },
  type: "reps" | "time",
): number | undefined {
  return type === "time" ? set.duration_s : set.reps;
}

function stateForSide(
  series: readonly ExerciseSeriesPoint[],
  side: "left" | "right" | undefined,
  target: [number, number],
  required: number,
  type: "reps" | "time",
): DoubleProgressionState {
  const top = upperBound(target);
  for (let i = series.length - 1; i >= 0; i--) {
    const point = series[i];
    if (!point) continue;
    const sets = point.sets.filter((s) => (s.side ?? undefined) === side);
    if (sets.length === 0) continue;
    const values = sets.map((s) => valueOf(s, type)).filter((v): v is number => v !== undefined);
    if (values.length === 0) continue;
    // An added set counts in the user's favour (>=, not ===); a missing one does not.
    const ready =
      values.length === sets.length && values.length >= required && values.every((v) => v >= top);
    return { status: ready ? "ready" : "in_progress", latest: values };
  }
  return { status: "no_data" };
}

/** `undefined` when the resolved target isn't a genuine range — a scalar prescription
 * (e.g. `reps: 16`) has nothing to progress through. */
export function doubleProgressionState(
  series: readonly ExerciseSeriesPoint[],
  target: IntOrRange | undefined,
  prescribedSets: IntOrRange,
  type: "reps" | "time",
  perSide: boolean,
): DoubleProgressionBySide | undefined {
  if (!isTrueRange(target)) return undefined;
  const required = requiredSetCount(prescribedSets);
  return perSide
    ? {
        left: stateForSide(series, "left", target, required, type),
        right: stateForSide(series, "right", target, required, type),
      }
    : { none: stateForSide(series, undefined, target, required, type) };
}

export function formatDoubleProgressionState(state: DoubleProgressionState): string {
  if (state.status === "no_data") return "No history yet";
  const values = state.latest.join("/");
  return state.status === "ready"
    ? `${values} — ready for a load increase`
    : `${values} — in progress`;
}

/**
 * One line for a whole `DoubleProgressionBySide`. Shared by the export table and the
 * app's exercises list so the same state is never described two different ways in two
 * places the user compares side by side. `noRange` is what a scalar prescription renders
 * as — a dash in a Markdown table, a sentence in a list row.
 */
export function formatReadiness(
  state: DoubleProgressionBySide | undefined,
  noRange: string,
): string {
  if (state === undefined) return noRange;
  if (state.none) return formatDoubleProgressionState(state.none);
  const left = formatDoubleProgressionState(state.left ?? { status: "no_data" });
  const right = formatDoubleProgressionState(state.right ?? { status: "no_data" });
  return `L: ${left} · R: ${right}`;
}
