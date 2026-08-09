/**
 * The export side of the loop (ARCHITECTURE §11): one self-contained `.md` bundle,
 * ready to paste into any chat.
 *
 *   # GAIN Export — <Plan> — <window>
 *   ## 0. Your task                       ← user-editable template, rendered
 *   ## 1. The current plan                ← source_md of the current version, verbatim
 *   ## 2. Progress summary                ← generated tables
 *   ## 3. Raw logs                        ← ```csv sets / sessions / activities
 *   ## 4. How to return an updated plan   ← docs/CONTRACT.md, verbatim
 *
 * Section 1 is `source_md` byte-for-byte — the plan document is copied, never
 * reassembled from `context_md` plus a block. Section 4 is the contract spec
 * verbatim. Pure function over plain data; the clock is injected via `now`.
 */

import type { GainContract, MetricDef } from "../contract/schema";
import type { Logs, MetricValue, SetLog, Workout } from "../logs/types";
import { renderInstructionsTemplate, type InstructionVariables } from "../templates/render";
import { formatNum, toCsv } from "./csv";
import { buildProgressSummary, isoDate } from "./summary";

export type ExportWindow = {
  /** Human-readable window, e.g. `weeks 1–4` or `full history`. */
  label: string;
  /** ISO date/time. Omit `start` for "from the beginning". */
  start?: string;
  /** ISO date/time. Omit `end` for "up to now". */
  end?: string;
};

export type ExportInput = {
  contract: GainContract;
  /** The current plan version's `source_md`, exactly as it was imported. */
  source_md: string;
  /** The user-editable Section 0 template body (default: default-ai-instructions.md). */
  instructions_template: string;
  /** The contents of docs/CONTRACT.md, for Section 4. */
  contract_md: string;
  logs: Logs;
  window: ExportWindow;
  /** Injected clock — exports stay deterministic. */
  now: Date;
};

// ---------------------------------------------------------------------------
// Window filtering
// ---------------------------------------------------------------------------

function inWindow(iso: string, window: ExportWindow): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  if (window.start !== undefined && t < Date.parse(window.start)) return false;
  if (window.end !== undefined && t > Date.parse(window.end)) return false;
  return true;
}

export function filterLogsToWindow(logs: Logs, window: ExportWindow): Logs {
  const workouts = logs.workouts.filter((w) => inWindow(w.started_at, window));
  const workoutIds = new Set(workouts.map((w) => w.id));

  const set_logs = logs.set_logs.filter((s) => workoutIds.has(s.workout_id));
  const setLogIds = new Set(set_logs.map((s) => s.id));

  const metric_values = logs.metric_values.filter((v) => {
    switch (v.ref.scope) {
      case "session":
      case "exercise":
        return workoutIds.has(v.ref.workout_id);
      case "set":
        return setLogIds.has(v.ref.set_log_id);
    }
  });

  const deviations = logs.deviations.filter((d) => workoutIds.has(d.workout_id));
  const activities = logs.activities.filter((a) => inWindow(a.occurred_at, window));

  return { workouts, set_logs, metric_values, deviations, activities };
}

// ---------------------------------------------------------------------------
// Section 3: raw logs as CSV
// ---------------------------------------------------------------------------

/**
 * Composite map-key separator, matching `scopedKey` in ./summary.ts.
 *
 * A colon is safe for every key built with it: the halves are a ULID (Crockford
 * base32, letters and digits only) and a catalogue slug (`SLUG_REGEX` — lowercase
 * alphanumerics and single hyphens). Neither can contain one, so `a` + `b:c` cannot
 * collide with `a:b` + `c`, and reading the wrong workout's metrics is not reachable.
 */
const SEP = ":";

function metricValueText(v: MetricValue | undefined): string {
  if (!v) return "";
  if (v.value_num !== undefined) return formatNum(v.value_num);
  return v.value_text ?? "";
}

function durationMin(w: Workout): string {
  if (!w.completed_at) return "";
  const ms = Date.parse(w.completed_at) - Date.parse(w.started_at);
  if (Number.isNaN(ms) || ms < 0) return "";
  return String(Math.round(ms / 60000));
}

export function renderRawLogs(contract: GainContract, logs: Logs): string {
  const workoutById = new Map(logs.workouts.map((w) => [w.id, w]));

  const setDefs: MetricDef[] = contract.metrics?.set ?? [];
  const exerciseDefs: MetricDef[] = contract.metrics?.exercise ?? [];
  const sessionDefs: MetricDef[] = contract.metrics?.session ?? [];

  // Set-scope values indexed by set_log id; exercise-scope by workout+slug.
  const setMetricBySetLog = new Map<string, Map<string, MetricValue>>();
  const exerciseMetricByWorkout = new Map<string, Map<string, MetricValue>>();
  const sessionMetricByWorkout = new Map<string, Map<string, MetricValue>>();
  for (const v of logs.metric_values) {
    const target =
      v.ref.scope === "set"
        ? (setMetricBySetLog.get(v.ref.set_log_id) ??
          (() => {
            const m = new Map<string, MetricValue>();
            setMetricBySetLog.set(v.ref.set_log_id, m);
            return m;
          })())
        : v.ref.scope === "exercise"
          ? (exerciseMetricByWorkout.get(`${v.ref.workout_id}${SEP}${v.ref.exercise_slug}`) ??
            (() => {
              const m = new Map<string, MetricValue>();
              exerciseMetricByWorkout.set(`${v.ref.workout_id}${SEP}${v.ref.exercise_slug}`, m);
              return m;
            })())
          : (sessionMetricByWorkout.get(v.ref.workout_id) ??
            (() => {
              const m = new Map<string, MetricValue>();
              sessionMetricByWorkout.set(v.ref.workout_id, m);
              return m;
            })());
    target.set(v.key, v);
  }

  // -- sets.csv
  const setsHeader = [
    "workout_id",
    "date",
    "session_key",
    "exercise",
    "set_no",
    "side",
    "reps",
    "weight_kg",
    "duration_s",
    "difficulty",
    ...setDefs.map((d) => d.key),
  ];
  const setsRows = logs.set_logs.map((s: SetLog) => {
    const w = workoutById.get(s.workout_id);
    const metrics = setMetricBySetLog.get(s.id);
    return [
      s.workout_id,
      w ? w.started_at.slice(0, 10) : "",
      w?.session_key ?? "",
      s.exercise_slug,
      String(s.set_no),
      s.side ?? "",
      s.reps !== undefined ? String(s.reps) : "",
      s.weight_kg !== undefined ? formatNum(s.weight_kg) : "",
      s.duration_s !== undefined ? formatNum(s.duration_s) : "",
      s.difficulty ?? "",
      ...setDefs.map((d) => metricValueText(metrics?.get(d.key))),
    ];
  });
  const setsCsv = toCsv(setsHeader, setsRows);

  // -- sessions.csv (one row per workout; exercise-scope metrics packed, see below)
  const sessionsHeader = [
    "workout_id",
    "date",
    "session_key",
    "status",
    "duration_min",
    "note",
    ...sessionDefs.map((d) => d.key),
    ...(exerciseDefs.length > 0 ? ["exercise_metrics"] : []),
  ];
  const sessionsRows = logs.workouts.map((w) => {
    const sessionMetrics = sessionMetricByWorkout.get(w.id);
    const exerciseMetrics: string[] = [];
    if (exerciseDefs.length > 0) {
      const slugs = [
        ...new Set(logs.set_logs.filter((s) => s.workout_id === w.id).map((s) => s.exercise_slug)),
      ].sort();
      for (const slug of slugs) {
        const byKey = exerciseMetricByWorkout.get(`${w.id}${SEP}${slug}`);
        if (!byKey) continue;
        for (const def of exerciseDefs) {
          const v = byKey.get(def.key);
          if (v) exerciseMetrics.push(`${slug}:${def.key}=${metricValueText(v)}`);
        }
      }
    }
    return [
      w.id,
      w.started_at.slice(0, 10),
      w.session_key,
      w.status,
      durationMin(w),
      w.note ?? "",
      ...sessionDefs.map((d) => metricValueText(sessionMetrics?.get(d.key))),
      ...(exerciseDefs.length > 0 ? [exerciseMetrics.join("; ")] : []),
    ];
  });
  const sessionsCsv = toCsv(sessionsHeader, sessionsRows);

  // -- activities.csv
  const activitiesCsv = toCsv(
    ["id", "kind", "occurred_at", "duration_min", "intensity", "note"],
    logs.activities.map((a) => [
      a.id,
      a.kind,
      a.occurred_at,
      a.duration_min !== undefined ? String(a.duration_min) : "",
      a.intensity ?? "",
      a.note ?? "",
    ]),
  );

  return [
    "```csv",
    setsCsv.trimEnd(),
    "```",
    "",
    "```csv",
    sessionsCsv.trimEnd(),
    "```",
    "",
    "```csv",
    activitiesCsv.trimEnd(),
    "```",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Bundle assembly
// ---------------------------------------------------------------------------

function section(heading: string, body: string): string {
  const ensured = body.endsWith("\n") ? body : `${body}\n`;
  return `${heading}\n\n${ensured}`;
}

/** Whole weeks elapsed since the first workout — feeds `{{weeks_elapsed}}`. */
export function weeksElapsed(logs: Logs, now: Date): number {
  const starts = logs.workouts.map((w) => Date.parse(w.started_at)).filter((t) => !Number.isNaN(t));
  if (starts.length === 0) return 0;
  const first = Math.min(...starts);
  return Math.max(0, Math.floor((now.getTime() - first) / (7 * 24 * 60 * 60 * 1000)));
}

export function generateExport(input: ExportInput): string {
  const { contract, source_md, logs, window, now } = input;

  const windowed = filterLogsToWindow(logs, window);

  const vars: InstructionVariables = {
    plan_name: contract.plan.name,
    plan_version: String(contract.plan.version),
    export_window: window.label,
    today: isoDate(now),
    workouts_logged: String(windowed.workouts.length),
    weeks_elapsed: String(weeksElapsed(logs, now)),
  };

  const section0 = renderInstructionsTemplate(input.instructions_template, vars);
  const section2 = buildProgressSummary(contract, windowed, window.label, now);
  const section3 = renderRawLogs(contract, windowed);

  return [
    `# GAIN Export — ${contract.plan.name} — ${window.label}`,
    "",
    section("## 0. Your task", section0),
    section("## 1. The current plan", source_md),
    section("## 2. Progress summary", section2),
    section("## 3. Raw logs", section3),
    section("## 4. How to return an updated plan", input.contract_md),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extracts Section 1 (`source_md`) from a bundle. Exact when the embedded source
 * ends with a newline (as plan documents do); returns null when the bundle's
 * generated headings are not found.
 */
export function extractPlanSourceFromBundle(bundle: string): string | null {
  const startMarker = "\n## 1. The current plan\n\n";
  const endMarker = "\n## 2. Progress summary\n";
  const i = bundle.indexOf(startMarker);
  if (i === -1) return null;
  const start = i + startMarker.length;
  const j = bundle.indexOf(endMarker, start);
  if (j === -1) return null;
  return bundle.slice(start, j);
}

/** Extracts Section 4 (the contract spec) from a bundle, or null if absent. */
export function extractSection4FromBundle(bundle: string): string | null {
  const marker = "\n## 4. How to return an updated plan\n\n";
  const i = bundle.indexOf(marker);
  if (i === -1) return null;
  return bundle.slice(i + marker.length);
}
