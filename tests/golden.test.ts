/**
 * The golden round-trip test — the project's spine (ARCHITECTURE §12).
 *
 *   import fixture → log synthetic workouts → export → extract Section 1 → re-import
 *
 * Asserts: every exercise slug survives, every prescription survives, `context_md`
 * is byte-identical, and both templates embed `docs/CONTRACT.md` byte-for-byte —
 * the bootstrap prompt via `{{contract}}`, the export as Section 4.
 *
 * It does NOT assert that a real revision round-trips unchanged — an AI is supposed
 * to rewrite prose when the reasoning changes. The invariant is that GAIN's storage
 * and replay are lossless.
 *
 * The test file itself reads the fixture and spec from disk; the code under test is
 * pure functions over plain data with an injected clock.
 */

import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";

import { openUserDb } from "../src/lib/db/user-db";
import { importPlan } from "../src/lib/db/import-plan";

import { deepEqual, diffContracts } from "../src/lib/diff/diff";
import {
  extractPlanSourceFromBundle,
  extractSection4FromBundle,
  generateExport,
} from "../src/lib/export/bundle";
import { countPrescriptions, parsePlanDocument } from "../src/lib/parse/parser";
import { renderBootstrapPrompt } from "../src/lib/templates/render";
import { buildSyntheticLogs } from "./helpers/synthetic-logs";

const ROOT = new URL("..", import.meta.url);
const read = (filePath: string): string => readFileSync(new URL(filePath, ROOT), "utf8");

const NOW = new Date("2026-09-01T09:00:00Z");

const fixtureMd = read("fixtures/plans/home-training-v1.md");
const contractMd = read("docs/CONTRACT.md");
const bootstrapTemplate = read("templates/bootstrap-prompt.md");
const instructionsTemplate = read("templates/default-ai-instructions.md");

describe("golden round trip", () => {
  // -- Import.
  const imported = parsePlanDocument(fixtureMd);
  if (!imported.ok) {
    throw new Error(`fixture import failed:\n${imported.report}`);
  }

  it("imports the fixture", () => {
    expect(imported.ok).toBe(true);
    expect(imported.source_md).toBe(fixtureMd);
  });

  it("parses the fixture's declared shape: 4 sessions, 26 exercises, 49 prescriptions", () => {
    expect(imported.contract.sessions).toHaveLength(4);
    expect(imported.contract.exercises).toHaveLength(26);
    expect(countPrescriptions(imported.contract)).toBe(49);
  });

  // -- Log synthetic workouts, export.
  const logs = buildSyntheticLogs(imported.contract);
  const now = new Date("2026-09-01T09:00:00Z");
  const bundle = generateExport({
    contract: imported.contract,
    source_md: imported.source_md,
    instructions_template: instructionsTemplate,
    contract_md: contractMd,
    logs,
    window: { label: "weeks 1–4", start: "2026-08-01T00:00:00Z", end: "2026-09-01T00:00:00Z" },
    now,
  });

  it("refuses to re-import its own export bundle, with an explanation", () => {
    const refused = parsePlanDocument(bundle);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.kind).toBe("export_bundle");
      expect(refused.report).toContain("GAIN export");
      expect(refused.report).toContain("not a plan");
    }
  });

  // -- Extract Section 1, re-import.
  const section1 = extractPlanSourceFromBundle(bundle);
  const reimported = section1 !== null ? parsePlanDocument(section1) : null;

  it("embeds Section 1 as source_md, byte-for-byte", () => {
    expect(section1).toBe(imported.source_md);
  });

  it("re-imports the extracted Section 1 cleanly", () => {
    if (!reimported?.ok) {
      throw new Error(
        `re-import failed:\n${reimported && !reimported.ok ? reimported.report : "no Section 1"}`,
      );
    }
    expect(reimported.ok).toBe(true);
  });

  if (!reimported || !reimported.ok) {
    throw new Error("re-import failed; cannot continue the golden test");
  }

  it("preserves context_md byte-for-byte", () => {
    expect(reimported.context_md).toBe(imported.context_md);
  });

  it("preserves every exercise slug", () => {
    const before = imported.contract.exercises.map((e) => e.id).sort();
    const after = reimported.contract.exercises.map((e) => e.id).sort();
    expect(after).toEqual(before);
    expect(after).toContain("seated-floor-shoulder-press"); // substitute-only movement
  });

  it("preserves every prescription — all 49 occurrences, every set of targets", () => {
    expect(countPrescriptions(reimported.contract)).toBe(49);
    expect(deepEqual(reimported.contract, imported.contract)).toBe(true);
  });

  it("produces a diff against itself with no changes and no blocking issues", () => {
    const diff = diffContracts(imported.contract, reimported.contract);
    // The round-trip re-imports the SAME version, so version-not-incremented is
    // expected here; everything else must be silent.
    expect(diff.exercises.added).toHaveLength(0);
    expect(diff.exercises.removed).toHaveLength(0);
    expect(diff.exercises.changed).toHaveLength(0);
    expect(diff.prescriptions).toHaveLength(0);
    expect(diff.metrics.added).toHaveLength(0);
    expect(diff.metrics.removed).toHaveLength(0);
    expect(diff.metrics.changed).toHaveLength(0);
    expect(diff.plan.slug_changed).toBe(false);
  });

  // -- CONTRACT.md rides along byte-for-byte, in both directions.

  it("embeds docs/CONTRACT.md byte-for-byte as Section 4 of the export", () => {
    expect(extractSection4FromBundle(bundle)).toBe(contractMd);
  });

  it("embeds docs/CONTRACT.md byte-for-byte in the rendered bootstrap prompt", () => {
    const prompt = renderBootstrapPrompt(
      bootstrapTemplate,
      {
        equipment: "Adjustable dumbbells, 0.5–2.5 kg plates",
        sessions_per_week: "4",
        session_minutes: "45",
        goals: "Build muscle and general strength",
        constraints: "Occasional lower-back sensitivity",
      },
      contractMd,
    );
    expect(prompt).toContain(contractMd);
    expect(prompt.split(contractMd).length - 1).toBe(1); // exactly once
  });

  it("renders the export title and Section 0 from the instructions template", () => {
    expect(bundle.startsWith("# GAIN Export — Home Training Plan — weeks 1–4\n")).toBe(true);

    const start = bundle.indexOf("## 0. Your task\n\n");
    const end = bundle.indexOf("\n## 1. The current plan");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section0 = bundle.slice(start + "## 0. Your task\n\n".length, end);

    // The default template tells the reviewing AI how much evidence it is working
    // from, which only works if every placeholder actually resolves. An unrendered
    // `{{weeks_elapsed}}` reads as a literal to the AI and is worse than saying
    // nothing, so assert none survive rather than that the body is unchanged.
    expect(instructionsTemplate).toContain("{{weeks_elapsed}}");
    expect(section0).not.toMatch(/\{\{/);
    expect(section0).toContain("12 workouts logged over");
    expect(section0).toContain("4 weeks of Home Training Plan v1");
    expect(section0).toContain("covering\nweeks 1–4");
    expect(section0).toContain("Today is 2026-09-01");
  });

  it("carries the synthetic logs into Sections 2 and 3", () => {
    // Section 2: the skip deviation is pre-computed into the summary.
    expect(bundle).toContain("reverse-crunch");
    expect(bundle).toContain("skip");
    // Section 3: raw CSV tables exist and carry set rows.
    expect(bundle).toContain("```csv");
    expect(bundle).toContain("workout_id,date,session_key,exercise,set_no");
    expect(bundle).toContain("goblet-squat");
  });

  it("keeps a metric declared at two scopes as two distinct series in the summary", () => {
    // `symptoms_during` is declared at set AND session scope. The synthetic logs give
    // each series a shape the other cannot produce by accident: the set series is a
    // single value of 3, the session series is twelve values topping out at 2. A row
    // count of 2 alone doesn't prove the scopes weren't merged — `summary.ts` pushes one
    // row per *declared* (scope, metric) pair regardless of how values were bucketed, so
    // two identical, merged rows would still satisfy "one row per scope". Asserting the
    // actual n/max per row is what catches a merge: under one, both rows would read
    // n=13, max=3.
    const rows = bundle
      .split("\n")
      .filter((line) => line.startsWith("|") && line.includes("`symptoms_during`"));
    expect(rows).toHaveLength(2);

    const setRow = rows.find((r) => r.startsWith("| set |"));
    const sessionRow = rows.find((r) => r.startsWith("| session |"));
    // | scope | key | label | n | first | latest | min | avg | max |
    expect(setRow).toBe(
      "| set | `symptoms_during` | Symptoms on this set | 1 | 3 | 3 | 3 | 3 | 3 |",
    );
    expect(sessionRow).toBe(
      "| session | `symptoms_during` | Hip / lower-back symptoms during this session | 12 | 0 | 0 | 0 | 0.17 | 2 |",
    );
  });
});

describe("a revision round-trips as faithfully as a first import", () => {
  it("replays v2's source_md byte-for-byte after importing it over v1", () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "gain-golden-v2-"));
    const userDb = openUserDb(dataDir, "user-1", { now: NOW });

    const v1 = parsePlanDocument(read("fixtures/plans/home-training-v1.md"));
    if (!v1.ok) throw new Error(v1.report);
    expect(importPlan(userDb, { parsed: v1, now: NOW }).ok).toBe(true);

    const v2Md = read("fixtures/plans/home-training-v2.md");
    const v2 = parsePlanDocument(v2Md);
    if (!v2.ok) throw new Error(v2.report);
    const secondImport = importPlan(userDb, {
      parsed: v2,
      now: NOW,
      renames: [
        { from: "goblet-squat", to: "gobletsquat" },
        { from: "rear-delt-reverse-fly", to: "prone-reverse-fly" },
      ],
    });
    if (!secondImport.ok) throw new Error(secondImport.message);

    expect(readFileSync(secondImport.source_path, "utf8")).toBe(v2Md);

    userDb.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
});
