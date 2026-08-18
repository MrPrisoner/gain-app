/**
 * Diff engine tests — two contract versions in, a structured diff out.
 *
 * The load-bearing case is rename detection: `goblet-squat` coming back as
 * `goblet_squat` must be flagged, because the failure mode is silent.
 */

import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { contractSchema, type GainContract } from "../src/lib/contract/schema";
import { countChangedTargets, diffContracts } from "../src/lib/diff/diff";
import { parsePlanDocument } from "../src/lib/parse/parser";

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
    // Can't use `null` here any more — the schema itself now rejects a null
    // `based_on_version` above version 1, so the mismatch has to be a wrong
    // (but still non-null) ancestor version instead.
    const after = revise(before, (c) => {
      c.plan.based_on_version = before.plan.version + 1;
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

  // A block-level "added" line does not say what landed inside it, and restructuring
  // sessions is exactly when the user most needs the prescriptions itemised.
  it("enumerates prescriptions inside an added session", () => {
    const after = revise(before, (c) => {
      c.sessions.push({
        key: "B",
        name: "Session B",
        order: 2,
        blocks: [
          {
            key: "main",
            name: "Main",
            exercises: [
              { id: "dead-bug", reps: 8 },
              { id: "goblet-squat", sets: 3, reps: 10, load: "main" },
            ],
          },
        ],
      });
    });
    const diff = diffContracts(before, after);

    const added = diff.prescriptions.filter((p) => p.status === "added" && p.session === "B");
    expect(added.map((p) => p.id).sort()).toEqual(["dead-bug", "goblet-squat"]);
    expect(added.every((p) => p.block === "main")).toBe(true);
  });

  it("enumerates prescriptions inside a removed block", () => {
    const withExtra = makeContract((c) => {
      c.sessions[0].blocks.push({
        key: "finisher",
        name: "Finisher",
        exercises: [{ id: "dead-bug", reps: 8 }],
      });
    });
    const after = revise(withExtra, (c) => {
      c.plan.version = withExtra.plan.version + 1;
      c.plan.based_on_version = withExtra.plan.version;
    });

    const diff = diffContracts(withExtra, after);
    expect(diff.sessions.blocks.some((b) => b.removed.includes("finisher"))).toBe(true);
    expect(diff.prescriptions).toContainEqual(
      expect.objectContaining({
        session: "A",
        block: "finisher",
        id: "dead-bug",
        status: "removed",
      }),
    );
  });

  it("enumerates prescriptions inside a removed session", () => {
    const withExtra = makeContract((c) => {
      c.sessions.push({
        key: "B",
        name: "Session B",
        order: 2,
        blocks: [{ key: "main", name: "Main", exercises: [{ id: "dead-bug", reps: 8 }] }],
      });
    });
    const after = revise(withExtra, (c) => {
      c.plan.version = withExtra.plan.version + 1;
      c.plan.based_on_version = withExtra.plan.version;
    });

    const diff = diffContracts(withExtra, after);
    expect(diff.sessions.removed).toContain("B");
    expect(diff.prescriptions).toContainEqual(
      expect.objectContaining({ session: "B", block: "main", id: "dead-bug", status: "removed" }),
    );
  });

  it("does not double-report a prescription in a block present on both sides", () => {
    const after = revise(before, (c) => {
      c.sessions[0].blocks[0].exercises[0].reps = [10, 14];
    });
    const diff = diffContracts(before, after);
    expect(diff.prescriptions.filter((p) => p.id === "goblet-squat")).toHaveLength(1);
  });
});

describe("the real v1 to v2 fixture pair", () => {
  const ROOT = new URL("../", import.meta.url);
  const read = (p: string) => fs.readFileSync(new URL(p, ROOT), "utf8");

  function contractOf(p: string): GainContract {
    const parsed = parsePlanDocument(read(p));
    if (!parsed.ok) throw new Error(`${p} failed to parse:\n${parsed.report}`);
    return parsed.contract;
  }

  const before = contractOf("fixtures/plans/home-training-v1.md");
  const after = contractOf("fixtures/plans/home-training-v2.md");
  const diff = diffContracts(before, after);

  it("is a clean revision with nothing blocking", () => {
    expect(diff.blocking).toEqual([]);
    expect(diff.plan.version_incremented).toBe(true);
    expect(diff.plan.changelog.length).toBeGreaterThan(0);
  });

  it("reports all three departed slugs", () => {
    expect(diff.exercises.removed.map((e) => e.id).sort()).toEqual([
      "goblet-squat",
      "hammer-curl",
      "rear-delt-reverse-fly",
    ]);
  });

  it("catches the punctuation rename and misses the reworded one", () => {
    const pairs = diff.exercises.possible_renames.map((r) => `${r.from}->${r.to}`);
    expect(pairs).toContain("goblet-squat->gobletsquat");
    expect(pairs.some((p) => p.startsWith("rear-delt-reverse-fly->"))).toBe(false);
  });

  it("reports the added exercise", () => {
    expect(diff.exercises.added.map((e) => e.id)).toContain("single-leg-glute-bridge");
  });

  it("reports the metric added and the metric removed", () => {
    expect(diff.metrics.added.map((m) => m.def.key)).toContain("sleep_quality");
    expect(diff.metrics.removed.map((m) => m.def.key)).toContain("technique");
  });

  it("reports the changed targets", () => {
    const changed = diff.prescriptions.filter((p) => p.status === "changed");
    const fields = changed.flatMap((p) => p.changes.map((c) => `${p.session}:${p.id}:${c.field}`));
    expect(fields).toContain("A:db-floor-press:sets");
    expect(fields).toContain("C:split-squat:load");
    expect(fields).toContain("D:prone-row:rest_sec");
  });

  // No assertion on A:gobletsquat:reps: prescriptions are matched by exercise id, so
  // an unmapped rename makes the old prescription "removed" and the new one "added"
  // rather than "changed" — change 7's reps edit rides along inside that added/removed
  // pair and is never reported as a field change. That is correct engine behaviour,
  // not a gap in this fixture — do not "fix" it by adding a rename mapping here.
});
