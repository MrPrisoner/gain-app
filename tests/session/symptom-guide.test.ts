import { describe, expect, it } from "vitest";
import { redSymptomLevel, symptomGuideLevels } from "../../src/lib/session/symptom-guide";
import type { Safety } from "../../src/lib/contract/schema";

const fullFramework: Safety = {
  symptom_framework: [
    {
      level: "red",
      label: "Sharp, escalating — stop",
      action: "stop",
      modifications: ["Stop that exercise for today.", "Get it assessed if it persists."],
    },
    {
      level: "green",
      label: "Mild, familiar, stable — carry on",
      action: "continue",
      modifications: ["Keep monitoring set to set."],
    },
    {
      level: "yellow",
      label: "Building, or changing how you move — modify",
      action: "modify",
      modifications: ["Reduce the load.", "Reduce the reps and end the set early."],
    },
  ],
  escalation: "Get it assessed if it persists.",
};

describe("symptomGuideLevels", () => {
  it("returns [] when the plan declares no framework", () => {
    expect(symptomGuideLevels(undefined)).toEqual([]);
    expect(symptomGuideLevels({})).toEqual([]);
  });

  it("orders levels green, yellow, red regardless of declaration order", () => {
    const levels = symptomGuideLevels(fullFramework);
    expect(levels.map((l) => l.level)).toEqual(["green", "yellow", "red"]);
  });

  it("maps each level to its design token", () => {
    const levels = symptomGuideLevels(fullFramework);
    expect(levels.find((l) => l.level === "green")?.token).toBe("--green");
    expect(levels.find((l) => l.level === "yellow")?.token).toBe("--amber");
    expect(levels.find((l) => l.level === "red")?.token).toBe("--red");
  });

  it("maps each action to its verb label", () => {
    const levels = symptomGuideLevels(fullFramework);
    expect(levels.find((l) => l.level === "green")?.actionLabel).toBe("Carry on");
    expect(levels.find((l) => l.level === "yellow")?.actionLabel).toBe("Modify");
    expect(levels.find((l) => l.level === "red")?.actionLabel).toBe("Stop");
  });

  it("carries label and modifications through unchanged", () => {
    const levels = symptomGuideLevels(fullFramework);
    const red = levels.find((l) => l.level === "red");
    expect(red?.label).toBe("Sharp, escalating — stop");
    expect(red?.modifications).toEqual([
      "Stop that exercise for today.",
      "Get it assessed if it persists.",
    ]);
  });

  it("defaults modifications to [] when the level declares none", () => {
    const safety: Safety = {
      symptom_framework: [{ level: "green", label: "Fine", action: "continue" }],
    };
    expect(symptomGuideLevels(safety)[0]?.modifications).toEqual([]);
  });

  it("handles a partial framework — only some levels declared", () => {
    const safety: Safety = {
      symptom_framework: [{ level: "yellow", label: "Modify it", action: "modify" }],
    };
    const levels = symptomGuideLevels(safety);
    expect(levels).toHaveLength(1);
    expect(levels[0]?.level).toBe("yellow");
  });
});

describe("redSymptomLevel", () => {
  it("returns the red level when declared", () => {
    expect(redSymptomLevel(fullFramework)?.level).toBe("red");
  });

  it("returns undefined when the plan declares no red level", () => {
    const safety: Safety = {
      symptom_framework: [{ level: "green", label: "Fine", action: "continue" }],
    };
    expect(redSymptomLevel(safety)).toBeUndefined();
  });

  it("returns undefined for an undefined safety block", () => {
    expect(redSymptomLevel(undefined)).toBeUndefined();
  });
});
