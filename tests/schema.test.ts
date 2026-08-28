/**
 * Contract schema tests — the Zod implementation of docs/CONTRACT.md.
 *
 * The minimal valid block is the one from CONTRACT §6. Everything else exercises
 * the validation behaviour listed in CONTRACT §7 and the round-trip defences from
 * CLAUDE.md (synonyms rejected loudly, slugs protected).
 */

import fs from "node:fs";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { contractSchema } from "../src/lib/contract/schema";
import { parsePlanDocument, scanFences } from "../src/lib/parse/parser";

const ROOT = new URL("../", import.meta.url);
const contractMd = fs.readFileSync(new URL("docs/CONTRACT.md", ROOT), "utf8");

/**
 * The minimal valid block, read out of docs/CONTRACT.md §6 at test time rather than
 * hand-copied into this file.
 *
 * CONTRACT.md is shipped output — reproduced verbatim in Section 4 of every export and
 * Section 2 of the bootstrap prompt — so it *is* the instruction set every AI receives.
 * CLAUDE.md's "contract changes touch three places together" rule covers the document,
 * the Zod schema and the fixture, and the schema↔fixture half is genuinely coupled: six
 * test files parse the fixture through `contractSchema`, so that direction fails loudly.
 * The document half was pure convention. With a hand-copy here, CONTRACT.md's own worked
 * example could drift away from what the parser accepts and the entire suite would still
 * pass — and GAIN would then ship instructions telling every AI to emit something GAIN's
 * own parser rejects, with the user's only recovery being to paste that rejection back
 * into a chat that was faithfully following GAIN's document.
 *
 * The *raw* YAML is what the rest of this file clones, deliberately: `parsePlanDocument`
 * returns the schema's output, with defaults already applied, and starting the mutation
 * tests from that would quietly stop them exercising the shape an AI actually emits.
 * `documentParses` below covers the whole fence → YAML → schema path instead.
 *
 * §2 contains a second ```gain-plan fence, nested inside a four-backtick ````markdown
 * block. `scanFences` consumes it as that block's body, so the document holds exactly one
 * contract block — the same rule §2 states for a plan document.
 */
const minimal = ((): Record<string, unknown> => {
  const blocks = scanFences(contractMd).filter((f) => f.info === "gain-plan");
  if (blocks.length !== 1) {
    throw new Error(
      `docs/CONTRACT.md should hold exactly one \`gain-plan\` block (§6's minimal ` +
        `example); found ${blocks.length}.`,
    );
  }
  const block = blocks[0]!;
  return parseYaml(contractMd.slice(block.bodyStart, block.bodyEnd)) as Record<string, unknown>;
})();

// Tests mutate the clone freely (adding changelogs, metrics, scheduling...), so it
// is deliberately untyped.
function clone(): any {
  return JSON.parse(JSON.stringify(minimal));
}

function issuesOf(data: unknown): string[] {
  const result = contractSchema.safeParse(data);
  if (result.success) return [];
  return result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("contract schema", () => {
  it("accepts the minimal valid block from CONTRACT §6", () => {
    expect(contractSchema.safeParse(minimal).success).toBe(true);
  });

  /**
   * The same coupling, one level up: the shipped document itself goes through the real
   * import path — fence scan, YAML parse, schema validation. If this ever fails, the
   * failure text is the report GAIN would hand a user whose AI had followed CONTRACT.md
   * to the letter, which is the most direct way to see why the drift matters.
   */
  it("parses docs/CONTRACT.md through the real import path", () => {
    const parsed = parsePlanDocument(contractMd);
    if (!parsed.ok) {
      throw new Error(
        `docs/CONTRACT.md §6's minimal block no longer imports (${parsed.kind}). The ` +
          `document and the Zod schema have drifted apart, and CONTRACT.md ships verbatim ` +
          `in every export and bootstrap prompt.\n\n${parsed.report}`,
      );
    }
    expect(parsed.contract.plan.slug).toBe("simple-plan");
  });

  // -- The contract key is `plan`, and synonyms are not accepted.

  it("rejects `program` loudly, pointing at `plan`", () => {
    const data = clone() as Record<string, unknown>;
    data.program = data.plan;
    delete data.plan;
    const issues = issuesOf(data).join("\n");
    expect(issues).toContain("program");
    expect(issues).toContain("`plan`");
    expect(contractSchema.safeParse(data).success).toBe(false);
  });

  it("rejects `plan_id` and `plan_version` as top-level synonyms", () => {
    const data = clone() as Record<string, unknown>;
    data.plan_id = "simple-plan";
    data.plan_version = 1;
    const issues = issuesOf(data).join("\n");
    expect(issues).toContain("plan_id");
    expect(issues).toContain("plan_version");
  });

  it("rejects unknown top-level keys", () => {
    const data = clone() as Record<string, unknown>;
    data.bonus = true;
    const issues = issuesOf(data).join("\n");
    expect(issues).toContain("bonus");
    expect(issues).toContain("unknown top-level key");
  });

  // -- Slugs.

  it("rejects non-slug plan slugs and exercise ids", () => {
    const data = clone();
    data.plan.slug = "Home Plan";
    expect(issuesOf(data).join("\n")).toContain("slug");

    const data2 = clone();
    data2.exercises[0].id = "Goblet_Squat";
    expect(issuesOf(data2).join("\n")).toContain("exercises.0.id");
  });

  // -- Versioning.

  it("requires a changelog when version is above 1", () => {
    const data = clone();
    data.plan.version = 2;
    data.plan.based_on_version = 1;
    expect(contractSchema.safeParse(data).success).toBe(false);
    expect(issuesOf(data).join("\n")).toContain("changelog");

    data.plan.changelog = ["Raised the rep range."];
    expect(contractSchema.safeParse(data).success).toBe(true);
  });

  it("rejects a version above 1 with no `based_on_version`", () => {
    const data = clone();
    data.plan.version = 2;
    data.plan.based_on_version = null;
    data.plan.changelog = ["Second version"];
    const issues = issuesOf(data).join("\n");
    expect(contractSchema.safeParse(data).success).toBe(false);
    expect(issues).toContain("based_on_version");
  });

  it("accepts a version above 1 that names its `based_on_version`", () => {
    const data = clone();
    data.plan.version = 2;
    data.plan.based_on_version = 1;
    data.plan.changelog = ["Second version"];
    expect(contractSchema.safeParse(data).success).toBe(true);
  });

  it("accepts a first version with a null `based_on_version`", () => {
    const data = clone();
    data.plan.version = 1;
    data.plan.based_on_version = null;
    expect(contractSchema.safeParse(data).success).toBe(true);
  });

  it("rejects schema_version other than 1", () => {
    const data = clone() as Record<string, unknown>;
    data.schema_version = 2;
    expect(contractSchema.safeParse(data).success).toBe(false);
  });

  // -- Rounds blocks.

  it("rejects `sets` inside a rounds block", () => {
    const data = clone();
    data.sessions[0].blocks[0].type = "rounds";
    data.sessions[0].blocks[0].rounds = 2;
    const issues = issuesOf(data).join("\n");
    expect(issues).toContain("sets");
    expect(issues).toContain("rounds");
  });

  it("requires `rounds` on rounds blocks and rejects it elsewhere", () => {
    const missing = clone();
    missing.sessions[0].blocks[0].type = "rounds";
    expect(issuesOf(missing).join("\n")).toContain("rounds");

    const extra = clone();
    extra.sessions[0].blocks[0].rounds = 2; // no type: rounds
    expect(issuesOf(extra).join("\n")).toContain("rounds");
  });

  it("allows block-level rest_sec only on rounds blocks", () => {
    const bad = clone();
    bad.sessions[0].blocks[0].rest_sec = [45, 60];
    expect(issuesOf(bad).join("\n")).toContain("rest_sec");

    const good = clone();
    good.sessions[0].blocks[0].type = "rounds";
    good.sessions[0].blocks[0].rounds = 2;
    good.sessions[0].blocks[0].rest_sec = [45, 60];
    good.sessions[0].blocks[0].exercises = [{ id: "goblet-squat", reps: 8 }];
    expect(contractSchema.safeParse(good).success).toBe(true);
  });

  // -- References.

  it("rejects a load referencing an undeclared ref", () => {
    const data = clone();
    data.sessions[0].blocks[0].exercises[0].load = "heavy";
    expect(issuesOf(data).join("\n")).toContain("heavy");
  });

  it("rejects a session exercise id missing from the catalogue", () => {
    const data = clone();
    data.sessions[0].blocks[0].exercises[0].id = "not-declared";
    expect(issuesOf(data).join("\n")).toContain("not-declared");
  });

  it("rejects substitutes not declared in the catalogue", () => {
    const data = clone();
    data.exercises[0].substitutes = ["ghost-movement"];
    expect(issuesOf(data).join("\n")).toContain("ghost-movement");
  });

  it("rejects scheduling.sequence referencing an undeclared session key", () => {
    const data = clone();
    data.scheduling = { sequence: ["A", "Z"] };
    expect(issuesOf(data).join("\n")).toContain("scheduling.sequence.1");
  });

  it("rejects duplicate catalogue ids and duplicate session keys", () => {
    const dupId = clone();
    dupId.exercises.push({ id: "goblet-squat" });
    expect(issuesOf(dupId).join("\n")).toContain("duplicate exercise id");

    const dupKey = clone();
    dupKey.sessions.push({ ...dupKey.sessions[0] });
    expect(issuesOf(dupKey).join("\n")).toContain("duplicate session key");
  });

  // -- Type-driven requirements.

  it("requires reps for type reps and duration_sec for type time", () => {
    const missingReps = clone();
    missingReps.sessions[0].blocks[0].exercises[0] = { id: "goblet-squat" };
    expect(issuesOf(missingReps).join("\n")).toContain("reps");

    const timeNoDuration = clone();
    timeNoDuration.exercises[0].type = "time";
    timeNoDuration.sessions[0].blocks[0].exercises[0] = { id: "goblet-squat", reps: 8 };
    const issues = issuesOf(timeNoDuration).join("\n");
    expect(issues).toContain("duration_sec");
    expect(issues).toContain("reps");
  });

  it("accepts bare integers and [min, max] ranges interchangeably", () => {
    const data = clone();
    data.sessions[0].blocks[0].exercises[0] = {
      id: "goblet-squat",
      sets: [2, 3],
      reps: 10,
      rest_sec: [75, 90],
      load: "main",
    };
    expect(contractSchema.safeParse(data).success).toBe(true);
  });

  it("rejects inverted ranges", () => {
    const data = clone();
    data.sessions[0].blocks[0].exercises[0].reps = [12, 8];
    expect(contractSchema.safeParse(data).success).toBe(false);
  });

  // -- Metrics.

  it("rejects prompt_when on non-session metrics", () => {
    const data = clone();
    data.metrics = {
      exercise: [
        { key: "rir", label: "RIR", type: "number", min: 0, max: 5, prompt_when: "start" },
      ],
    };
    expect(issuesOf(data).join("\n")).toContain("prompt_when");
  });

  it("requires min/max for number and scale, options for enum", () => {
    const noBounds = clone();
    noBounds.metrics = { session: [{ key: "k", label: "L", type: "scale", prompt_when: "start" }] };
    const issues = issuesOf(noBounds).join("\n");
    expect(issues).toContain("min");
    expect(issues).toContain("max");

    const noOptions = clone();
    noOptions.metrics = { exercise: [{ key: "q", label: "Q", type: "enum" }] };
    expect(issuesOf(noOptions).join("\n")).toContain("options");
  });

  it("rejects duplicate metric keys within a scope", () => {
    const data = clone();
    data.metrics = {
      session: [
        { key: "energy", label: "Energy", type: "scale", min: 1, max: 10, prompt_when: "start" },
        {
          key: "energy",
          label: "Energy again",
          type: "scale",
          min: 1,
          max: 10,
          prompt_when: "end",
        },
      ],
    };
    expect(issuesOf(data).join("\n")).toContain("duplicate metric key");
  });

  // -- Progression: known synonyms rejected, free-text extras still allowed.

  it("rejects `keep_load_when` as a synonym of `hold_load_when`", () => {
    const data = clone();
    data.progression = { model: "double_progression", keep_load_when: ["Reps still climbing"] };
    const result = contractSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join("\n");
      expect(messages).toContain("hold_load_when");
      expect(messages).toContain("keep_load_when");
    }
  });

  it("still accepts free-text extras alongside the declared progression keys", () => {
    const data = clone();
    data.progression = {
      model: "double_progression",
      hold_load_when: ["Reps still climbing"],
      notes: ["Smallest increment is 1 kg per dumbbell"],
      future_progressions: ["Load the split squat once bodyweight is comfortable"],
    };
    expect(contractSchema.safeParse(data).success).toBe(true);
  });
});
