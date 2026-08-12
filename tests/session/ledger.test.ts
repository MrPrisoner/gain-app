import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import {
  resolveSession,
  setLogKey,
  trackedExerciseKeys,
  type LoggedSet,
  type ResolvedBlock,
  type ResolvedExercise,
  type ResolvedSession,
} from "../../src/lib/session/session-view";
import type { PrefillByExercise } from "../../src/lib/session/prefill";
import {
  computeDoneExercises,
  currentRoundOf,
  exerciseAt,
  performed,
  prefillFor,
  resolveOpenContext,
  shownSetsFor,
  slotsFor,
  upNextForExerciseAt,
  upNextForSetLogged,
  UP_NEXT_FALLBACK,
  type SessionLedger,
} from "../../src/lib/session/ledger";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-dumbbell-v1.md", ROOT), "utf8");

function fixtureContract() {
  const parsed = parsePlanDocument(fixtureMd);
  if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
  return parsed.contract;
}

function session(key: string): ResolvedSession {
  const resolved = resolveSession(fixtureContract(), key);
  if (!resolved) throw new Error(`fixture has no session ${key}`);
  return resolved;
}

function block(s: ResolvedSession, key: string): ResolvedBlock {
  const found = s.blocks.find((b) => b.key === key);
  if (!found) throw new Error(`session has no block ${key}`);
  return found;
}

function exercise(b: ResolvedBlock, slug: string): ResolvedExercise {
  const found = b.exercises.find((e) => e.slug === slug);
  if (!found) throw new Error(`block ${b.key} has no exercise ${slug}`);
  return found;
}

function emptyLedger(overrides: Partial<SessionLedger> = {}): SessionLedger {
  return {
    loggedSets: new Map(),
    addedSets: new Map(),
    setCountDelta: new Map(),
    completedRounds: new Map(),
    substitutedExercises: new Map(),
    skippedExercises: new Set(),
    ...overrides,
  };
}

describe("performed", () => {
  it("returns the prescribed exercise when nothing has been substituted", () => {
    const main = block(session("A"), "main");
    const row = exercise(main, "supported-one-arm-row");
    expect(performed(emptyLedger(), main.key, row).slug).toBe("supported-one-arm-row");
  });

  it("returns the substitute once one is recorded for that block/slug", () => {
    const finisher = block(session("D"), "ab-finisher");
    const reverseCrunch = exercise(finisher, "reverse-crunch");
    const deadBug = exercise(finisher, "dead-bug");
    const ledger = emptyLedger({
      substitutedExercises: new Map([[`${finisher.key}:reverse-crunch`, deadBug]]),
    });
    expect(performed(ledger, finisher.key, reverseCrunch).slug).toBe("dead-bug");
  });
});

describe("currentRoundOf", () => {
  it("is 1 before any round has completed", () => {
    expect(currentRoundOf(emptyLedger(), "ab-finisher")).toBe(1);
  });

  it("increments with completedRounds", () => {
    const ledger = emptyLedger({ completedRounds: new Map([["ab-finisher", 1]]) });
    expect(currentRoundOf(ledger, "ab-finisher")).toBe(2);
  });
});

describe("shownSetsFor", () => {
  it("is always 1 inside a rounds block", () => {
    const finisher = block(session("D"), "ab-finisher");
    const deadBug = exercise(finisher, "dead-bug");
    expect(shownSetsFor(emptyLedger(), finisher, deadBug)).toBe(1);
  });

  it("draws the ranged minimum, then grows with addedSets up to the declared max", () => {
    const main = block(session("D"), "main");
    const row = exercise(main, "db-floor-press"); // sets: [2, 3]
    expect(shownSetsFor(emptyLedger(), main, row)).toBe(2);
    const withAdded = emptyLedger({ addedSets: new Map([[`${main.key}:db-floor-press`, 1]]) });
    expect(shownSetsFor(withAdded, main, row)).toBe(3);
  });

  it("setCountDelta adds a deviation set beyond the declared max", () => {
    const main = block(session("D"), "main");
    const row = exercise(main, "goblet-squat"); // sets: 3, fixed
    const ledger = emptyLedger({ setCountDelta: new Map([[`${main.key}:goblet-squat`, 1]]) });
    expect(shownSetsFor(ledger, main, row)).toBe(4);
  });

  it("never drops below the highest set number already logged", () => {
    const main = block(session("D"), "main");
    const row = exercise(main, "goblet-squat");
    const ledger = emptyLedger({
      setCountDelta: new Map([[`${main.key}:goblet-squat`, -5]]),
      loggedSets: new Map([[setLogKey(main.key, "goblet-squat", 3), {}]]),
    });
    expect(shownSetsFor(ledger, main, row)).toBe(3);
  });
});

describe("slotsFor", () => {
  it("returns no slots once the exercise is skipped", () => {
    const main = block(session("D"), "main");
    const row = exercise(main, "goblet-squat");
    const ledger = emptyLedger({ skippedExercises: new Set([`${main.key}:goblet-squat`]) });
    expect(slotsFor(ledger, main, row)).toEqual([]);
  });

  it("offers left/right slots for a per-side exercise", () => {
    const main = block(session("A"), "main");
    const row = exercise(main, "supported-one-arm-row"); // sets: 3, per_side
    const slots = slotsFor(emptyLedger(), main, row);
    expect(slots).toHaveLength(6);
    expect(slots[0]?.side).toBe("left");
    expect(slots[1]?.side).toBe("right");
  });

  it("in a rounds block, offers exactly the current round (both sides, dead-bug is per_side)", () => {
    const finisher = block(session("D"), "ab-finisher");
    const deadBug = exercise(finisher, "dead-bug");
    const ledger = emptyLedger({ completedRounds: new Map([["ab-finisher", 1]]) });
    const slots = slotsFor(ledger, finisher, deadBug);
    expect(slots).toHaveLength(2);
    expect(slots.every((slot) => slot.setNo === 2)).toBe(true);
  });

  it("a swap keeps the slot keyed on the prescribed slug, sized off the performed exercise", () => {
    const finisher = block(session("D"), "ab-finisher");
    const reverseCrunch = exercise(finisher, "reverse-crunch"); // not per_side
    const deadBug = exercise(finisher, "dead-bug"); // per_side
    const ledger = emptyLedger({
      substitutedExercises: new Map([[`${finisher.key}:reverse-crunch`, deadBug]]),
    });
    const slots = slotsFor(ledger, finisher, reverseCrunch);
    // One rounds-block round, but two L/R rows because the swapped-in movement is per_side.
    expect(slots).toHaveLength(2);
    expect(slots[0]?.key).toContain("reverse-crunch");
  });
});

describe("exerciseAt", () => {
  it("is undefined for an unknown key", () => {
    expect(exerciseAt(session("D"), emptyLedger(), "main:not-a-real-slug")).toBeUndefined();
  });

  it("is undefined when no key is given", () => {
    expect(exerciseAt(session("D"), emptyLedger(), undefined)).toBeUndefined();
  });

  it("never resolves into a checkoff block", () => {
    const d = session("D");
    const warmup = block(d, "warmup");
    const key = `${warmup.key}:${warmup.exercises[0]?.slug}`;
    expect(exerciseAt(d, emptyLedger(), key)).toBeUndefined();
  });

  it("resolves the trio, applying any substitution", () => {
    const d = session("D");
    const finisher = block(d, "ab-finisher");
    const deadBug = exercise(finisher, "dead-bug");
    const ledger = emptyLedger({
      substitutedExercises: new Map([[`${finisher.key}:reverse-crunch`, deadBug]]),
    });
    const at = exerciseAt(d, ledger, `${finisher.key}:reverse-crunch`);
    expect(at?.prescribed.slug).toBe("reverse-crunch");
    expect(at?.exercise.slug).toBe("dead-bug");
  });
});

describe("computeDoneExercises", () => {
  it("counts a skipped exercise as done", () => {
    const d = session("D");
    const key = "main:goblet-squat";
    const ledger = emptyLedger({ skippedExercises: new Set([key]) });
    expect(computeDoneExercises(d, ledger).has(key)).toBe(true);
  });

  it("counts an exercise done once every offered slot is logged", () => {
    const d = session("D");
    const key = "main:goblet-squat";
    const loggedSets = new Map<string, LoggedSet>();
    for (let setNo = 1; setNo <= 3; setNo++) {
      loggedSets.set(setLogKey("main", "goblet-squat", setNo), {});
    }
    expect(computeDoneExercises(d, emptyLedger({ loggedSets })).has(key)).toBe(true);
  });

  it("leaves an exercise with unlogged slots off the done set", () => {
    const d = session("D");
    expect(computeDoneExercises(d, emptyLedger()).has("main:goblet-squat")).toBe(false);
  });

  it("excludes checkoff blocks entirely", () => {
    const d = session("D");
    const warmup = block(d, "warmup");
    const key = `${warmup.key}:${warmup.exercises[0]?.slug}`;
    expect(computeDoneExercises(d, emptyLedger()).has(key)).toBe(false);
  });
});

describe("resolveOpenContext", () => {
  it("is undefined when nothing is open", () => {
    expect(resolveOpenContext(session("D"), emptyLedger(), undefined)).toBeUndefined();
  });

  it("resolves the open exercise's next unlogged slot", () => {
    const d = session("D");
    const ctx = resolveOpenContext(d, emptyLedger(), "main:goblet-squat");
    expect(ctx?.next?.setNo).toBe(1);
    expect(ctx?.shownSets).toBe(3);
  });

  it("next is undefined once every slot is logged", () => {
    const d = session("D");
    const loggedSets = new Map<string, LoggedSet>();
    for (let setNo = 1; setNo <= 3; setNo++) {
      loggedSets.set(setLogKey("main", "goblet-squat", setNo), {});
    }
    const ctx = resolveOpenContext(d, emptyLedger({ loggedSets }), "main:goblet-squat");
    expect(ctx?.next).toBeUndefined();
  });
});

describe("prefillFor", () => {
  const prefillByExercise: PrefillByExercise = {
    "goblet-squat": { none: { reps: 12, weightKg: 10, durationS: undefined, isFirstTime: false } },
    "supported-one-arm-row": {
      left: { reps: 9, weightKg: undefined, durationS: undefined, isFirstTime: false },
      right: { reps: 10, weightKg: undefined, durationS: undefined, isFirstTime: false },
    },
  };

  it("reads the `none` entry for a non-per-side exercise's first set", () => {
    const fill = prefillFor(
      emptyLedger(),
      prefillByExercise,
      "main",
      "goblet-squat",
      "goblet-squat",
      false,
      { setNo: 1, side: undefined, key: setLogKey("main", "goblet-squat", 1) },
    );
    // `prefillFor` passes the matched `PrefillResult` through as-is (it is not stripped
    // to reps/weightKg/durationS), so `isFirstTime` rides along unused by the caller.
    expect(fill).toMatchObject({ reps: 12, weightKg: 10, durationS: undefined });
  });

  it("reads the matching side for a per-side exercise", () => {
    const fill = prefillFor(
      emptyLedger(),
      prefillByExercise,
      "main",
      "supported-one-arm-row",
      "supported-one-arm-row",
      true,
      { setNo: 1, side: "right", key: setLogKey("main", "supported-one-arm-row", 1, "right") },
    );
    expect(fill.reps).toBe(10);
  });

  it("carries forward what was actually logged for the previous set of the same slot", () => {
    const ledger = emptyLedger({
      loggedSets: new Map([[setLogKey("main", "goblet-squat", 1), { weightKg: 14 }]]),
    });
    const fill = prefillFor(
      ledger,
      prefillByExercise,
      "main",
      "goblet-squat",
      "goblet-squat",
      false,
      { setNo: 2, side: undefined, key: setLogKey("main", "goblet-squat", 2) },
    );
    // Carried-forward weight wins over the history-based default.
    expect(fill.weightKg).toBe(14);
    // A field the previous set left blank still falls through to the base.
    expect(fill.reps).toBe(12);
  });

  it("returns an empty object for an exercise with no prefill entry at all", () => {
    expect(
      prefillFor(emptyLedger(), {}, "main", "front-plank", "front-plank", false, undefined),
    ).toEqual({});
  });
});

describe("upNextForExerciseAt", () => {
  it("falls back when nothing is scheduled", () => {
    expect(upNextForExerciseAt(undefined)).toEqual(UP_NEXT_FALLBACK);
  });

  it("names the exercise and its target line", () => {
    const d = session("D");
    const row = exercise(block(d, "main"), "goblet-squat");
    const at = exerciseAt(d, emptyLedger(), "main:goblet-squat");
    const upNext = upNextForExerciseAt(at);
    expect(upNext.label).toBe(row.name);
    expect(upNext.target).toContain("×");
  });
});

describe("upNextForSetLogged", () => {
  it("names the same exercise's next slot when the exercise isn't finished", () => {
    const d = session("D");
    const main = block(d, "main");
    const row = exercise(main, "goblet-squat");
    const context = {
      block: main,
      prescribed: row,
      exercise: row,
      key: "main:goblet-squat",
      shownSets: 3,
    };
    const nextSlot = { setNo: 2, side: undefined, key: setLogKey("main", "goblet-squat", 2) };
    const upNext = upNextForSetLogged(d, emptyLedger(), new Set(), {}, context, nextSlot);
    expect(upNext.label).toBe(row.name);
    expect(upNext.target).toContain("Set 2 of 3");
  });

  it("names whatever auto-advance would open next once the exercise is finished", () => {
    const d = session("D");
    const main = block(d, "main");
    const row = exercise(main, "goblet-squat");
    const nextRow = exercise(main, "db-floor-press");
    const context = {
      block: main,
      prescribed: row,
      exercise: row,
      key: "main:goblet-squat",
      shownSets: 3,
    };
    // Nothing in the session is done yet, so auto-advance from goblet-squat lands on the
    // very next tracked exercise in prescribed order.
    const upNext = upNextForSetLogged(d, emptyLedger(), new Set(), {}, context, undefined);
    expect(upNext.label).toBe(nextRow.name);
  });

  it("falls back once nothing at all is left", () => {
    const d = session("D");
    const main = block(d, "main");
    const row = exercise(main, "goblet-squat");
    const context = {
      block: main,
      prescribed: row,
      exercise: row,
      key: "main:goblet-squat",
      shownSets: 3,
    };
    const done = new Set(trackedExerciseKeys(d)); // every tracked exercise already done
    const upNext = upNextForSetLogged(d, emptyLedger(), done, {}, context, undefined);
    expect(upNext).toEqual(UP_NEXT_FALLBACK);
  });
});
