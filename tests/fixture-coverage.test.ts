/**
 * The fixture's job is to exercise every contract primitive in one document
 * (CLAUDE.md, "The fixture"). That job is invisible: dropping a primitive breaks
 * no test, it just quietly stops proving something. This asserts the coverage
 * directly, so the next edit to the fixture cannot lose it silently.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePlanDocument } from "../src/lib/parse/parser";

const fixtureMd = readFileSync(
  new URL("../fixtures/plans/home-training-v1.md", import.meta.url),
  "utf8",
);
const parsed = parsePlanDocument(fixtureMd);
if (!parsed.ok) throw new Error(`fixture failed to parse:\n${parsed.report}`);
const c = parsed.contract;

const prescriptions = c.sessions.flatMap((s) => s.blocks.flatMap((b) => b.exercises));
const byId = new Map(c.exercises.map((e) => [e.id, e]));
const loadById = new Map(c.loads.map((l) => [l.ref, l]));
/** The load actually in effect for a prescription: its own override, if any, else the
 * exercise's catalogue default. A prescription-level override has to be checked first —
 * looking only at the catalogue default misses it entirely. */
const effectiveLoadIsBodyweight = (p: (typeof prescriptions)[number]): boolean => {
  const ref = p.load ?? byId.get(p.id)?.load;
  return ref === undefined ? true : (loadById.get(ref)?.is_bodyweight ?? false);
};
const metricDefs = (["set", "exercise", "session"] as const).flatMap((scope) =>
  (c.metrics?.[scope] ?? []).map((def) => ({ scope, def })),
);

describe("fixture coverage", () => {
  it("declares one metric key at two scopes — the (scope, key) invariant", () => {
    const scopesByKey = new Map<string, string[]>();
    for (const { scope, def } of metricDefs) {
      scopesByKey.set(def.key, [...(scopesByKey.get(def.key) ?? []), scope]);
    }
    const shared = [...scopesByKey.entries()].filter(([, scopes]) => scopes.length > 1);
    expect(shared.length).toBeGreaterThan(0);
  });

  it("declares metrics at all three scopes", () => {
    for (const scope of ["set", "exercise", "session"] as const) {
      expect(metricDefs.some((m) => m.scope === scope)).toBe(true);
    }
  });

  it("declares every metric type, including enum", () => {
    for (const type of ["number", "scale", "enum"]) {
      expect(metricDefs.some((m) => m.def.type === type)).toBe(true);
    }
  });

  it("declares at least one required and one optional metric", () => {
    expect(metricDefs.some((m) => m.def.optional !== true)).toBe(true);
    expect(metricDefs.some((m) => m.def.optional === true)).toBe(true);
  });

  it("declares every prompt_when value", () => {
    for (const when of ["start", "end", "next_morning"]) {
      expect(metricDefs.some((m) => m.def.prompt_when === when)).toBe(true);
    }
  });

  it("prescribes reps and duration in both scalar and ranged form", () => {
    expect(prescriptions.some((p) => typeof p.reps === "number")).toBe(true);
    expect(prescriptions.some((p) => Array.isArray(p.reps))).toBe(true);
    expect(prescriptions.some((p) => typeof p.duration_sec === "number")).toBe(true);
    expect(prescriptions.some((p) => Array.isArray(p.duration_sec))).toBe(true);
  });

  it("prescribes a ranged set count", () => {
    expect(prescriptions.some((p) => Array.isArray(p.sets))).toBe(true);
  });

  it("declares rest as both a scalar and a range, and overrides it per occurrence", () => {
    expect(c.exercises.some((e) => typeof e.rest_sec === "number")).toBe(true);
    expect(c.exercises.some((e) => Array.isArray(e.rest_sec))).toBe(true);
    expect(prescriptions.some((p) => p.rest_sec !== undefined)).toBe(true);
  });

  it("overrides load and substitutes at the prescription level", () => {
    expect(prescriptions.some((p) => p.load !== undefined)).toBe(true);
    expect(prescriptions.some((p) => (p.substitutes ?? []).length > 0)).toBe(true);
  });

  it("pairs per_side with reps, with duration, and with an external load", () => {
    const perSide = prescriptions.filter((p) => byId.get(p.id)?.per_side === true);
    expect(perSide.some((p) => p.reps !== undefined)).toBe(true);
    expect(perSide.some((p) => p.duration_sec !== undefined)).toBe(true);
    expect(perSide.some((p) => !effectiveLoadIsBodyweight(p))).toBe(true);
  });

  it("declares conditionals both with and without substitutes", () => {
    expect(
      c.exercises.some((e) => e.conditional === true && (e.substitutes ?? []).length > 0),
    ).toBe(true);
    expect(
      c.exercises.some((e) => e.conditional === true && (e.substitutes ?? []).length === 0),
    ).toBe(true);
    expect(c.exercises.some((e) => (e.substitutes ?? []).length > 1)).toBe(true);
  });

  it("catalogues at least one movement that is only ever a substitute", () => {
    const prescribed = new Set(prescriptions.map((p) => p.id));
    expect(c.exercises.some((e) => !prescribed.has(e.id))).toBe(true);
  });

  it("uses blocks with explicit tracking and type, and blocks that rely on the defaults", () => {
    const blocks = c.sessions.flatMap((s) => s.blocks);
    expect(blocks.some((b) => b.tracking === "checkoff")).toBe(true);
    expect(blocks.some((b) => b.tracking === "full")).toBe(true);
    expect(blocks.some((b) => b.tracking === undefined)).toBe(true);
    expect(blocks.some((b) => b.type === "sequence")).toBe(true);
    expect(blocks.some((b) => b.type === "rounds")).toBe(true);
    expect(blocks.some((b) => b.type === undefined)).toBe(true);
  });

  it("declares scheduling, progression and safety in full", () => {
    expect((c.scheduling?.sequence ?? []).length).toBeGreaterThan(0);
    expect((c.scheduling?.drop_order ?? []).length).toBeGreaterThan(0);
    expect((c.progression?.effort_by_week ?? []).length).toBeGreaterThan(0);
    expect(c.progression?.hold_load_when).toBeDefined();
    expect((c.safety?.symptom_framework ?? []).length).toBeGreaterThan(0);
  });

  it("is a first version and carries no real identity", () => {
    expect(c.plan.version).toBe(1);
    expect(c.plan.based_on_version).toBeNull();
    expect(c.plan.slug).toBe("home-training");
    expect(fixtureMd.toLowerCase()).not.toContain("andrie");
  });
});
