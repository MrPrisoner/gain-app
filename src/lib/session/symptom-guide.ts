/**
 * The symptom guide (UI-DECISIONS §5): the plan's own
 * `safety.symptom_framework` (`docs/CONTRACT.md`), rendered rather than only exported.
 * Pure — takes the contract's `safety` block and returns a display-ready, canonically
 * ordered list, or `[]` when the plan declares none.
 *
 * The contract's middle level is spelled `yellow`; the design token is `--amber`
 * (UI-DECISIONS §5's vocabulary note). This module is the one place that mapping is
 * made, so it is a footnote everywhere else rather than a rediscovery.
 */

import type { Safety } from "../contract/schema";

export type SymptomGuideLevel = {
  level: "green" | "yellow" | "red";
  /** CSS custom property name, without the `var()` wrapper. */
  token: "--green" | "--amber" | "--red";
  label: string;
  /** The action, as the verb the sheet renders beside the colour — colour is
   * redundant, never the sole carrier (U1). */
  actionLabel: "Carry on" | "Modify" | "Stop";
  modifications: string[];
};

const TOKEN_BY_LEVEL = {
  green: "--green",
  yellow: "--amber",
  red: "--red",
} as const;

const ACTION_LABEL = {
  continue: "Carry on",
  modify: "Modify",
  stop: "Stop",
} as const;

const CANONICAL_ORDER = ["green", "yellow", "red"] as const;

/** Canonical green → yellow → red order, regardless of the declaration order in the
 * document — a plan author is not obliged to declare them in that order, and the sheet
 * should not depend on one who doesn't. */
export function symptomGuideLevels(safety: Safety | undefined): SymptomGuideLevel[] {
  const declared = safety?.symptom_framework ?? [];
  const bySeverity = new Map(declared.map((level) => [level.level, level]));

  const result: SymptomGuideLevel[] = [];
  for (const level of CANONICAL_ORDER) {
    const entry = bySeverity.get(level);
    if (!entry) continue;
    result.push({
      level,
      token: TOKEN_BY_LEVEL[level],
      label: entry.label,
      actionLabel: ACTION_LABEL[entry.action],
      modifications: entry.modifications ?? [],
    });
  }
  return result;
}

/** The `red` level alone, for the deviation sheet's `stop_red_flag` branch — that
 * control asks the user to stop without saying what stopping means, unless the level it
 * corresponds to is quoted right there. `undefined` when the plan declares no red
 * level, so the caller can fall back to plain text. */
export function redSymptomLevel(safety: Safety | undefined): SymptomGuideLevel | undefined {
  return symptomGuideLevels(safety).find((level) => level.level === "red");
}
