import { describe, expect, it } from "vitest";
import {
  extendRest,
  restPhaseAt,
  restSpecFrom,
  startRestTimer,
} from "../../src/lib/session/rest-timer";

describe("restSpecFrom", () => {
  it("treats a bare integer as a fixed rest (min === max)", () => {
    expect(restSpecFrom(45)).toEqual({ minS: 45, maxS: 45 });
  });

  it("carries a [min, max] range through unchanged", () => {
    expect(restSpecFrom([60, 90])).toEqual({ minS: 60, maxS: 90 });
  });
});

describe("restPhaseAt", () => {
  it("counts down during a fixed rest", () => {
    const spec = restSpecFrom(45);
    const state = startRestTimer(spec, 0);
    expect(restPhaseAt(state, 10_000)).toEqual({ phase: "counting_down", remainingS: 35 });
  });

  it("goes straight to over_band once a fixed rest's target is reached", () => {
    const spec = restSpecFrom(45);
    const state = startRestTimer(spec, 0);
    expect(restPhaseAt(state, 45_000)).toEqual({ phase: "over_band", elapsedS: 45, bandMaxS: 45 });
    expect(restPhaseAt(state, 50_000)).toEqual({ phase: "over_band", elapsedS: 50, bandMaxS: 45 });
  });

  it("counts down to the minimum of a ranged rest", () => {
    const spec = restSpecFrom([60, 90]);
    const state = startRestTimer(spec, 0);
    expect(restPhaseAt(state, 20_000)).toEqual({ phase: "counting_down", remainingS: 40 });
  });

  it("counts up inside the shaded band once the minimum is reached", () => {
    const spec = restSpecFrom([60, 90]);
    const state = startRestTimer(spec, 0);
    expect(restPhaseAt(state, 74_000)).toEqual({
      phase: "in_band",
      elapsedS: 74,
      bandMinS: 60,
      bandMaxS: 90,
    });
  });

  it("moves to over_band once the maximum of a ranged rest is passed", () => {
    const spec = restSpecFrom([60, 90]);
    const state = startRestTimer(spec, 0);
    expect(restPhaseAt(state, 95_000)).toEqual({ phase: "over_band", elapsedS: 95, bandMaxS: 90 });
  });

  it("is already in_band at exactly the minimum of a ranged rest", () => {
    const spec = restSpecFrom([60, 90]);
    const state = startRestTimer(spec, 0);
    expect(restPhaseAt(state, 60_000)).toEqual({
      phase: "in_band",
      elapsedS: 60,
      bandMinS: 60,
      bandMaxS: 90,
    });
  });

  it("is already over_band at exactly the maximum of a ranged rest", () => {
    const spec = restSpecFrom([60, 90]);
    const state = startRestTimer(spec, 0);
    expect(restPhaseAt(state, 90_000)).toEqual({ phase: "over_band", elapsedS: 90, bandMaxS: 90 });
  });
});

describe("extendRest", () => {
  it("adding 30 seconds pushes the min and max targets back by 30s", () => {
    const spec = restSpecFrom([60, 90]);
    const state = startRestTimer(spec, 0);
    const extended = extendRest(state, 30);
    // At 74s elapsed we were "in_band" against a 60-90 target; against the extended
    // 90-120 target the same elapsed time is still counting down.
    expect(restPhaseAt(extended, 74_000)).toEqual({ phase: "counting_down", remainingS: 16 });
  });
});
