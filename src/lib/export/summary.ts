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

/**
 * Everything below renders Markdown tables, and plan labels, session names and user
 * notes are free text. One unescaped `|` silently swallows the rest of the row.
 */
function cell(value: string): string {
  return value.replaceAll("|", "\\|");
}

/** Metric keys are unique within a scope, not across scopes — index on both. */
function scopedKey(scope: MetricScope, key: string): string {
  return `${scope}:${key}`;
}

// ---------------------------------------------------------------------------
// Set rendering
// ---------------------------------------------------------------------------

/**
 * Renders one exercise's sets within one workout, e.g. `6 kg × 10/11/12`,
 * `30s/35s`, or per-side `L 10/10 · R 10/9`.
 *
 * Load is per set, and drop sets and lighter last sets are ordinary. A single
 * leading weight is only correct when every set carried the same one; when they
 * differ the weight goes on each set instead (`10 @ 6 kg/8 @ 4 kg`). This table is
 * what the revising AI reads to prescribe the next block's loads, so a load shown
 * against the wrong set becomes a wrong prescription.
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
    const timed = sorted.every((s) => s.duration_s !== undefined);
    const effort = (s: SetLog): string =>
      timed ? `${formatNum(s.duration_s ?? 0)}s` : s.reps !== undefined ? String(s.reps) : "–";

    const weights = sorted.map((s) => s.weight_kg);
    const first = weights[0];
    const uniform = weights.every((w) => w === first);

    let body: string;
    let prefix = "";
    if (uniform) {
      body = sorted.map(effort).join("/");
      prefix = first !== undefined ? `${formatNum(first)} kg × ` : "";
    } else {
      body = sorted
        .map((s) =>
          s.weight_kg !== undefined ? `${effort(s)} @ ${formatNum(s.weight_kg)} kg` : effort(s),
        )
        .join("/");
    }

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
  lines.push(`Window: ${cell(windowLabel)}. Generated ${isoDate(now)}.`);
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
      `| ${cell(session.key)} | ${cell(session.name)} | ${ws.length} | ${count("completed")} | ${count("partial")} | ${count("stopped")} |`,
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
      `| ${cell(name)} (\`${def.id}\`) | ${workoutIds.length} | ${first} | ${latest} | ${lastDifficulty ?? "–"} |`,
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
  //
  // Keyed by scope AND key: the contract only requires a metric key to be unique
  // WITHIN its scope, so a plan may legally declare `rpe` at set scope and at
  // session scope. Keying on the bare key would merge two unrelated series into
  // one row with a wrong n and wrong extremes.
  const setLogById = new Map<string, SetLog>(logs.set_logs.map((s) => [s.id, s]));
  const valuesByKey = new Map<string, MetricValue[]>();
  for (const value of logs.metric_values) {
    const id = scopedKey(value.ref.scope, value.key);
    const list = valuesByKey.get(id) ?? [];
    list.push(value);
    valuesByKey.set(id, list);
  }

  /** Chronological, so that "First" and "Latest" mean what the headers say. */
  const metricOrder = (v: MetricValue): string => {
    const workoutId =
      v.ref.scope === "set" ? setLogById.get(v.ref.set_log_id)?.workout_id : v.ref.workout_id;
    const started = workoutId ? (workoutById.get(workoutId)?.started_at ?? "") : "";
    const setNo = v.ref.scope === "set" ? (setLogById.get(v.ref.set_log_id)?.set_no ?? 0) : 0;
    return `${started}|${String(setNo).padStart(6, "0")}`;
  };

  const metricRows: string[] = [];
  const scopes: MetricScope[] = ["set", "exercise", "session"];
  const declared: Array<{ scope: MetricScope; def: MetricDef }> = [];
  for (const scope of scopes) {
    for (const def of contract.metrics?.[scope] ?? []) {
      declared.push({ scope, def });
    }
  }

  for (const { scope, def } of declared) {
    const unsorted = valuesByKey.get(scopedKey(scope, def.key)) ?? [];
    if (unsorted.length === 0) continue;
    const values = [...unsorted].sort((a, b) => metricOrder(a).localeCompare(metricOrder(b)));

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
        `| ${scope} | \`${def.key}\` | ${cell(def.label)} | ${numeric.length} | ${formatNum(first ?? 0)} | ${formatNum(latest ?? 0)} | ${formatNum(min)} | ${formatNum(avg)} | ${formatNum(max)} |`,
      );
    } else {
      const counts = new Map<string, number>();
      for (const v of values) {
        const text = v.value_text ?? "(blank)";
        counts.set(text, (counts.get(text) ?? 0) + 1);
      }
      const distribution = [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([text, n]) => `${cell(text)} ×${n}`)
        .join(", ");
      metricRows.push(
        `| ${scope} | \`${def.key}\` | ${cell(def.label)} | ${values.length} | – | – | – | – | ${distribution} |`,
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
        d.note ? cell(d.note) : "",
        d.substitute_exercise_slug ? `→ \`${d.substitute_exercise_slug}\`` : "",
      ]
        .filter((s) => s.length > 0)
        .join(" ");
      lines.push(
        `| ${when} | ${cell(workout?.session_key ?? "–")} | \`${d.exercise_slug}\` | ${d.kind} | ${cell(d.reason_code ?? "–")} | ${note || "–"} |`,
      );
    }
  }
  lines.push("");

  return lines.join("\n");
}
