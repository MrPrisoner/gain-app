/**
 * Section 2 of the export: a pre-computed progress summary (ARCHITECTURE §11).
 *
 * The reviewing AI must not do arithmetic it can get wrong — it should read
 * "goblet squat: 6 kg, 12/12/12" rather than derive it from 400 CSV rows.
 * Everything here is computed from the windowed logs by pure functions.
 */

import type { GainContract, MetricDef, MetricScope } from "../contract/schema";
import { deriveExerciseName } from "../contract/schema";
import type { Logs, MetricValue, SetLog, Workout } from "../logs/types";
import { formatNum } from "./csv";

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Set rendering
// ---------------------------------------------------------------------------

/**
 * Renders one exercise's sets within one workout, e.g. `6 kg × 10/11/12`,
 * `30s/35s`, or per-side `L 10/10 · R 10/9`.
 */
export function renderExerciseSets(sets: readonly SetLog[]): string {
  const groups = new Map<string, SetLog[]>();
  for (const set of sets) {
    const key = set.side ?? "both";
    const list = groups.get(key) ?? [];
    list.push(set);
    groups.set(key, list);
  }

  const parts: string[] = [];
  for (const side of ["left", "right", "both"] as const) {
    const list = groups.get(side);
    if (!list || list.length === 0) continue;

    const sorted = [...list].sort((a, b) => a.set_no - b.set_no);
    const first = sorted[0];
    const weight = first?.weight_kg;

    let body: string;
    if (sorted.every((s) => s.duration_s !== undefined)) {
      body = `${sorted.map((s) => `${s.duration_s}s`).join("/")}`;
    } else {
      body = sorted.map((s) => (s.reps !== undefined ? String(s.reps) : "–")).join("/");
    }

    const prefix = weight !== undefined ? `${formatNum(weight)} kg × ` : "";
    const sideLabel = side === "left" ? "L " : side === "right" ? "R " : "";
    parts.push(`${sideLabel}${prefix}${body}`);
  }

  return parts.join(" · ") || "–";
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

export function buildProgressSummary(
  contract: GainContract,
  logs: Logs,
  windowLabel: string,
  now: Date,
): string {
  const lines: string[] = [];

  const workouts = [...logs.workouts].sort((a, b) => a.started_at.localeCompare(b.started_at));
  const workoutById = new Map<string, Workout>(workouts.map((w) => [w.id, w]));

  const completed = workouts.filter((w) => w.status === "completed").length;
  lines.push(`Window: ${windowLabel}. Generated ${isoDate(now)}.`);
  lines.push("");
  lines.push(
    `Workouts in window: ${workouts.length} (${completed} completed). Activities in window: ${logs.activities.length}.`,
  );
  lines.push("");

  // -- Adherence, one row per declared session so the AI sees what was NOT done.
  lines.push("### Adherence");
  lines.push("");
  lines.push("| Session | Name | Workouts | Completed | Partial | Stopped |");
  lines.push("|---|---|---:|---:|---:|---:|");
  for (const session of contract.sessions) {
    const ws = workouts.filter((w) => w.session_key === session.key);
    const count = (status: Workout["status"]) => ws.filter((w) => w.status === status).length;
    lines.push(
      `| ${session.key} | ${session.name} | ${ws.length} | ${count("completed")} | ${count("partial")} | ${count("stopped")} |`,
    );
  }
  lines.push("");

  // -- Per-exercise progression, catalogue order, only exercises with logs.
  const setsByExercise = new Map<string, SetLog[]>();
  for (const set of logs.set_logs) {
    const list = setsByExercise.get(set.exercise_slug) ?? [];
    list.push(set);
    setsByExercise.set(set.exercise_slug, list);
  }

  const sortByWorkout = (a: SetLog, b: SetLog): number => {
    const wa = workoutById.get(a.workout_id);
    const wb = workoutById.get(b.workout_id);
    const t = (wa?.started_at ?? "").localeCompare(wb?.started_at ?? "");
    if (t !== 0) return t;
    if (a.set_no !== b.set_no) return a.set_no - b.set_no;
    return (a.side ?? "").localeCompare(b.side ?? "");
  };

  const exerciseRows: string[] = [];
  for (const def of contract.exercises) {
    const sets = setsByExercise.get(def.id);
    if (!sets || sets.length === 0) continue;

    const sorted = [...sets].sort(sortByWorkout);
    const workoutIds = [...new Set(sorted.map((s) => s.workout_id))];
    const firstId = workoutIds[0];
    const lastId = workoutIds[workoutIds.length - 1];

    const first = renderExerciseSets(sorted.filter((s) => s.workout_id === firstId));
    const latest = renderExerciseSets(sorted.filter((s) => s.workout_id === lastId));
    const lastDifficulty = [...sorted]
      .reverse()
      .find((s) => s.difficulty !== undefined)?.difficulty;

    const name = def.name ?? deriveExerciseName(def.id);
    exerciseRows.push(
      `| ${name} (\`${def.id}\`) | ${workoutIds.length} | ${first} | ${latest} | ${lastDifficulty ?? "–"} |`,
    );
  }

  lines.push("### Per-exercise progression");
  lines.push("");
  if (exerciseRows.length === 0) {
    lines.push("No sets logged in this window.");
  } else {
    lines.push("First and latest refer to the first and latest workout in the window.");
    lines.push("");
    lines.push("| Exercise | Workouts | First logged | Latest logged | Last difficulty |");
    lines.push("|---|---:|---|---|---|");
    lines.push(...exerciseRows);
  }
  lines.push("");

  // -- Metric trends, in contract declaration order (set, exercise, session).
  const valuesByKey = new Map<string, MetricValue[]>();
  for (const value of logs.metric_values) {
    const list = valuesByKey.get(value.key) ?? [];
    list.push(value);
    valuesByKey.set(value.key, list);
  }

  const metricRows: string[] = [];
  const scopes: MetricScope[] = ["set", "exercise", "session"];
  const declared: Array<{ scope: MetricScope; def: MetricDef }> = [];
  for (const scope of scopes) {
    for (const def of contract.metrics?.[scope] ?? []) {
      declared.push({ scope, def });
    }
  }

  for (const { scope, def } of declared) {
    const values = valuesByKey.get(def.key) ?? [];
    if (values.length === 0) continue;

    const numeric = values
      .map((v) => v.value_num)
      .filter((n): n is number => typeof n === "number");

    if (numeric.length > 0) {
      const min = Math.min(...numeric);
      const max = Math.max(...numeric);
      const avg = numeric.reduce((a, b) => a + b, 0) / numeric.length;
      const first = numeric[0];
      const latest = numeric[numeric.length - 1];
      metricRows.push(
        `| ${scope} | \`${def.key}\` | ${def.label} | ${numeric.length} | ${formatNum(first ?? 0)} | ${formatNum(latest ?? 0)} | ${formatNum(min)} | ${formatNum(avg)} | ${formatNum(max)} |`,
      );
    } else {
      const counts = new Map<string, number>();
      for (const v of values) {
        const text = v.value_text ?? "(blank)";
        counts.set(text, (counts.get(text) ?? 0) + 1);
      }
      const distribution = [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([text, n]) => `${text} ×${n}`)
        .join(", ");
      metricRows.push(
        `| ${scope} | \`${def.key}\` | ${def.label} | ${values.length} | – | – | – | – | ${distribution} |`,
      );
    }
  }

  lines.push("### Metric trends");
  lines.push("");
  if (metricRows.length === 0) {
    lines.push("No metric values logged in this window.");
  } else {
    lines.push("| Scope | Key | Label | n | First | Latest | Min | Avg | Max / values |");
    lines.push("|---|---|---|---:|---:|---:|---:|---:|---|");
    lines.push(...metricRows);
  }
  lines.push("");

  // -- Deviations, chronological.
  lines.push("### Deviations");
  lines.push("");
  if (logs.deviations.length === 0) {
    lines.push("No deviations recorded in this window.");
  } else {
    lines.push("| Date | Session | Exercise | Kind | Reason | Note |");
    lines.push("|---|---|---|---|---|---|");
    const sorted = [...logs.deviations].sort((a, b) => {
      const wa = workoutById.get(a.workout_id);
      const wb = workoutById.get(b.workout_id);
      const t = (wa?.started_at ?? "").localeCompare(wb?.started_at ?? "");
      if (t !== 0) return t;
      return a.exercise_slug.localeCompare(b.exercise_slug);
    });
    for (const d of sorted) {
      const workout = workoutById.get(d.workout_id);
      const when = workout ? dateOf(workout.started_at) : "–";
      const note = [
        d.note ?? "",
        d.substitute_exercise_slug ? `→ \`${d.substitute_exercise_slug}\`` : "",
      ]
        .filter((s) => s.length > 0)
        .join(" ");
      lines.push(
        `| ${when} | ${workout?.session_key ?? "–"} | \`${d.exercise_slug}\` | ${d.kind} | ${d.reason_code ?? "–"} | ${note || "–"} |`,
      );
    }
  }
  lines.push("");

  return lines.join("\n");
}
