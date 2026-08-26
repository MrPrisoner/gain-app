import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import {
  resolveSession,
  resolveSubstitute,
  setLogKey,
  trackedExerciseKeys,
  type LoggedSet,
  type ResolvedBlock,
  type ResolvedExercise,
  type ResolvedSession,
} from "../../src/lib/session/session-view";
import type { PrefillByExercise } from "../../src/lib/session/prefill";
import {
  blockIsComplete,
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
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");

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

/** A `PrefillByExercise` carrying nothing but a weight, which is all the up-next card
 * reads out of it. */
function prefill(
  slug: string,
  weights: { left?: number; right?: number; none?: number },
): PrefillByExercise {
  const entry: PrefillByExercise[string] = {};
  for (const side of ["left", "right", "none"] as const) {
    const weightKg = weights[side];
    if (weightKg !== undefined) {
      entry[side] = { reps: undefined, weightKg, durationS: undefined, isFirstTime: true };
    }
  }
  return { [slug]: entry };
}

describe("performed", () => {
  it("returns the prescribed exercise when nothing has been substituted", () => {
    const main = block(session("A"), "main");
    const row = exercise(main, "prone-row");
    expect(performed(emptyLedger(), main.key, row).slug).toBe("prone-row");
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
    const row = exercise(main, "hammer-curl"); // sets: 2, fixed
    const ledger = emptyLedger({ setCountDelta: new Map([[`${main.key}:hammer-curl`, 1]]) });
    expect(shownSetsFor(ledger, main, row)).toBe(3);
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
    const main = block(session("C"), "main");
    const row = exercise(main, "split-squat"); // sets: 2, per_side
    const slots = slotsFor(emptyLedger(), main, row);
    expect(slots).toHaveLength(4);
    expect(slots[0]?.side).toBe("left");
    expect(slots[1]?.side).toBe("right");
  });

  it("in a rounds block, offers exactly the current round (both sides, for a per_side exercise)", () => {
    const finisher = block(session("D"), "ab-finisher");
    const deadBug = exercise(finisher, "dead-bug");
    // None of ab-finisher's own movements (dead-bug, mcgill-curl-up, reverse-crunch) are
    // per_side in this fixture, so this synthesizes one to exercise the per_side +
    // rounds-block interaction directly, rather than losing the coverage.
    const perSideDeadBug = { ...deadBug, perSide: true };
    const ledger = emptyLedger({ completedRounds: new Map([["ab-finisher", 1]]) });
    const slots = slotsFor(ledger, finisher, perSideDeadBug);
    expect(slots).toHaveLength(2);
    expect(slots.every((slot) => slot.setNo === 2)).toBe(true);
  });

  it("a swap keeps the slot keyed on the prescribed slug, sized off the performed exercise", () => {
    const finisher = block(session("D"), "ab-finisher");
    const reverseCrunch = exercise(finisher, "reverse-crunch"); // not per_side
    // `split-squat` (session C's main block) stands in for the per_side movement here —
    // ab-finisher's own catalogue has none in this fixture.
    const splitSquat = exercise(block(session("C"), "main"), "split-squat"); // per_side
    const ledger = emptyLedger({
      substitutedExercises: new Map([[`${finisher.key}:reverse-crunch`, splitSquat]]),
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

describe("blockIsComplete", () => {
  /** Every offered slot of every exercise in a block, logged. */
  function logWholeBlock(s: ResolvedSession, blockKey: string): Map<string, LoggedSet> {
    const b = block(s, blockKey);
    const loggedSets = new Map<string, LoggedSet>();
    for (const prescribed of b.exercises) {
      for (const slot of slotsFor(emptyLedger(), b, prescribed)) loggedSets.set(slot.key, {});
    }
    return loggedSets;
  }

  it("is false for a checkoff block with nothing checked off", () => {
    const a = session("A");
    expect(blockIsComplete(block(a, "warmup"), emptyLedger(), new Set())).toBe(false);
  });

  it("is false for a checkoff block with only some pills checked off", () => {
    const a = session("A");
    const warmup = block(a, "warmup");
    const loggedSets = new Map<string, LoggedSet>();
    loggedSets.set(setLogKey(warmup.key, warmup.exercises[0]!.slug, 1), {});
    expect(blockIsComplete(warmup, emptyLedger({ loggedSets }), new Set())).toBe(false);
  });

  it("is true for a checkoff block once every pill is checked off", () => {
    const a = session("A");
    const warmup = block(a, "warmup");
    const loggedSets = new Map<string, LoggedSet>();
    for (const e of warmup.exercises) loggedSets.set(setLogKey(warmup.key, e.slug, 1), {});
    expect(blockIsComplete(warmup, emptyLedger({ loggedSets }), new Set())).toBe(true);
  });

  it("is true for a sequence block once every exercise is done", () => {
    const a = session("A");
    const loggedSets = logWholeBlock(a, "main");
    const ledger = emptyLedger({ loggedSets });
    expect(blockIsComplete(block(a, "main"), ledger, computeDoneExercises(a, ledger))).toBe(true);
  });

  it("is false for a sequence block while one exercise is still unlogged", () => {
    const a = session("A");
    const main = block(a, "main");
    const loggedSets = logWholeBlock(a, "main");
    // Drop one slot of the last exercise back off again.
    const last = main.exercises.at(-1)!;
    loggedSets.delete(slotsFor(emptyLedger(), main, last).at(-1)!.key);
    const ledger = emptyLedger({ loggedSets });
    expect(blockIsComplete(main, ledger, computeDoneExercises(a, ledger))).toBe(false);
  });

  it("counts a skipped exercise towards its block, exactly as `computeDoneExercises` does", () => {
    const a = session("A");
    const main = block(a, "main");
    const skipped = main.exercises.at(-1)!;
    const skippedExercises = new Set([`${main.key}:${skipped.slug}`]);
    const loggedSets = new Map<string, LoggedSet>();
    for (const prescribed of main.exercises) {
      if (prescribed.slug === skipped.slug) continue;
      for (const slot of slotsFor(emptyLedger(), main, prescribed)) loggedSets.set(slot.key, {});
    }
    const ledger = emptyLedger({ loggedSets, skippedExercises });
    expect(blockIsComplete(main, ledger, computeDoneExercises(a, ledger))).toBe(true);
  });

  // A rounds block only ever offers the *current* round's slots, so "every exercise
  // done" is true at the end of round 1 of 2 — which is exactly when the block is least
  // finished. The round counter is the only honest signal here.
  it("is false for a rounds block with rounds still to go, even with the round fully logged", () => {
    const d = session("D");
    const finisher = block(d, "ab-finisher");
    const loggedSets = logWholeBlock(d, "ab-finisher");
    const ledger = emptyLedger({ loggedSets, completedRounds: new Map([[finisher.key, 1]]) });
    expect(finisher.rounds).toBe(2);
    expect(blockIsComplete(finisher, ledger, computeDoneExercises(d, ledger))).toBe(false);
  });

  it("is true for a rounds block once every round is complete", () => {
    const d = session("D");
    const finisher = block(d, "ab-finisher");
    const ledger = emptyLedger({ completedRounds: new Map([[finisher.key, 2]]) });
    expect(blockIsComplete(finisher, ledger, computeDoneExercises(d, ledger))).toBe(true);
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
    // goblet-squat is a ranged-set prescription here (sets: [2, 3]); with nothing added
    // or logged, only the declared minimum is shown.
    expect(ctx?.shownSets).toBe(2);
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
    "split-squat": {
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
      "split-squat",
      "split-squat",
      true,
      { setNo: 1, side: "right", key: setLogKey("main", "split-squat", 1, "right") },
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

  /* No slot means every slot on offer is already logged — the strip's "All sets logged"
     state. There is no next set, so there is no side either, and `left`/`right` carry
     genuinely different loads: picking one would name a load for a set that isn't
     coming. */
  it("pre-fills nothing for a per-side exercise once there is no slot left", () => {
    expect(
      prefillFor(
        emptyLedger(),
        prefillByExercise,
        "main",
        "split-squat",
        "split-squat",
        true,
        undefined,
      ),
    ).toEqual({});
  });
});

describe("upNextForExerciseAt", () => {
  it("falls back when nothing is scheduled", () => {
    expect(upNextForExerciseAt(emptyLedger(), {}, undefined)).toEqual(UP_NEXT_FALLBACK);
    expect(UP_NEXT_FALLBACK.isLast).toBe(true);
  });

  it("names the exercise and its sets count", () => {
    const d = session("D");
    const row = exercise(block(d, "main"), "goblet-squat");
    const at = exerciseAt(d, emptyLedger(), "main:goblet-squat");
    const upNext = upNextForExerciseAt(emptyLedger(), {}, at);
    expect(upNext.label).toBe(row.name);
    expect(upNext.context).toContain("sets");
    expect(upNext.isLast).toBe(false);
  });

  it("carries the load the next exercise's first set would pre-fill", () => {
    const a = session("A");
    const at = exerciseAt(a, emptyLedger(), "main:db-floor-press");
    const upNext = upNextForExerciseAt(emptyLedger(), prefill("db-floor-press", { none: 8 }), at);
    expect(upNext.context).toBe("3 sets");
    expect(upNext.figures).toEqual([
      { kind: "reps", text: "8–12 reps" },
      { kind: "load", text: "8 kg total" },
    ]);
  });

  it("takes the first unlogged side's pre-fill for a per-side exercise", () => {
    const c = session("C");
    const at = exerciseAt(c, emptyLedger(), "main:split-squat");
    const both = prefill("split-squat", { left: 6, right: 10 });
    const firstSide = upNextForExerciseAt(emptyLedger(), both, at);
    expect(firstSide.context).toBe("2 sets per side");
    expect(firstSide.figures).toContainEqual({ kind: "load", text: "6 kg total" });

    // Left already logged, so the card describes the right side's slot instead.
    const leftDone = emptyLedger({
      loggedSets: new Map([[setLogKey("main", "split-squat", 1, "left"), { reps: 10 }]]),
    });
    expect(upNextForExerciseAt(leftDone, both, at).figures).toContainEqual({
      kind: "load",
      text: "10 kg total",
    });
  });

  it("omits the load figure entirely for a movement with no pre-fill weight", () => {
    const a = session("A");
    const at = exerciseAt(a, emptyLedger(), "core:side-plank");
    const upNext = upNextForExerciseAt(emptyLedger(), {}, at);
    expect(upNext.figures.some((f) => f.kind === "load")).toBe(false);
  });

  /* A rounds block counts rounds, not sets — the between-rounds overlay
     (`startNextRound`) is built by this function, and the strip it hands off to on
     dismissal says "Round 2 of 2". A sets count there would be both useless in a circuit
     and a contradiction of the screen behind it. */
  it("counts rounds, not sets, when the coming exercise is in a rounds block", () => {
    const d = session("D");
    const afterRoundOne = emptyLedger({ completedRounds: new Map([["ab-finisher", 1]]) });
    const at = exerciseAt(d, afterRoundOne, "ab-finisher:dead-bug");
    const upNext = upNextForExerciseAt(afterRoundOne, {}, at);
    expect(upNext.label).toBe("Dead bug");
    expect(upNext.context).toBe("Round 2 of 2");
    expect(upNext.figures).toEqual([{ kind: "reps", text: "16 reps" }]);
  });

  /* `reverse-crunch` (reps) swapped for `front-plank` (time) is the fixture's real
     cross-`type` substitute, and the plan never says how long to hold it *here* — so the
     performed exercise carries no target of its own type at all. `formatTarget` throws on
     exactly that, and this function runs inside the rest overlay, where a throw takes the
     whole session down mid-workout. The reps/time figure is dropped instead. */
  it("drops the reps figure rather than throwing for a substitute across a type boundary", () => {
    const contract = fixtureContract();
    const d = session("D");
    const crunch = exercise(block(d, "ab-finisher"), "reverse-crunch");
    const plank = resolveSubstitute(contract.exercises, contract.loads, crunch, "front-plank");
    if (!plank) throw new Error("fixture no longer declares front-plank as a substitute");
    expect(plank.durationSec).toBeUndefined();

    const swapped = emptyLedger({
      substitutedExercises: new Map([["ab-finisher:reverse-crunch", plank]]),
    });
    const at = exerciseAt(d, swapped, "ab-finisher:reverse-crunch");
    const upNext = upNextForExerciseAt(swapped, {}, at);
    expect(upNext.label).toBe("Front plank");
    expect(upNext.figures).toEqual([]);
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
    expect(upNext.context).toBe("Set 2 of 3");
    expect(upNext.isLast).toBe(false);
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
    const upNext = upNextForSetLogged(
      d,
      emptyLedger(),
      new Set(),
      prefill("db-floor-press", { none: 8 }),
      context,
      undefined,
    );
    expect(upNext.label).toBe(nextRow.name);
    expect(upNext.figures).toContainEqual({ kind: "load", text: "8 kg total" });
    expect(upNext.isLast).toBe(false);
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
    expect(upNext.isLast).toBe(true);
  });
});
