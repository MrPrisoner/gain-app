/**
 * Diff engine tests — two contract versions in, a structured diff out.
 *
 * The load-bearing case is rename detection: `goblet-squat` coming back as
 * `goblet_squat` must be flagged, because the failure mode is silent.
 */

import { describe, expect, it } from "vitest";

import { contractSchema, type GainContract } from "../src/lib/contract/schema";
import { countChangedTargets, diffContracts } from "../src/lib/diff/diff";

function makeContract(mutate?: (c: any) => void): GainContract {
  const base: any = {
    schema_version: 1,
    plan: { slug: "test-plan", name: "Test Plan", version: 1, based_on_version: null },
    loads: [{ ref: "main", label: "Main", default_kg: 10 }],
    exercises: [
      { id: "goblet-squat", rest_sec: [75, 90] },
      { id: "side-plank", type: "time", per_side: true },
      { id: "dead-bug", per_side: true },
    ],
    sessions: [
      {
        key: "A",
        name: "Session A",
        order: 1,
        blocks: [
          {
            key: "main",
            name: "Main work",
            exercises: [
              { id: "goblet-squat", sets: 3, reps: [8, 12], load: "main" },
              { id: "side-plank", sets: 2, duration_sec: [20, 40] },
            ],
          },
        ],
      },
    ],
    metrics: {
      session: [
        { key: "energy", label: "Energy", type: "scale", min: 1, max: 10, prompt_when: "start" },
      ],
    },
  };
  mutate?.(base);
  return contractSchema.parse(base) as GainContract;
}

/** A legitimate revision of `before`: version bumped, based_on_version set. */
function revise(before: GainContract, mutate?: (c: any) => void): GainContract {
  return makeContract((c) => {
    c.plan.version = before.plan.version + 1;
    c.plan.based_on_version = before.plan.version;
    c.plan.changelog = ["Test revision."];
    mutate?.(c);
  });
}

describe("diffContracts", () => {
  const before = makeContract();

  it("reports nothing for a clean version bump", () => {
    const after = revise(before);
    const diff = diffContracts(before, after);
    expect(diff.blocking).toHaveLength(0);
    expect(diff.exercises.added).toHaveLength(0);
    expect(diff.exercises.removed).toHaveLength(0);
    expect(diff.exercises.changed).toHaveLength(0);
    expect(diff.prescriptions).toHaveLength(0);
    expect(diff.plan.version_incremented).toBe(true);
  });

  it("blocks an import whose version is not greater", () => {
    const same = makeContract();
    const diff = diffContracts(before, same);
    expect(diff.blocking.length).toBeGreaterThan(0);
    expect(diff.blocking.join("\n")).toContain("version");
    expect(diff.plan.version_incremented).toBe(false);
  });

  it("blocks a plan.slug change", () => {
    const after = revise(before, (c) => {
      c.plan.slug = "other-plan";
    });
    const diff = diffContracts(before, after);
    expect(diff.plan.slug_changed).toBe(true);
    expect(diff.blocking.join("\n")).toContain("plan.slug");
  });

  it("flags goblet-squat → db-goblet-squat as a possible rename", () => {
    // Note: `goblet_squat` itself never reaches the diff — the schema rejects
    // non-slug ids loudly at validation, which is the first line of defence.
    // Rename detection catches renames between VALID slugs, like this one.
    const after = revise(before, (c) => {
      c.exercises[0].id = "db-goblet-squat";
      c.sessions[0].blocks[0].exercises[0].id = "db-goblet-squat";
    });
    const diff = diffContracts(before, after);

    expect(diff.exercises.removed.map((e) => e.id)).toContain("goblet-squat");
    expect(diff.exercises.added.map((e) => e.id)).toContain("db-goblet-squat");
    expect(diff.exercises.possible_renames).toContainEqual(
      expect.objectContaining({ from: "goblet-squat", to: "db-goblet-squat" }),
    );
    expect(diff.warnings.join("\n")).toContain("possible rename");
  });

  it("flags near-miss slugs by edit distance", () => {
    const after = revise(before, (c) => {
      c.exercises[0].id = "goblet-squats";
      c.sessions[0].blocks[0].exercises[0].id = "goblet-squats";
    });
    const diff = diffContracts(before, after);
    expect(diff.exercises.possible_renames.length).toBeGreaterThan(0);
  });

  it("reports changed targets per prescription", () => {
    const after = revise(before, (c) => {
      c.sessions[0].blocks[0].exercises[0].reps = [10, 15];
    });
    const diff = diffContracts(before, after);

    expect(countChangedTargets(diff)).toBe(1);
    const change = diff.prescriptions[0];
    expect(change).toMatchObject({
      session: "A",
      block: "main",
      id: "goblet-squat",
      status: "changed",
    });
    expect(change?.changes).toContainEqual(
      expect.objectContaining({ field: "reps", from: [8, 12], to: [10, 15] }),
    );
  });

  it("treats bare integers and equal ranges as unchanged", () => {
    const after = revise(before, (c) => {
      c.sessions[0].blocks[0].exercises[0].reps = [8, 12]; // unchanged
      c.sessions[0].blocks[0].exercises[0].sets = [3, 3]; // 3 === [3, 3]
    });
    const diff = diffContracts(before, after);
    expect(diff.prescriptions).toHaveLength(0);
  });

  it("reports added and removed exercises and their prescriptions", () => {
    const after = revise(before, (c) => {
      c.exercises = c.exercises.filter((e: any) => e.id !== "side-plank");
      c.exercises.push({ id: "bulgarian-split-squat", per_side: true });
      c.sessions[0].blocks[0].exercises = c.sessions[0].blocks[0].exercises.filter(
        (e: any) => e.id !== "side-plank",
      );
      c.sessions[0].blocks[0].exercises.push({
        id: "bulgarian-split-squat",
        sets: 3,
        reps: [8, 10],
      });
    });
    const diff = diffContracts(before, after);

    expect(diff.exercises.removed.map((e) => e.id)).toContain("side-plank");
    expect(diff.exercises.added.map((e) => e.id)).toContain("bulgarian-split-squat");
    expect(diff.prescriptions.some((p) => p.id === "side-plank" && p.status === "removed")).toBe(
      true,
    );
    expect(
      diff.prescriptions.some((p) => p.id === "bulgarian-split-squat" && p.status === "added"),
    ).toBe(true);
    expect(diff.warnings.join("\n")).toContain("side-plank");
  });

  it("reports metric additions, removals and changes", () => {
    const after = revise(before, (c) => {
      c.metrics.session = [
        {
          key: "energy",
          label: "Energy before",
          type: "scale",
          min: 1,
          max: 10,
          prompt_when: "start",
        },
        { key: "sleep", label: "Sleep", type: "number", min: 0, max: 12, prompt_when: "start" },
      ];
    });
    const diff = diffContracts(before, after);

    expect(diff.metrics.added.map((m) => m.def.key)).toContain("sleep");
    expect(diff.metrics.changed).toContainEqual(expect.objectContaining({ key: "energy" }));
    expect(diff.metrics.removed).toHaveLength(0);
  });

  it("warns when a metric key disappears, orphaning its history", () => {
    const after = revise(before, (c) => {
      delete c.metrics;
    });
    const diff = diffContracts(before, after);
    expect(diff.metrics.removed.map((m) => m.def.key)).toContain("energy");
    expect(diff.warnings.join("\n")).toContain("orphaned");
  });

  it("warns about catalogue entries referenced by nothing", () => {
    const after = revise(before, (c) => {
      c.exercises.push({ id: "unused-movement" });
    });
    const diff = diffContracts(before, after);
    expect(diff.exercises.unreferenced).toContain("unused-movement");
  });

  it("warns when based_on_version does not match the version being revised", () => {
    const after = revise(before, (c) => {
      c.plan.based_on_version = null;
    });
    const diff = diffContracts(before, after);
    expect(diff.warnings.join("\n")).toContain("based_on_version");
  });

  it("detects session and block structure changes", () => {
    const after = revise(before, (c) => {
      c.sessions[0].name = "Renamed session";
      c.sessions[0].blocks[0].tracking = "checkoff";
      c.sessions.push({
        key: "B",
        name: "Session B",
        order: 2,
        blocks: [{ key: "main", name: "Main", exercises: [{ id: "dead-bug", reps: 8 }] }],
      });
    });
    const diff = diffContracts(before, after);
    expect(diff.sessions.added).toContain("B");
    expect(diff.sessions.changed).toContainEqual(expect.objectContaining({ key: "A" }));
    expect(diff.sessions.blocks.some((b) => b.session === "A" && b.changed.length > 0)).toBe(true);
  });
});
