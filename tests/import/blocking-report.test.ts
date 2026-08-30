/**
 * The pasteable report for a blocked revision (review 2026-08-27, U3) — the other half
 * of CLAUDE.md's "every failed import produces a pasteable report" invariant, alongside
 * the parse-failure reports `tests/parse.test.ts` already covers.
 */

import { describe, expect, it } from "vitest";
import { blockingReport } from "../../src/lib/import/blocking-report";

describe("blockingReport", () => {
  it("names the plan and both version numbers, then lists every blocking problem", () => {
    const report = blockingReport({
      planSlug: "home-training",
      fromVersion: 3,
      toVersion: 4,
      blocking: [
        "based_on_version (2) does not match the current version (3)",
        "session 'a' has no blocks",
      ],
    });

    expect(report).toBe(
      [
        `GAIN could not accept version 4 of "home-training" as a revision of version 3. Fix the following and return a corrected document:`,
        "",
        "- based_on_version (2) does not match the current version (3)",
        "- session 'a' has no blocks",
      ].join("\n"),
    );
  });

  it("still produces a report with no bullets, addressed to the AI, when there is exactly one problem", () => {
    const report = blockingReport({
      planSlug: "home-training",
      fromVersion: 1,
      toVersion: 2,
      blocking: ["contract.plan.slug does not match the plan being revised"],
    });

    expect(report.split("\n")).toEqual([
      `GAIN could not accept version 2 of "home-training" as a revision of version 1. Fix the following and return a corrected document:`,
      "",
      "- contract.plan.slug does not match the plan being revised",
    ]);
  });
});
