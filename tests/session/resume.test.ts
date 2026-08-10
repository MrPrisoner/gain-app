/**
 * ARCHITECTURE §9, "Resuming": rebuilding a resumed
 * workout's runner state from its own persisted rows.
 *
 * Driven against the real fixture's resolved sessions plus hand-written row fixtures — no
 * database and no SvelteKit, per the pure-layer rule. The rows are shaped exactly as
 * `workoutHistoryFor` returns them (nulls, not `undefined`, because that is what SQLite
 * hands back), and `id` is any sortable string: the real ones are ULIDs, and all this layer
 * asks of them is that they sort into insertion order.
 */

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { resolveSession } from "../../src/lib/session/session-view";
import { hydrateSession } from "../../src/lib/session/resume";
import type {
  WorkoutDeviationRow,
  WorkoutHistory,
  WorkoutMetricRow,
  WorkoutSetRow,
} from "../../src/lib/session/resume";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-dumbbell-v1.md", ROOT), "utf8");

function session(key: string) {
  const parsed = parsePlanDocument(fixtureMd);
  if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
  const resolved = resolveSession(parsed.contract, key);
  if (!resolved) throw new Error(`fixture has no session ${key}`);
  return resolved;
}

function setRow(
  id: string,
  exerciseSlug: string,
  setNo: number,
  over: Partial<WorkoutSetRow> = {},
) {
  return {
    id,
    exerciseSlug,
    setNo,
    side: null,
    reps: null,
    weightKg: null,
    durationS: null,
    difficulty: null,
    ...over,
  } satisfies WorkoutSetRow;
}

function deviationRow(
  id: string,
  exerciseSlug: string,
  kind: WorkoutDeviationRow["kind"],
  substituteSlug: string | null = null,
) {
  return { id, exerciseSlug, kind, substituteSlug } satisfies WorkoutDeviationRow;
}

function metricRow(
  id: string,
  scope: WorkoutMetricRow["scope"],
  metricKey: string,
  value: number | string,
) {
  return {
    id,
    scope,
    metricKey,
    valueNum: typeof value === "number" ? value : null,
    valueText: typeof value === "string" ? value : null,
  } satisfies WorkoutMetricRow;
}

function history(over: Partial<WorkoutHistory> = {}): WorkoutHistory {
  return { sets: [], deviations: [], metrics: [], ...over };
}

/** The two fields `hydrateSession` reads off a block, for the hand-built session below. */
function bareBlock(key: string) {
  return { key, type: "sequence" as const, tracking: "full" as const };
}

/** Likewise, the one field it reads off an exercise. */
function bareExercise(slug: string) {
  return { slug };
}

describe("hydrateSession — set rows", () => {
  it("returns nothing for a workout that has written nothing", () => {
    expect(hydrateSession(session("A"), history())).toEqual({
      loggedSets: [],
      skipped: [],
      substitutes: [],
      setCountDelta: [],
      completedRounds: [],
      sessionMetrics: [],
    });
  });

  it("keys logged sets exactly as the runner does, dropping nulls", () => {
    const hydrated = hydrateSession(
      session("A"),
      history({
        sets: [
          setRow("01", "goblet-squat", 1, { reps: 12, weightKg: 10, difficulty: "medium" }),
          setRow("02", "goblet-squat", 2, { reps: 11, weightKg: 10, difficulty: "hard" }),
        ],
      }),
    );

    expect(hydrated.loggedSets).toEqual([
      { key: "main:goblet-squat:1:", logged: { reps: 12, weightKg: 10, difficulty: "medium" } },
      { key: "main:goblet-squat:2:", logged: { reps: 11, weightKg: 10, difficulty: "hard" } },
    ]);
  });

  it("keeps left and right on separate slots for a per-side exercise", () => {
    const hydrated = hydrateSession(
      session("A"),
      history({
        sets: [
          setRow("01", "supported-one-arm-row", 1, { side: "left", reps: 12 }),
          setRow("02", "supported-one-arm-row", 1, { side: "right", reps: 10 }),
        ],
      }),
    );

    expect(hydrated.loggedSets.map((entry) => entry.key)).toEqual([
      "main:supported-one-arm-row:1:left",
      "main:supported-one-arm-row:1:right",
    ]);
  });

  it("never attributes a set to a checkoff block", () => {
    // `bird-dog` is in session A's warm-up (checkoff) *and* its core block. Checkoff pills
    // write no rows at all, so the core block is the only place this can have come from.
    const hydrated = hydrateSession(
      session("A"),
      history({ sets: [setRow("01", "bird-dog", 1, { reps: 8 })] }),
    );

    expect(hydrated.loggedSets).toEqual([{ key: "core:bird-dog:1:", logged: { reps: 8 } }]);
  });

  it("orders by row id rather than by the order the rows arrived", () => {
    const hydrated = hydrateSession(
      session("A"),
      history({
        sets: [setRow("02", "goblet-squat", 2, { reps: 9 }), setRow("01", "goblet-squat", 1, {})],
      }),
    );

    expect(hydrated.loggedSets.map((entry) => entry.key)).toEqual([
      "main:goblet-squat:1:",
      "main:goblet-squat:2:",
    ]);
  });
});

describe("hydrateSession — deviations", () => {
  it("rebuilds a skip on the prescribed slot", () => {
    const hydrated = hydrateSession(
      session("A"),
      history({ deviations: [deviationRow("01", "reverse-lunge", "skip")] }),
    );

    expect(hydrated.skipped).toEqual(["main:reverse-lunge"]);
  });

  it("rebuilds a swap as the prescribed slot plus the slug swapped into it", () => {
    const hydrated = hydrateSession(
      session("B"),
      history({
        deviations: [
          deviationRow("01", "overhead-triceps-extension", "substitute", "lying-triceps-extension"),
        ],
      }),
    );

    expect(hydrated.substitutes).toEqual([
      {
        blockKey: "main",
        prescribedSlug: "overhead-triceps-extension",
        substituteSlug: "lying-triceps-extension",
      },
    ]);
  });

  it("puts sets logged either side of a swap on the same prescribed slot", () => {
    const hydrated = hydrateSession(
      session("B"),
      history({
        sets: [
          setRow("s1", "overhead-triceps-extension", 1, { reps: 12 }),
          setRow("s3", "lying-triceps-extension", 2, { reps: 10 }),
        ],
        deviations: [
          deviationRow("s2", "overhead-triceps-extension", "substitute", "lying-triceps-extension"),
        ],
      }),
    );

    expect(hydrated.loggedSets).toEqual([
      { key: "main:overhead-triceps-extension:1:", logged: { reps: 12 } },
      { key: "main:overhead-triceps-extension:2:", logged: { reps: 10 } },
    ]);
  });

  it("lands a skip recorded after a swap on the prescribed slot, not the substitute's name", () => {
    // The deviation sheet posts the *performed* slug, so a skip taken after swapping names
    // `lying-triceps-extension` — a movement no session prescribes at all.
    const hydrated = hydrateSession(
      session("B"),
      history({
        deviations: [
          deviationRow("01", "overhead-triceps-extension", "substitute", "lying-triceps-extension"),
          deviationRow("02", "lying-triceps-extension", "skip"),
        ],
      }),
    );

    expect(hydrated.skipped).toEqual(["main:overhead-triceps-extension"]);
  });

  it("nets add_set and drop_set into one signed delta per slot", () => {
    const hydrated = hydrateSession(
      session("A"),
      history({
        deviations: [
          deviationRow("01", "goblet-squat", "add_set"),
          deviationRow("02", "goblet-squat", "add_set"),
          deviationRow("03", "goblet-squat", "drop_set"),
          deviationRow("04", "reverse-lunge", "drop_set"),
        ],
      }),
    );

    expect(hydrated.setCountDelta).toEqual([
      { key: "main:goblet-squat", delta: 1 },
      { key: "main:reverse-lunge", delta: -1 },
    ]);
  });

  it("takes the last swap for a slot when more than one was recorded", () => {
    const hydrated = hydrateSession(
      session("A"),
      history({
        deviations: [
          deviationRow("01", "side-plank", "substitute", "front-plank"),
          deviationRow("02", "front-plank", "substitute", "dead-bug"),
        ],
      }),
    );

    expect(hydrated.substitutes).toEqual([
      { blockKey: "core", prescribedSlug: "side-plank", substituteSlug: "dead-bug" },
    ]);
  });

  it("ignores a red-flag stop — that path finishes the workout outright", () => {
    const hydrated = hydrateSession(
      session("A"),
      history({ deviations: [deviationRow("01", "goblet-squat", "stop_red_flag")] }),
    );

    expect(hydrated.skipped).toEqual([]);
    expect(hydrated.setCountDelta).toEqual([]);
  });

  it("spreads repeated deviations across two blocks prescribing the same movement", () => {
    // The `block_key`-shaped hole in the schema, and the documented resolution: rows are
    // matched earliest-occurrence-first, preferring a slot the row can still land on. Two
    // skips of one slug therefore take one slot each rather than both collapsing onto the
    // first. The fixture has no such collision among loggable blocks, so this is built by
    // hand — the point is the rule, not the plan.
    const twoBlocks = {
      blocks: [
        { ...bareBlock("first"), exercises: [bareExercise("side-plank")] },
        { ...bareBlock("second"), exercises: [bareExercise("side-plank")] },
      ],
    };

    const hydrated = hydrateSession(
      twoBlocks,
      history({
        sets: [setRow("s1", "side-plank", 1, { durationS: 30 })],
        deviations: [
          deviationRow("d1", "side-plank", "skip"),
          deviationRow("d2", "side-plank", "skip"),
        ],
      }),
    );

    expect(hydrated.skipped).toEqual(["first:side-plank", "second:side-plank"]);
    // The one set row went to the earliest occurrence, and stayed one row.
    expect(hydrated.loggedSets).toEqual([
      { key: "first:side-plank:1:", logged: { durationS: 30 } },
    ]);
  });
});

describe("hydrateSession — rounds and metrics", () => {
  it("resumes a rounds block on the highest round any row was logged against", () => {
    const hydrated = hydrateSession(
      session("D"),
      history({
        sets: [
          setRow("01", "dead-bug", 1, { side: "left", reps: 8 }),
          setRow("02", "dead-bug", 1, { side: "right", reps: 8 }),
          setRow("03", "dead-bug", 2, { side: "left", reps: 8 }),
        ],
      }),
    );

    // Round 2 has a row, so one round is complete and the runner reopens on round 2.
    expect(hydrated.completedRounds).toEqual([{ blockKey: "ab-finisher", rounds: 1 }]);
    expect(hydrated.loggedSets.map((entry) => entry.key)).toEqual([
      "ab-finisher:dead-bug:1:left",
      "ab-finisher:dead-bug:1:right",
      "ab-finisher:dead-bug:2:left",
    ]);
  });

  it("reports no completed rounds while still inside the first one", () => {
    const hydrated = hydrateSession(
      session("D"),
      history({ sets: [setRow("01", "dead-bug", 1, { side: "left", reps: 8 })] }),
    );

    expect(hydrated.completedRounds).toEqual([]);
  });

  it("keeps only session-scope metrics, last value winning", () => {
    const hydrated = hydrateSession(
      session("A"),
      history({
        metrics: [
          metricRow("01", "session", "symptoms_during", 3),
          metricRow("02", "exercise", "rir", 2),
          metricRow("03", "session", "symptoms_during", 5),
          metricRow("04", "session", "session_rpe", "Moderate"),
        ],
      }),
    );

    expect(hydrated.sessionMetrics).toEqual([
      { key: "symptoms_during", value: 5 },
      { key: "session_rpe", value: "Moderate" },
    ]);
  });
});
