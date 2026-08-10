/**
 * Template substitution tests (ARCHITECTURE §7, §11).
 *
 * The invariants that matter: known variables substitute, unknown placeholders are
 * left as literal text, optional answers may be empty, and embedded content (like
 * CONTRACT.md) passes through byte-for-byte without `$`-pattern re-interpretation.
 */

import { describe, expect, it } from "vitest";

import {
  renderBootstrapPrompt,
  renderInstructionsTemplate,
  substituteVariables,
} from "../src/lib/templates/render";

describe("substituteVariables", () => {
  it("substitutes known variables and leaves unknown placeholders literal", () => {
    const out = substituteVariables(
      "Hello {{name}}, your {{unknown_var}} stays.",
      new Set(["name"]),
      { name: "GAIN" },
    );
    expect(out).toBe("Hello GAIN, your {{unknown_var}} stays.");
  });

  it("replaces known variables with no value with an empty string", () => {
    const out = substituteVariables("a {{x}} b", new Set(["x"]), {});
    expect(out).toBe("a  b");
  });

  it("does not re-interpret $ patterns in substituted content", () => {
    const out = substituteVariables("{{x}}", new Set(["x"]), { x: "$& $1 $$ $`" });
    expect(out).toBe("$& $1 $$ $`");
  });

  it("replaces every occurrence", () => {
    const out = substituteVariables("{{x}} and {{x}}", new Set(["x"]), { x: "1" });
    expect(out).toBe("1 and 1");
  });
});

describe("renderBootstrapPrompt", () => {
  it("embeds the contract verbatim and blanks skipped answers", () => {
    const template = "Eq: {{equipment}}\nDays: {{sessions_per_week}}\n\n{{contract}}\n";
    const out = renderBootstrapPrompt(template, {}, "THE CONTRACT");
    expect(out).toBe("Eq: \nDays: \n\nTHE CONTRACT\n");
    expect(out).toContain("THE CONTRACT");
  });

  it("fills in provided answers", () => {
    const template = "{{equipment}} / {{goals}} / {{constraints}}";
    const out = renderBootstrapPrompt(
      template,
      { equipment: "dumbbells", goals: "muscle", constraints: "bad knee" },
      "C",
    );
    expect(out).toBe("dumbbells / muscle / bad knee");
  });

  it("fills in the display name when known, and blanks it otherwise", () => {
    const template = "Name: {{display_name}}";
    expect(renderBootstrapPrompt(template, { display_name: "Ada Lovelace" }, "C")).toBe(
      "Name: Ada Lovelace",
    );
    expect(renderBootstrapPrompt(template, {}, "C")).toBe("Name: ");
  });
});

describe("renderInstructionsTemplate", () => {
  it("substitutes the six export variables", () => {
    const template =
      "{{plan_name}} v{{plan_version}} — {{export_window}} — {{today}} — {{workouts_logged}} workouts over {{weeks_elapsed}} weeks";
    const out = renderInstructionsTemplate(template, {
      plan_name: "Home Dumbbell",
      plan_version: "2",
      export_window: "weeks 1–4",
      today: "2026-09-01",
      workouts_logged: "12",
      weeks_elapsed: "4",
    });
    expect(out).toBe("Home Dumbbell v2 — weeks 1–4 — 2026-09-01 — 12 workouts over 4 weeks");
  });

  it("leaves user-added unknown placeholders untouched", () => {
    const out = renderInstructionsTemplate("{{plan_name}} {{my_custom_note}}", {
      plan_name: "P",
      plan_version: "1",
      export_window: "w",
      today: "t",
      workouts_logged: "0",
      weeks_elapsed: "0",
    });
    expect(out).toBe("P {{my_custom_note}}");
  });
});
