/**
 * The diff presentation layer. Its job is to be readable on a phone: display names
 * rather than slugs, formatted values rather than raw JSON, and one disposition row
 * per departed slug so no rename can be committed unexamined.
 */

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { GainContract } from "../../src/lib/contract/schema";
import { diffContracts } from "../../src/lib/diff/diff";
import { formatValue, presentDiff } from "../../src/lib/diff/present";
import { parsePlanDocument } from "../../src/lib/parse/parser";

const ROOT = new URL("../../", import.meta.url);

function contractOf(p: string): GainContract {
  const parsed = parsePlanDocument(fs.readFileSync(new URL(p, ROOT), "utf8"));
  if (!parsed.ok) throw new Error(`${p} failed to parse:\n${parsed.report}`);
  return parsed.contract;
}

const before = contractOf("fixtures/plans/home-training-v1.md");
const after = contractOf("fixtures/plans/home-training-v2.md");
const view = presentDiff(diffContracts(before, after), before, after);

describe("formatValue", () => {
  it("renders a range as a range, never as a comma-joined tuple", () => {
    expect(formatValue([8, 12])).toBe("8–12");
  });

  it("collapses a degenerate range to the single number it means", () => {
    expect(formatValue([12, 12])).toBe("12");
  });

  it("renders a bare number unchanged", () => {
    expect(formatValue(60)).toBe("60");
  });

  it("renders an absent value as a dash rather than 'undefined'", () => {
    expect(formatValue(undefined)).toBe("—");
    expect(formatValue(null)).toBe("—");
  });

  it("renders a substitutes list comma-separated", () => {
    expect(formatValue(["dead-bug", "front-plank"])).toBe("dead-bug, front-plank");
  });

  it("renders a boolean as yes or no, not true or false", () => {
    expect(formatValue(true)).toBe("yes");
  });
});

describe("presentDiff", () => {
  it("asks for a disposition for every departed slug", () => {
    expect(view.dispositions.map((d) => d.slug).sort()).toEqual([
      "goblet-squat",
      "hammer-curl",
      "rear-delt-reverse-fly",
    ]);
  });

  it("pre-selects the heuristic match and leaves the others unsuggested", () => {
    const goblet = view.dispositions.find((d) => d.slug === "goblet-squat");
    expect(goblet?.suggested).toBe("gobletsquat");
    expect(goblet?.reason).toBeTruthy();

    const reworded = view.dispositions.find((d) => d.slug === "rear-delt-reverse-fly");
    expect(reworded?.suggested).toBeNull();
  });

  it("offers every added slug as a mapping target, however it was detected", () => {
    const reworded = view.dispositions.find((d) => d.slug === "rear-delt-reverse-fly");
    expect(reworded?.options.map((o) => o.slug)).toContain("prone-reverse-fly");
    expect(reworded?.options.map((o) => o.slug)).toContain("single-leg-glute-bridge");
  });

  it("uses display names, not slugs, in a disposition row", () => {
    const goblet = view.dispositions.find((d) => d.slug === "goblet-squat");
    expect(goblet?.name).not.toContain("-");
  });

  it("carries the changelog through", () => {
    expect(view.changelog.length).toBeGreaterThan(0);
  });

  it("groups the changed targets and names them in plain language", () => {
    const targets = view.groups.find((g) => g.key === "targets");
    expect(targets).toBeDefined();
    const headlines = targets?.entries.map((e) => e.headline) ?? [];
    expect(headlines.some((h) => h.includes("Dumbbell floor press"))).toBe(true);
    const detail = targets?.entries.flatMap((e) => e.details).join(" ") ?? "";
    expect(detail).not.toContain("8,12");
  });

  it("emits no empty groups", () => {
    for (const group of view.groups) expect(group.entries.length).toBeGreaterThan(0);
  });

  it("warns that a removed metric orphans its history", () => {
    expect(view.warnings.join(" ")).toContain("technique");
  });

  it("does not repeat the departed slugs as warnings — they are dispositions", () => {
    expect(view.warnings.join(" ")).not.toContain("hammer-curl");
  });

  it("reports nothing blocking for a clean revision", () => {
    expect(view.blocking).toEqual([]);
  });
});
