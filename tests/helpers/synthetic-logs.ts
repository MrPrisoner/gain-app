/**
 * Deterministic synthetic training logs built from a contract.
 *
 * Three weeks × four sessions of the fixture plan, with:
 *  - checkoff warm-ups completed but not logged set-by-set;
 *  - per-side exercises logged left/right;
 *  - reps/duration progressing up the declared ranges week by week;
 *  - a rounds block logged once per round;
 *  - a skip (pain), a substitute, and a dropped set as structured deviations;
 *  - metric values at all three scopes;
 *  - squash logged as activity outside the plan.
 *
 * Pure and deterministic: no I/O, no clock, no randomness.
 */

import type { GainContract, IntOrRange } from "../../src/lib/contract/schema";
import type {
  Activity,
  Deviation,
  Logs,
  MetricValue,
  SetLog,
  Workout,
} from "../../src/lib/logs/types";

/** Mon/Tue/Thu/Fri for three consecutive weeks. */
const WEEK_DATES = [
  ["2026-08-03", "2026-08-04", "2026-08-06", "2026-08-07"],
  ["2026-08-10", "2026-08-11", "2026-08-13", "2026-08-14"],
  ["2026-08-17", "2026-08-18", "2026-08-20", "2026-08-21"],
] as const;

const MAIN_LIFTS = new Set([
  "goblet-squat",
  "db-floor-press",
  "prone-row",
  "db-shoulder-press",
  "split-squat",
]);

/** `${workoutId}:${exerciseId}` keys for the scripted deviations. */
const SKIPPED = new Set(["wk-1-D:reverse-crunch"]);
const SUBSTITUTED = new Map([["wk-1-B:db-shoulder-press", "seated-floor-shoulder-press"]]);
const DROPPED_SET = new Set(["wk-2-C:split-squat"]);

function progress(value: IntOrRange | undefined, week: number): number {
  if (value === undefined) return 1;
  const [lo, hi] = typeof value === "number" ? [value, value] : value;
  return Math.round(lo + (hi - lo) * (week / 2));
}

export function buildSyntheticLogs(contract: GainContract): Logs {
  if (contract.sessions.length !== WEEK_DATES[0]?.length) {
    throw new Error("synthetic logs helper expects the four-session fixture plan");
  }

  const catalogue = new Map(contract.exercises.map((e) => [e.id, e]));
  const loads = new Map(contract.loads.map((l) => [l.ref, l]));

  const workouts: Workout[] = [];
  const set_logs: SetLog[] = [];
  const metric_values: MetricValue[] = [];
  const deviations: Deviation[] = [];

  let mvCounter = 0;
  const nextMetricId = (): string => `mv-${String(++mvCounter).padStart(3, "0")}`;

  WEEK_DATES.forEach((weekDates, week) => {
    contract.sessions.forEach((session, sessionIndex) => {
      const date = weekDates[sessionIndex];
      if (!date) throw new Error(`no date for week ${week} session ${sessionIndex}`);

      const workoutId = `wk-${week}-${session.key}`;
      workouts.push({
        id: workoutId,
        session_key: session.key,
        started_at: `${date}T07:30:00Z`,
        completed_at: `${date}T08:15:00Z`,
        status: "completed",
      });

      for (const block of session.blocks) {
        // Checkoff blocks are completed as a whole — no set-by-set logging.
        if (block.tracking === "checkoff") continue;

        const isRounds = block.type === "rounds";

        for (const rx of block.exercises) {
          const occurrence = `${workoutId}:${rx.id}`;
          if (SKIPPED.has(occurrence)) continue;

          const slug = SUBSTITUTED.get(occurrence) ?? rx.id;
          const def = catalogue.get(slug);
          if (!def) throw new Error(`no catalogue entry for \`${slug}\``);

          const type = def.type ?? "reps";
          const perSide = def.per_side === true;

          let sets: number;
          if (isRounds) {
            sets = block.rounds ?? 1;
          } else if (rx.sets === undefined) {
            sets = 1;
          } else {
            sets = typeof rx.sets === "number" ? rx.sets : rx.sets[1];
          }
          if (DROPPED_SET.has(occurrence)) sets = Math.max(1, sets - 1);

          const loadRef = rx.load ?? def.load;
          const weight = loadRef !== undefined ? loads.get(loadRef)?.default_kg : undefined;

          for (let setNo = 1; setNo <= sets; setNo++) {
            const sides: Array<"left" | "right" | undefined> = perSide
              ? ["left", "right"]
              : [undefined];

            for (const side of sides) {
              const id = `set-${workoutId}-${slug}-${setNo}${side !== undefined ? `-${side}` : ""}`;
              const log: SetLog = {
                id,
                workout_id: workoutId,
                exercise_slug: slug,
                set_no: setNo,
                difficulty: week === 0 ? "easy" : "medium",
              };
              if (side !== undefined) log.side = side;
              if (weight !== undefined) log.weight_kg = weight;
              if (type === "time") {
                log.duration_s = progress(rx.duration_sec, week);
              } else {
                log.reps = progress(rx.reps, week);
              }
              set_logs.push(log);

              // The set-scope half of `symptoms_during`, which the plan also declares at
              // session scope. Emitting both is the point: anything indexing metric values
              // on the bare key merges these two unrelated series into a wrong number.
              if (slug === "reverse-crunch" && week === 0 && setNo === 1 && side === undefined) {
                metric_values.push({
                  id: nextMetricId(),
                  key: "symptoms_during",
                  ref: { scope: "set", set_log_id: id },
                  value_num: 3,
                });
              }
            }
          }

          if (MAIN_LIFTS.has(slug)) {
            metric_values.push({
              id: nextMetricId(),
              key: "rir",
              ref: { scope: "exercise", workout_id: workoutId, exercise_slug: slug },
              value_num: 3 - week,
            });
            metric_values.push({
              id: nextMetricId(),
              key: "technique",
              ref: { scope: "exercise", workout_id: workoutId, exercise_slug: slug },
              value_text: slug === "prone-row" && week === 1 ? "Acceptable" : "Good",
            });
          }
        }
      }

      const sessionMetric = (key: string, value: number): void => {
        metric_values.push({
          id: nextMetricId(),
          key,
          ref: { scope: "session", workout_id: workoutId },
          value_num: value,
        });
      };

      const symptomLevel = session.key === "D" && week === 1 ? 2 : 0;
      sessionMetric("squash_since_last", sessionIndex === 0 ? 2 : 1);
      sessionMetric("symptoms_during", symptomLevel);
      sessionMetric("symptoms_next_morning", symptomLevel > 0 ? 1 : 0);
    });
  });

  deviations.push(
    {
      id: "dev-001",
      workout_id: "wk-1-D",
      exercise_slug: "reverse-crunch",
      kind: "skip",
      reason_code: "pain",
      note: "Familiar twinge during the first round; skipped the exercise rather than push through.",
    },
    {
      id: "dev-002",
      workout_id: "wk-1-B",
      exercise_slug: "db-shoulder-press",
      kind: "substitute",
      reason_code: "comfort",
      note: "Caught myself leaning back to finish the set; took the seated floor version the plan already names.",
      substitute_exercise_slug: "seated-floor-shoulder-press",
    },
    {
      id: "dev-003",
      workout_id: "wk-2-C",
      exercise_slug: "split-squat",
      kind: "drop_set",
      reason_code: "time",
      note: "Pressed for time; dropped the final set.",
    },
  );

  const activities: Activity[] = ["2026-08-05", "2026-08-12", "2026-08-19"].map((date, i) => ({
    id: `act-${i + 1}`,
    kind: "squash",
    occurred_at: `${date}T18:00:00Z`,
    duration_min: 60,
    intensity: "moderate",
  }));

  return { workouts, set_logs, metric_values, deviations, activities };
}
