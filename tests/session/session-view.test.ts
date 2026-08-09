// tests/session/session-view.test.ts
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import {
  exerciseMetrics,
  resolveLoad,
  resolveSession,
  restBetweenRounds,
  restForSet,
  sessionMetrics,
  setMetrics,
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
