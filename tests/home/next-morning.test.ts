import { describe, expect, it } from "vitest";
import type { MetricDef } from "../../src/lib/contract/schema";
import { dueNextMorningPrompts, type NextMorningCandidate } from "../../src/lib/home/next-morning";

const METRIC: MetricDef = {
  key: "symptoms_next_morning",
  label: "Hip / lower-back symptoms this morning",
  type: "scale",
  min: 0,
  max: 10,
  optional: true,
  prompt_when: "next_morning",
};

/**
 * A local instant (the runner's own timezone, whatever it is), so fixtures agree with
 * `dueNextMorningPrompts`'s local-calendar-day semantics wherever the suite happens to
 * run. A fixed UTC instant does not: `new Date("2026-08-13T23:59:59.999Z")` is still
 * August 13 in a UTC or negative-offset runner but has already rolled onto August 14 in
 * any positive-offset one (UTC+1 and later — most of Africa, Europe, Asia, Australia),
 * so a "midnight boundary" case built from fixed UTC strings passes or fails depending on
 * where `npm test` happens to run rather than on what the function actually does.
 */
function localMs(
  year: number,
  month1to12: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  return new Date(year, month1to12 - 1, day, hour, minute, second).getTime();
}

function candidate(overrides: Partial<NextMorningCandidate> = {}): NextMorningCandidate {
  return {
    workoutClientId: "wk-1",
    planSlug: "home-training",
    sessionKey: "A",
    finishedAt: new Date(localMs(2026, 8, 14, 20, 0, 0)).toISOString(),
    metrics: [METRIC],
    answeredKeys: [],
    ...overrides,
  };
}

// "Now" is local 2026-08-15 09:00 — the candidate's finishedAt (local Aug 14, evening) is
// the previous local calendar day.
const NOW = localMs(2026, 8, 15, 9, 0, 0);

describe("dueNextMorningPrompts", () => {
  it("surfaces a candidate finished the previous calendar day", () => {
    expect(dueNextMorningPrompts([candidate()], NOW, [])).toHaveLength(1);
  });

  it("excludes a candidate finished two days ago", () => {
    const old = candidate({ finishedAt: new Date(localMs(2026, 8, 13, 20, 0, 0)).toISOString() });
    expect(dueNextMorningPrompts([old], NOW, [])).toHaveLength(0);
  });

  it("excludes a candidate finished today", () => {
    const today = candidate({ finishedAt: new Date(localMs(2026, 8, 15, 2, 0, 0)).toISOString() });
    expect(dueNextMorningPrompts([today], NOW, [])).toHaveLength(0);
  });

  it("respects the local calendar-day boundary right at midnight", () => {
    const justBefore = candidate({
      finishedAt: new Date(localMs(2026, 8, 13, 23, 59, 59) + 999).toISOString(),
    });
    const justAfter = candidate({
      workoutClientId: "wk-2",
      finishedAt: new Date(localMs(2026, 8, 14, 0, 0, 0)).toISOString(),
    });
    expect(dueNextMorningPrompts([justBefore], NOW, [])).toHaveLength(0);
    expect(dueNextMorningPrompts([justAfter], NOW, [])).toHaveLength(1);
  });

  it("drops an already-answered metric rather than the whole candidate", () => {
    const partiallyAnswered = candidate({
      metrics: [METRIC, { ...METRIC, key: "other_metric", label: "Other" }],
      answeredKeys: ["symptoms_next_morning"],
    });
    const due = dueNextMorningPrompts([partiallyAnswered], NOW, []);
    expect(due).toHaveLength(1);
    expect(due[0]?.metrics.map((m) => m.key)).toEqual(["other_metric"]);
  });

  it("drops the whole candidate once every one of its metrics is answered", () => {
    const fullyAnswered = candidate({ answeredKeys: ["symptoms_next_morning"] });
    expect(dueNextMorningPrompts([fullyAnswered], NOW, [])).toHaveLength(0);
  });

  it("excludes a dismissed workout", () => {
    expect(dueNextMorningPrompts([candidate()], NOW, ["wk-1"])).toHaveLength(0);
  });
});
