// tests/session/session-view.test.ts
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import {
  exerciseMetrics,
  formatLoggedSet,
  formatRange,
  formatRepsOrDuration,
  formatSlotContext,
  formatSlotLabel,
  formatTarget,
  nextUnloggedSlot,
  resolveLoad,
  resolveSession,
  restBetweenRounds,
  restForSet,
  sessionMetrics,
  setLogKey,
  setMetrics,
  setSlotsFor,
  visibleSetCount,
} from "../../src/lib/session/session-view";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-dumbbell-v1.md", ROOT), "utf8");

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
    expect(session?.name).toBe("Full Body Strength + Abs");
    const warmup = session?.blocks.find((b) => b.key === "warmup");
    expect(warmup?.tracking).toBe("checkoff");
    expect(warmup?.type).toBe("sequence");
    const march = warmup?.exercises.find((e) => e.slug === "march-in-place");
    expect(march?.durationSec).toBe(60);
  });

  it("resolves a per-side exercise from the catalogue", () => {
    const session = resolveSession(fixtureContract(), "A");
    const main = session?.blocks.find((b) => b.key === "main");
    const row = main?.exercises.find((e) => e.slug === "supported-one-arm-row");
    expect(row?.perSide).toBe(true);
    expect(row?.sets).toBe(3);
    expect(row?.reps).toEqual([10, 12]);
    // Prescription overrides catalogue rest_sec.
    expect(row?.restSec).toBe(30);
    expect(row?.note).toContain("Support free hand on thigh");
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
    expect(crunch?.condition).toContain("reproduces familiar back symptoms");
    expect(crunch?.substitutes).toEqual(["dead-bug", "front-plank"]);
  });

  it("resolves a substitute-only catalogue entry by slug", () => {
    const contract = fixtureContract();
    const session = resolveSession(contract, "B");
    const main = session?.blocks.find((b) => b.key === "main");
    const triceps = main?.exercises.find((e) => e.slug === "overhead-triceps-extension");
    expect(triceps?.substitutes).toEqual(["lying-triceps-extension"]);
  });
});

describe("resolveExercise — load resolution (UI-DECISIONS §3)", () => {
  it("resolves a weighted exercise's load configuration onto the exercise", () => {
    const session = resolveSession(fixtureContract(), "A");
    const main = session?.blocks.find((b) => b.key === "main");
    const squat = main?.exercises.find((e) => e.slug === "goblet-squat");
    expect(squat?.load?.ref).toBe("heavy");
    expect(squat?.load?.label).toBe("Heavy configuration");
    expect(squat?.load?.defaultKg).toBe(6);
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
    const def = contract.exercises.find((e) => e.id === "supported-one-arm-row");
    delete def?.load;
    const main = contract.sessions.find((s) => s.key === "A")?.blocks.find((b) => b.key === "main");
    const rx = main?.exercises.find((e) => e.id === "supported-one-arm-row");
    delete rx?.load;

    const session = resolveSession(contract, "A");
    const row = session?.blocks
      .find((b) => b.key === "main")
      ?.exercises.find((e) => e.slug === "supported-one-arm-row");
    expect(row?.loadRef).toBeUndefined();
    expect(row?.load).toBeUndefined();
  });
});

describe("resolveLoad", () => {
  it("resolves a declared load ref", () => {
    const load = resolveLoad(fixtureContract(), "heavy");
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
    expect(endOnly.some((m) => m.key === "energy_after")).toBe(true);
    expect(nextMorningOnly.some((m) => m.key === "symptoms_next_morning")).toBe(true);
    expect(endOnly.some((m) => m.key === "symptoms_next_morning")).toBe(false);
  });

  it("returns set and exercise metrics unfiltered", () => {
    const contract = fixtureContract();
    expect(setMetrics(contract).some((m) => m.key === "set_symptom")).toBe(true);
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
    const session = resolveSession(fixtureContract(), "B");
    const main = session?.blocks.find((b) => b.key === "main");
    const lateralRaise = main?.exercises.find((e) => e.slug === "lateral-raise");
    expect(lateralRaise?.sets).toEqual([2, 3]);
    expect(lateralRaise && formatTarget(lateralRaise)).toBe("2–3 × 10–15");
  });

  it("formats a fixed single (no ranges anywhere) plainly", () => {
    const session = resolveSession(fixtureContract(), "A");
    const warmup = session?.blocks.find((b) => b.key === "warmup");
    const squat = warmup?.exercises.find((e) => e.slug === "bodyweight-squat");
    expect(squat?.sets).toBe(1);
    expect(squat?.reps).toBe(8);
    expect(squat?.perSide).toBe(false);
    expect(squat && formatTarget(squat)).toBe("1 × 8");
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
    expect(squat && formatRepsOrDuration(squat)).toBe("8");
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
