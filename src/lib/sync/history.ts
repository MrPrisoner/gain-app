/**
 * The outbox, projected into the shape `$lib/session/resume` already consumes
 * (design spec §5).
 *
 * This is the hinge of the offline design. `workoutHistoryFor` reads the server's rows
 * back joined to their slug and ordered by ULID; an op log holds slugs and ULIDs
 * natively. So the local rebuild and the server resume feed *the same* pure
 * reconstruction, and the two can produce the same ledger by construction rather than by
 * two implementations agreeing — the failure mode AGENTS.md warns about wherever the
 * same derivation exists twice.
 *
 * Start and finish ops describe the workout row, not its history, so they project to
 * nothing here. Set-scope metrics reference a `set_log` rather than the workout and are
 * excluded for the same reason `metricValuesFor` excludes them server-side.
 */

import type {
  WorkoutDeviationRow,
  WorkoutHistory,
  WorkoutMetricRow,
  WorkoutSetRow,
} from "../session/resume";
import type { SyncOp } from "./ops";

export function historyFromOps(ops: readonly SyncOp[]): WorkoutHistory {
  const ordered = [...ops].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const sets: WorkoutSetRow[] = [];
  const deviations: WorkoutDeviationRow[] = [];
  const metrics: WorkoutMetricRow[] = [];

  for (const op of ordered) {
    switch (op.kind) {
      case "set":
        sets.push({
          id: op.id,
          exerciseSlug: op.exerciseSlug,
          setNo: op.setNo,
          side: op.side ?? null,
          reps: op.reps ?? null,
          weightKg: op.weightKg ?? null,
          durationS: op.durationS ?? null,
          difficulty: op.difficulty ?? null,
        });
        break;
      case "deviation":
        deviations.push({
          id: op.id,
          exerciseSlug: op.exerciseSlug,
          kind: op.deviationKind,
          substituteSlug: op.substituteExerciseSlug ?? null,
        });
        break;
      case "metric":
        if (op.scope === "set") break;
        metrics.push({
          id: op.id,
          scope: op.scope,
          metricKey: op.metricKey,
          valueNum: op.valueNum ?? null,
          valueText: op.valueText ?? null,
        });
        break;
      case "start":
      case "finish":
        break;
    }
  }

  return { sets, deviations, metrics };
}
