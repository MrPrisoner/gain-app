/**
 * The log strip's numeric arithmetic. It lived in `LogStrip.svelte` where no unit test
 * could reach it, which mattered because it computes `weight_kg` — a stated invariant,
 * and a number the export hands to a reviewing AI that trusts it and does not check it.
 */

import { describe, expect, it } from "vitest";
import { parseNumericField, stepValue } from "../../src/lib/session/stepper";

describe("stepValue", () => {
  it("steps a whole number up and down", () => {
    expect(stepValue("10", 1)).toBe("11");
    expect(stepValue("10", -1)).toBe("9");
  });

  it("never goes below zero", () => {
    expect(stepValue("0", -1)).toBe("0");
    expect(stepValue("0.5", -5)).toBe("0");
  });

  it("steps from zero when the field is empty or unparseable", () => {
    expect(stepValue("", 1)).toBe("1");
    expect(stepValue("", -1)).toBe("0");
    expect(stepValue("abc", 5)).toBe("5");
  });

  it("keeps a half-kilogram pre-fill rather than rounding it away", () => {
    // 1.25 kg plates on a paired lift produce odd totals; the step must preserve them.
    expect(stepValue("2.5", 1)).toBe("3.5");
    expect(stepValue("2.5", -1)).toBe("1.5");
  });

  it("sheds float noise instead of the value", () => {
    // 0.1 + 0.2 arithmetic is exactly what would otherwise reach weight_kg.
    expect(stepValue("0.1", 0.2)).toBe("0.3");
    expect(stepValue("2.5", 0.1)).toBe("2.6");
  });

  it("reads a leading number out of a partially-typed field", () => {
    expect(stepValue("12kg", 1)).toBe("13");
  });
});

describe("parseNumericField", () => {
  it("returns undefined for an empty or whitespace field", () => {
    // Not 0: a set logged with no weight is bodyweight, a set logged at 0 kg is a claim.
    expect(parseNumericField("")).toBeUndefined();
    expect(parseNumericField("   ")).toBeUndefined();
  });

  it("returns undefined rather than NaN for anything unparseable", () => {
    expect(parseNumericField("abc")).toBeUndefined();
    expect(parseNumericField("12kg")).toBeUndefined();
    expect(parseNumericField("Infinity")).toBeUndefined();
  });

  it("parses integers and decimals", () => {
    expect(parseNumericField("12")).toBe(12);
    expect(parseNumericField("2.5")).toBe(2.5);
    expect(parseNumericField(" 8 ")).toBe(8);
  });
});
