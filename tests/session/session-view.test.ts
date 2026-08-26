// tests/session/session-view.test.ts
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import {
  exerciseMetrics,
  formatLoggedSet,
  formatRange,
  formatRepsOrDuration,
  formatRepsOrDurationOrDash,
  formatSlotContext,
  formatSlotLabel,
  formatTarget,
  formatTargetOrSets,
  highestLoggedSetNo,
  nextExerciseKey,
  nextUnloggedSlot,
  resolveLoad,
  resolveSession,
  resolveSubstitute,
  restBetweenRounds,
  restForSet,
  sessionMetrics,
  setLogKey,
  setMetrics,
  setSlotsFor,
  summariseLoggedSets,
  trackedExerciseKeys,
  upNextSlotParts,
  visibleSetCount,
} from "../../src/lib/session/session-view";
import type { ResolvedExercise } from "../../src/lib/session/session-view";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");

function fixtureContract() {
  const parsed = parsePlanDocument(fixtureMd);
  if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
  return parsed.contract;
}

describe("resolveSession", () => {
  it("returns undefined for an unknown session key", () => {
    expect(resolveSession(fixtureContract(), "Z")).toBeUndefined();
  });

  it("resolves session A with the warm-up block marked checkoff", () => {
    const session = resolveSession(fixtureContract(), "A");
    expect(session?.name).toBe("Squat, Press & Row");
    const warmup = session?.blocks.find((b) => b.key === "warmup");
    expect(warmup?.tracking).toBe("checkoff");
    expect(warmup?.type).toBe("sequence");
    const march = warmup?.exercises.find((e) => e.slug === "march-in-place");
    expect(march?.durationSec).toBe(60);
  });

  it("resolves a per-side exercise from the catalogue", () => {
    // `split-squat` (session C's main block) is the fixture's per-side, loaded movement —
    // the stand-in for the old fixture's supported one-arm row.
    const session = resolveSession(fixtureContract(), "C");
    const main = session?.blocks.find((b) => b.key === "main");
    const row = main?.exercises.find((e) => e.slug === "split-squat");
    expect(row?.perSide).toBe(true);
    expect(row?.sets).toBe(2);
    expect(row?.reps).toEqual([10, 12]);
    // No prescription-level rest_sec override for split-squat, so it falls through to
    // the catalogue's ranged rest.
    expect(row?.restSec).toEqual([60, 90]);
    expect(row?.note).toContain("Staggered stance");
  });

  it("defaults sets to 1 when the prescription omits it", () => {
    const session = resolveSession(fixtureContract(), "D");
    const finisher = session?.blocks.find((b) => b.key === "ab-finisher");
    const deadBug = finisher?.exercises.find((e) => e.slug === "dead-bug");
    expect(deadBug?.sets).toBe(1);
  });

  it("resolves a rounds block with its between-round rest", () => {
    const session = resolveSession(fixtureContract(), "D");
    const finisher = session?.blocks.find((b) => b.key === "ab-finisher");
    expect(finisher?.type).toBe("rounds");
    expect(finisher?.rounds).toBe(2);
    expect(finisher?.restSec).toEqual([45, 60]);
  });

  it("resolves a conditional exercise with its substitutes", () => {
    const session = resolveSession(fixtureContract(), "D");
    const finisher = session?.blocks.find((b) => b.key === "ab-finisher");
    const crunch = finisher?.exercises.find((e) => e.slug === "reverse-crunch");
    expect(crunch?.conditional).toBe(true);
    expect(crunch?.condition).toContain("reproduce your familiar hip or lower-back symptoms");
    expect(crunch?.substitutes).toEqual(["dead-bug", "front-plank"]);
  });

  it("resolves a substitute-only catalogue entry by slug", () => {
    const contract = fixtureContract();
    const session = resolveSession(contract, "B");
    const main = session?.blocks.find((b) => b.key === "main");
    const press = main?.exercises.find((e) => e.slug === "db-shoulder-press");
    expect(press?.substitutes).toEqual(["seated-floor-shoulder-press"]);
  });
});

describe("resolveExercise — load resolution (UI-DECISIONS §3)", () => {
  it("resolves a weighted exercise's load configuration onto the exercise", () => {
    const session = resolveSession(fixtureContract(), "A");
    const main = session?.blocks.find((b) => b.key === "main");
    const squat = main?.exercises.find((e) => e.slug === "goblet-squat");
    expect(squat?.load?.ref).toBe("goblet");
    expect(squat?.load?.label).toBe("Goblet — single dumbbell");
    expect(squat?.load?.defaultKg).toBe(10);
    expect(squat?.load?.isBodyweight).toBe(false);
    expect(squat?.load?.note).toBeTruthy();
  });

  it("resolves a bodyweight exercise's load configuration with isBodyweight true and no default_kg", () => {
    const session = resolveSession(fixtureContract(), "A");
    const warmup = session?.blocks.find((b) => b.key === "warmup");
    const squat = warmup?.exercises.find((e) => e.slug === "bodyweight-squat");
    expect(squat?.load?.ref).toBe("bodyweight");
    expect(squat?.load?.isBodyweight).toBe(true);
    expect(squat?.load?.defaultKg).toBeUndefined();
  });

  it("leaves load undefined when the exercise declares no load ref at all", () => {
    // Every occurrence of every exercise in the fixture happens to set a `load` ref
    // somewhere (catalogue or prescription), so this strips one by hand to exercise
    // the no-ref path.
    const contract = structuredClone(fixtureContract());
    const def = contract.exercises.find((e) => e.id === "split-squat");
    delete def?.load;
    const main = contract.sessions.find((s) => s.key === "C")?.blocks.find((b) => b.key === "main");
    const rx = main?.exercises.find((e) => e.id === "split-squat");
    delete rx?.load;

    const session = resolveSession(contract, "C");
    const row = session?.blocks
      .find((b) => b.key === "main")
      ?.exercises.find((e) => e.slug === "split-squat");
    expect(row?.loadRef).toBeUndefined();
    expect(row?.load).toBeUndefined();
  });
});

describe("resolveLoad", () => {
  it("resolves a declared load ref", () => {
    const load = resolveLoad(fixtureContract(), "goblet");
    expect(load?.label).toBeTruthy();
  });

  it("returns undefined for an undefined ref (bodyweight movements)", () => {
    expect(resolveLoad(fixtureContract(), undefined)).toBeUndefined();
  });
});

describe("metric selectors", () => {
  it("filters session metrics by prompt_when", () => {
    const contract = fixtureContract();
    const endOnly = sessionMetrics(contract, "end");
    const nextMorningOnly = sessionMetrics(contract, "next_morning");
    expect(endOnly.some((m) => m.key === "symptoms_during")).toBe(true);
    expect(nextMorningOnly.some((m) => m.key === "symptoms_next_morning")).toBe(true);
    expect(endOnly.some((m) => m.key === "symptoms_next_morning")).toBe(false);
  });

  it("returns set and exercise metrics unfiltered", () => {
    const contract = fixtureContract();
    expect(setMetrics(contract).some((m) => m.key === "symptoms_during")).toBe(true);
    expect(exerciseMetrics(contract).some((m) => m.key === "rir")).toBe(true);
  });
});

describe("visibleSetCount", () => {
  it("shows only the minimum of a ranged set with none added", () => {
    expect(visibleSetCount([2, 3], 0)).toEqual({ shown: 2, canAddMore: true });
  });

  it("shows the added optional set, capped at the max", () => {
    expect(visibleSetCount([2, 3], 1)).toEqual({ shown: 3, canAddMore: false });
    expect(visibleSetCount([2, 3], 5)).toEqual({ shown: 3, canAddMore: false });
  });

  it("a fixed set count never offers to add more", () => {
    expect(visibleSetCount(3, 0)).toEqual({ shown: 3, canAddMore: false });
  });
});

describe("restForSet / restBetweenRounds", () => {
  it("never rests inside a checkoff block", () => {
    const session = resolveSession(fixtureContract(), "A");
    const warmup = session?.blocks.find((b) => b.key === "warmup");
    const exercise = warmup?.exercises[0];
    expect(warmup && exercise && restForSet(warmup, exercise)).toBeUndefined();
  });

  it("never rests per-set inside a rounds block, but does between rounds", () => {
    const session = resolveSession(fixtureContract(), "D");
    const finisher = session?.blocks.find((b) => b.key === "ab-finisher");
    const exercise = finisher?.exercises[0];
    expect(finisher && exercise && restForSet(finisher, exercise)).toBeUndefined();
    expect(finisher && restBetweenRounds(finisher, 1)).toEqual([45, 60]);
    // No rest after the final round.
    expect(finisher && restBetweenRounds(finisher, 2)).toBeUndefined();
  });

  it("rests per-set inside a plain sequence block when the exercise declares it", () => {
    const session = resolveSession(fixtureContract(), "A");
    const main = session?.blocks.find((b) => b.key === "main");
    const squat = main?.exercises.find((e) => e.slug === "goblet-squat");
    expect(main && squat && restForSet(main, squat)).toEqual([75, 90]);
  });
});

describe("setLogKey", () => {
  it("keys by block, exercise, set number and side", () => {
    expect(setLogKey("main", "goblet-squat", 2)).toBe("main:goblet-squat:2:");
    expect(setLogKey("main", "side-plank", 2, "left")).toBe("main:side-plank:2:left");
  });

  // Regression (ca63250): the same exercise slug appears in more than one block of a
  // session, and a rounds block reuses `set_no` per round — dropping either from the key
  // collapses distinct sets onto one another.
  it("never collapses the same slug in two different blocks", () => {
    expect(setLogKey("main", "dead-bug", 1)).not.toBe(setLogKey("core", "dead-bug", 1));
  });
});

describe("setSlotsFor", () => {
  const block = { key: "main", type: "sequence" as const };
  const roundsBlock = { key: "ab-finisher", type: "rounds" as const };

  it("draws one slot per set for a plain exercise", () => {
    const slots = setSlotsFor(
      block,
      { slug: "goblet-squat", perSide: false },
      {
        shownSets: 3,
        currentRound: 1,
      },
    );
    expect(slots.map((s) => s.setNo)).toEqual([1, 2, 3]);
    expect(slots.every((s) => s.side === undefined)).toBe(true);
    expect(slots[0]?.key).toBe("main:goblet-squat:1:");
  });

  // UI-DECISIONS §6: one ledger row per side, in the order performed — left then right
  // within a set, not all the lefts and then all the rights.
  it("draws left then right within each set for a per_side exercise", () => {
    const slots = setSlotsFor(
      block,
      { slug: "side-plank", perSide: true },
      {
        shownSets: 2,
        currentRound: 1,
      },
    );
    expect(slots.map((s) => `${s.setNo}${s.side}`)).toEqual(["1left", "1right", "2left", "2right"]);
  });

  // UI-DECISIONS §6: a rounds block is not repeated per round; `set_no` *is* the round.
  it("offers only the current round inside a rounds block, whatever shownSets says", () => {
    const slots = setSlotsFor(
      roundsBlock,
      { slug: "dead-bug", perSide: false },
      {
        shownSets: 4,
        currentRound: 2,
      },
    );
    expect(slots).toHaveLength(1);
    expect(slots[0]?.setNo).toBe(2);
  });

  it("draws nothing when no sets are shown", () => {
    expect(
      setSlotsFor(block, { slug: "x", perSide: false }, { shownSets: 0, currentRound: 1 }),
    ).toEqual([]);
  });
});

describe("nextUnloggedSlot", () => {
  const slots = setSlotsFor(
    { key: "main", type: "sequence" },
    { slug: "row", perSide: true },
    {
      shownSets: 2,
      currentRound: 1,
    },
  );

  it("is the first slot when nothing is logged", () => {
    expect(nextUnloggedSlot(slots, new Set())?.key).toBe("main:row:1:left");
  });

  it("skips past logged slots in performed order", () => {
    const logged = new Set(["main:row:1:left", "main:row:1:right"]);
    expect(nextUnloggedSlot(slots, logged)?.key).toBe("main:row:2:left");
  });

  it("is undefined once every offered slot is logged", () => {
    expect(nextUnloggedSlot(slots, new Set(slots.map((s) => s.key)))).toBeUndefined();
  });
});

describe("formatSlotContext / formatSlotLabel", () => {
  const sequence = { type: "sequence" as const, rounds: undefined };
  const rounds = { type: "rounds" as const, rounds: 2 };
  const slot = (setNo: number, side?: "left" | "right") => ({ setNo, side, key: "k" });

  it("counts sets in a sequence block", () => {
    expect(formatSlotContext(sequence, slot(2), 3)).toBe("Set 2 of 3");
  });

  it("names the side of a per_side slot", () => {
    expect(formatSlotContext(sequence, slot(1, "right"), 2)).toBe("Set 1 of 2 — right");
  });

  it("counts rounds, not sets, in a rounds block", () => {
    expect(formatSlotContext(rounds, slot(1), 1)).toBe("Round 1 of 2");
  });

  it("labels ledger rows by set number, or round, with a side initial", () => {
    expect(formatSlotLabel(sequence, slot(2))).toBe("2");
    expect(formatSlotLabel(sequence, slot(2, "left"))).toBe("2 L");
    expect(formatSlotLabel(rounds, slot(1))).toBe("Round 1");
  });
});

describe("upNextSlotParts", () => {
  const sequence = { type: "sequence" as const, rounds: undefined };
  const rounds = { type: "rounds" as const, rounds: 2 };
  const slot = (setNo: number, side?: "left" | "right") => ({ setNo, side, key: "k" });

  it("names the next set, its rep figure and its load figure — UI-DECISIONS §4's example", () => {
    const session = resolveSession(fixtureContract(), "A");
    const main = session?.blocks.find((b) => b.key === "main");
    const squat = main?.exercises.find((e) => e.slug === "goblet-squat");
    expect(squat && upNextSlotParts(sequence, slot(3), 3, squat, 12)).toEqual({
      context: "Set 3 of 3",
      figures: [
        { kind: "reps", text: "8–12 reps" },
        { kind: "load", text: "12 kg total" },
      ],
    });
  });

  it("omits the load figure when there is no weight to show", () => {
    const session = resolveSession(fixtureContract(), "A");
    const main = session?.blocks.find((b) => b.key === "main");
    const squat = main?.exercises.find((e) => e.slug === "goblet-squat");
    expect(squat && upNextSlotParts(sequence, slot(1), 3, squat)).toEqual({
      context: "Set 1 of 3",
      figures: [{ kind: "reps", text: "8–12 reps" }],
    });
  });

  it("names the side of a per_side slot", () => {
    const session = resolveSession(fixtureContract(), "A");
    const core = session?.blocks.find((b) => b.key === "core");
    const sidePlank = core?.exercises.find((e) => e.slug === "side-plank");
    expect(sidePlank && upNextSlotParts(sequence, slot(1, "right"), 2, sidePlank)).toEqual({
      context: "Set 1 of 2 — right",
      figures: [{ kind: "time", text: "20–40 sec" }],
    });
  });

  it("counts rounds, not sets, in a rounds block", () => {
    const session = resolveSession(fixtureContract(), "A");
    const main = session?.blocks.find((b) => b.key === "main");
    const squat = main?.exercises.find((e) => e.slug === "goblet-squat");
    expect(squat && upNextSlotParts(rounds, slot(1), 1, squat)).toEqual({
      context: "Round 1 of 2",
      figures: [{ kind: "reps", text: "8–12 reps" }],
    });
  });
});

describe("formatLoggedSet", () => {
  it("renders reps and total load", () => {
    expect(formatLoggedSet({ reps: 11, weightKg: 12 })).toBe("11 · 12 kg");
  });

  it("renders reps alone for a bodyweight movement", () => {
    expect(formatLoggedSet({ reps: 10 })).toBe("10");
  });

  it("renders a held duration", () => {
    expect(formatLoggedSet({ durationS: 30 })).toBe("30 sec");
  });

  it("says something rather than nothing when a set carries no figures", () => {
    expect(formatLoggedSet({ difficulty: "hard" })).toBe("Logged");
  });

  it("renders a zero rather than dropping it", () => {
    expect(formatLoggedSet({ reps: 0, weightKg: 0 })).toBe("0 · 0 kg");
  });
});

describe("formatRange", () => {
  it("renders a fixed value as-is", () => {
    expect(formatRange(8)).toBe("8");
  });

  it("renders a range with an en dash, not a hyphen", () => {
    expect(formatRange([8, 12])).toBe("8–12");
    expect(formatRange([8, 12])).toContain("–");
  });

  it("appends a unit after a range", () => {
    expect(formatRange([20, 40], "sec")).toBe("20–40 sec");
  });
});

describe("formatTarget", () => {
  it("formats a fixed-set, ranged-reps exercise as `sets × reps`", () => {
    const session = resolveSession(fixtureContract(), "A");
    const main = session?.blocks.find((b) => b.key === "main");
    const squat = main?.exercises.find((e) => e.slug === "goblet-squat");
    expect(squat && formatTarget(squat)).toBe("3 × 8–12");
  });

  it("formats a per-side, ranged-duration exercise with the per-side suffix", () => {
    const session = resolveSession(fixtureContract(), "A");
    const core = session?.blocks.find((b) => b.key === "core");
    const sidePlank = core?.exercises.find((e) => e.slug === "side-plank");
    expect(sidePlank?.perSide).toBe(true);
    expect(sidePlank && formatTarget(sidePlank)).toBe("2 × 20–40 sec per side");
  });

  it("formats a ranged-set exercise as `min–max × reps`", () => {
    const session = resolveSession(fixtureContract(), "D");
    const main = session?.blocks.find((b) => b.key === "main");
    const squat = main?.exercises.find((e) => e.slug === "goblet-squat");
    expect(squat?.sets).toEqual([2, 3]);
    expect(squat && formatTarget(squat)).toBe("2–3 × 12–15");
  });

  it("formats a fixed single (no ranges anywhere) plainly", () => {
    const session = resolveSession(fixtureContract(), "A");
    const warmup = session?.blocks.find((b) => b.key === "warmup");
    const squat = warmup?.exercises.find((e) => e.slug === "bodyweight-squat");
    expect(squat?.sets).toBe(1);
    expect(squat?.reps).toBe(10);
    expect(squat?.perSide).toBe(false);
    expect(squat && formatTarget(squat)).toBe("1 × 10");
  });

  it("throws rather than silently rendering `0` when the type-appropriate field is missing", () => {
    expect(() =>
      formatTarget({
        type: "reps",
        sets: 1,
        reps: undefined,
        durationSec: undefined,
        perSide: false,
      }),
    ).toThrow(/reps/);
    expect(() =>
      formatTarget({
        type: "time",
        sets: 1,
        reps: undefined,
        durationSec: undefined,
        perSide: false,
      }),
    ).toThrow(/duration_sec/);
  });
});

describe("formatRepsOrDuration", () => {
  it("formats the reps side of a checkoff item (no unit)", () => {
    const session = resolveSession(fixtureContract(), "A");
    const warmup = session?.blocks.find((b) => b.key === "warmup");
    const squat = warmup?.exercises.find((e) => e.slug === "bodyweight-squat");
    expect(squat && formatRepsOrDuration(squat)).toBe("10");
  });

  it("formats the duration side of a checkoff item with a `sec` unit", () => {
    const session = resolveSession(fixtureContract(), "A");
    const warmup = session?.blocks.find((b) => b.key === "warmup");
    const march = warmup?.exercises.find((e) => e.slug === "march-in-place");
    expect(march && formatRepsOrDuration(march)).toBe("60 sec");
  });

  // Regression: the checkoff pill site used to fall back to `?? 0` here instead of
  // sharing formatTarget's fail-fast behavior — both call sites protect the same
  // contract invariant (schema.ts:525-553) and must fail the same way, not one loudly
  // and one with a misleadingly-plausible "0 reps"/"0 sec".
  it("throws rather than silently rendering `0`, matching formatTarget's fail-fast behavior", () => {
    expect(() =>
      formatRepsOrDuration({ type: "reps", reps: undefined, durationSec: undefined }),
    ).toThrow(/reps/);
    expect(() =>
      formatRepsOrDuration({ type: "time", reps: undefined, durationSec: undefined }),
    ).toThrow(/duration_sec/);
  });
});

describe("resolveSubstitute", () => {
  /** The fixture's real conditional: `reverse-crunch` in session D's rounds block,
   * `substitutes: [dead-bug, front-plank]`. Both substitutes differ from it in a
   * property that changes how the runner renders and logs. */
  function reverseCrunch(): ResolvedExercise {
    const session = resolveSession(fixtureContract(), "D");
    const exercise = session?.blocks
      .find((b) => b.key === "ab-finisher")
      ?.exercises.find((e) => e.slug === "reverse-crunch");
    if (!exercise) throw new Error("fixture no longer prescribes reverse-crunch in session D");
    return exercise;
  }

  it("returns undefined for a slug that is not in the catalogue", () => {
    const contract = fixtureContract();
    expect(
      resolveSubstitute(contract.exercises, contract.loads, reverseCrunch(), "not-a-movement"),
    ).toBeUndefined();
  });

  it("takes catalogue identity from the substitute — including per_side the original lacks", () => {
    const contract = fixtureContract();
    const original = reverseCrunch();
    expect(original.perSide).toBe(false);

    // None of reverse-crunch's own declared substitutes (dead-bug, front-plank) are
    // per_side in this fixture, so split-squat stands in to exercise the property.
    const splitSquat = resolveSubstitute(
      contract.exercises,
      contract.loads,
      original,
      "split-squat",
    );
    expect(splitSquat?.slug).toBe("split-squat");
    expect(splitSquat?.name).toBe("Split squat");
    expect(splitSquat?.type).toBe("reps");
    // The substitute's own movement property, not the original's: a per_side substitute
    // really does want its own L/R ledger rows.
    expect(splitSquat?.perSide).toBe(true);
    expect(splitSquat?.load?.ref).toBe("bodyweight");
    expect(splitSquat?.load?.isBodyweight).toBe(true);
  });

  it("takes the targets of the occasion being replaced, not the substitute's own", () => {
    const contract = fixtureContract();
    const original = reverseCrunch();
    expect(original.reps).toBe(12);

    const deadBug = resolveSubstitute(contract.exercises, contract.loads, original, "dead-bug");
    // Session D also prescribes dead-bug at `reps: 16` in the same block — the substitute
    // must not inherit that; it is standing in for *this* occasion.
    expect(deadBug?.reps).toBe(12);
    expect(deadBug?.sets).toBe(original.sets);
    expect(deadBug?.restSec).toBe(original.restSec);
  });

  it("resolves a substitute whose load differs from the original's", () => {
    const contract = fixtureContract();
    const session = resolveSession(contract, "D");
    // `db-shoulder-press`/`seated-floor-shoulder-press` share the same combined-weight
    // load ref, so they can't exercise a load *difference*. `lying-triceps-extension`
    // (session D's main block) is conditional with `overhead-triceps-extension` as its
    // declared substitute, and the two carry different load refs — the reverse pairing
    // from the old fixture's overhead/lying relationship, but the same shape.
    const triceps = session?.blocks
      .find((b) => b.key === "main")
      ?.exercises.find((e) => e.slug === "lying-triceps-extension");
    if (!triceps) throw new Error("fixture no longer prescribes lying-triceps-extension");

    const overhead = resolveSubstitute(
      contract.exercises,
      contract.loads,
      triceps,
      "overhead-triceps-extension",
    );
    expect(overhead?.name).toBe("Overhead triceps extension");
    expect(overhead?.load?.ref).toBe("pullover-single");
    expect(overhead?.note).toContain("most likely to pull you into a lower-back arch");
    // Not a conditional exercise at all — the swap came from the deviation sheet.
    expect(overhead?.conditional).toBe(false);
  });

  it("leaves the target unset when the substitute's type differs from the original's", () => {
    const contract = fixtureContract();
    const original = reverseCrunch();
    const plank = resolveSubstitute(contract.exercises, contract.loads, original, "front-plank");

    // A reps movement replaced by a timed one: the plan declares `front-plank` as a valid
    // substitute but never says how long to hold it *here*, so nothing is invented.
    expect(plank?.type).toBe("time");
    expect(plank?.reps).toBeUndefined();
    expect(plank?.durationSec).toBeUndefined();
    expect(plank?.sets).toBe(original.sets);
  });

  it("does not re-ask the condition it was chosen to answer", () => {
    const contract = fixtureContract();
    // `floor-pullover` is itself `conditional: true` in the catalogue (and, per its own
    // condition, declares no substitute of its own — drop it rather than swap it).
    expect(contract.exercises.find((e) => e.id === "floor-pullover")?.conditional).toBe(true);

    const pullover = resolveSubstitute(
      contract.exercises,
      contract.loads,
      reverseCrunch(),
      "floor-pullover",
    );
    expect(pullover?.conditional).toBe(false);
    expect(pullover?.condition).toBeUndefined();
    expect(pullover?.substitutes).toEqual([]);
  });
});

describe("formatTargetOrSets / formatRepsOrDurationOrDash", () => {
  const untargeted = {
    type: "time" as const,
    sets: 2,
    reps: undefined,
    durationSec: undefined,
    perSide: false,
  };

  it("formats a normal exercise exactly as formatTarget does", () => {
    const session = resolveSession(fixtureContract(), "A");
    const squat = session?.blocks
      .find((b) => b.key === "main")
      ?.exercises.find((e) => e.slug === "goblet-squat");
    expect(squat && formatTargetOrSets(squat)).toBe("3 × 8–12");
    expect(squat && formatRepsOrDurationOrDash(squat)).toBe("8–12");
  });

  it("falls back to the sets count where formatTarget would throw", () => {
    expect(() => formatTarget(untargeted)).toThrow();
    expect(formatTargetOrSets(untargeted)).toBe("2 sets");
    expect(formatTargetOrSets({ ...untargeted, sets: 1 })).toBe("1 set");
    expect(formatTargetOrSets({ ...untargeted, sets: [2, 3] })).toBe("2–3 sets");
    expect(formatTargetOrSets({ ...untargeted, perSide: true })).toBe("2 sets per side");
  });

  it("renders an em dash rather than a fabricated zero in a ledger cell", () => {
    expect(formatRepsOrDurationOrDash(untargeted)).toBe("—");
  });
});

describe("summariseLoggedSets", () => {
  it("joins one figure per set and collapses a shared load", () => {
    expect(
      summariseLoggedSets([
        { reps: 11, weightKg: 6 },
        { reps: 10, weightKg: 6 },
        { reps: 10, weightKg: 6 },
      ]),
    ).toBe("11 · 10 · 10 at 6 kg");
  });

  it("shows a load range when the load changed mid-exercise", () => {
    expect(
      summariseLoggedSets([
        { reps: 11, weightKg: 8 },
        { reps: 8, weightKg: 6 },
      ]),
    ).toBe("11 · 8 at 6–8 kg");
  });

  it("omits the load for a bodyweight movement", () => {
    expect(summariseLoggedSets([{ reps: 10 }, { reps: 9 }])).toBe("10 · 9");
  });

  it("summarises held durations", () => {
    expect(summariseLoggedSets([{ durationS: 30 }, { durationS: 25 }])).toBe("30 sec · 25 sec");
  });

  it("says Logged when no set carried a figure at all", () => {
    expect(summariseLoggedSets([{ difficulty: "hard" }, { difficulty: "easy" }])).toBe("Logged");
  });

  it("keeps a zero rather than dropping it", () => {
    expect(summariseLoggedSets([{ reps: 0, weightKg: 0 }])).toBe("0 at 0 kg");
  });

  it("says so rather than rendering an empty string when nothing is logged", () => {
    expect(summariseLoggedSets([])).toBe("Nothing logged");
  });
});

describe("trackedExerciseKeys / nextExerciseKey", () => {
  const session = () => {
    const resolved = resolveSession(fixtureContract(), "A");
    if (!resolved) throw new Error("fixture no longer has session A");
    return resolved;
  };

  it("lists every loggable exercise in prescribed order, excluding checkoff blocks", () => {
    const keys = trackedExerciseKeys(session());
    expect(keys.every((key) => !key.startsWith("warmup:"))).toBe(true);
    expect(keys[0]).toBe("main:goblet-squat");
    expect(keys).toContain("core:side-plank");
    // Order follows blocks then exercises, not the order they happen to be logged in.
    expect(keys.indexOf("main:goblet-squat")).toBeLessThan(keys.indexOf("core:side-plank"));
  });

  it("opens the first exercise when nothing is done and no current key is given", () => {
    expect(nextExerciseKey(session(), new Set())).toBe("main:goblet-squat");
  });

  it("advances to the next not-yet-done exercise after the current one", () => {
    const keys = trackedExerciseKeys(session());
    const done = new Set([keys[0]!, keys[1]!]);
    expect(nextExerciseKey(session(), done, keys[0])).toBe(keys[2]);
  });

  it("skips over exercises already done, in order", () => {
    const keys = trackedExerciseKeys(session());
    const done = new Set([keys[0]!, keys[1]!, keys[2]!]);
    expect(nextExerciseKey(session(), done, keys[0])).toBe(keys[3]);
  });

  it("wraps to an exercise left unfinished earlier rather than stranding it", () => {
    const keys = trackedExerciseKeys(session());
    const last = keys[keys.length - 1]!;
    // Everything done except the second one, and the cursor is on the final exercise.
    const done = new Set(keys.filter((key) => key !== keys[1]));
    expect(nextExerciseKey(session(), done, last)).toBe(keys[1]);
  });

  it("is undefined once every exercise is finished", () => {
    const keys = trackedExerciseKeys(session());
    expect(nextExerciseKey(session(), new Set(keys), keys[0])).toBeUndefined();
  });

  it("starts from the beginning when the current key is not in this session", () => {
    expect(nextExerciseKey(session(), new Set(), "somewhere:else")).toBe("main:goblet-squat");
  });
});

describe("highestLoggedSetNo", () => {
  const logged = [
    setLogKey("main", "goblet-squat", 1),
    setLogKey("main", "goblet-squat", 2),
    setLogKey("main", "goblet-squat", 3),
    setLogKey("core", "side-plank", 2, "left"),
    setLogKey("core", "side-plank", 2, "right"),
  ];

  it("is zero when the exercise has nothing logged", () => {
    expect(highestLoggedSetNo("main", "reverse-lunge", logged)).toBe(0);
    expect(highestLoggedSetNo("main", "goblet-squat", [])).toBe(0);
  });

  it("is the highest set number logged, not the count of rows", () => {
    expect(highestLoggedSetNo("main", "goblet-squat", logged)).toBe(3);
    // Two rows (left and right), but they are one set.
    expect(highestLoggedSetNo("core", "side-plank", logged)).toBe(2);
  });

  it("never counts another block's rows for the same slug", () => {
    const both = [setLogKey("main", "dead-bug", 3), setLogKey("core", "dead-bug", 1)];
    expect(highestLoggedSetNo("core", "dead-bug", both)).toBe(1);
    expect(highestLoggedSetNo("main", "dead-bug", both)).toBe(3);
  });

  it("never counts a longer slug that merely starts with this one", () => {
    const rows = [setLogKey("main", "goblet-squat-heavy", 4)];
    expect(highestLoggedSetNo("main", "goblet-squat", rows)).toBe(0);
  });

  // `block.key` is only `nonEmptyString` in the schema, so it may contain a colon — the
  // digits guard is what stops one exercise's rows counting towards another's.
  it("is not confused by a colon inside a block key", () => {
    const rows = [setLogKey("a:b", "dead-bug", 5)];
    expect(highestLoggedSetNo("a:b", "dead-bug", rows)).toBe(5);
    expect(highestLoggedSetNo("a", "b", rows)).toBe(0);
  });
});
