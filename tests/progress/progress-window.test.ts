import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROGRESS_WINDOW,
  progressWindowOptions,
  resolveProgressWindow,
} from "../../src/lib/progress/progress-window";

const NOW = new Date("2026-09-05T10:00:00Z");

describe("progressWindowOptions", () => {
  it("offers four spans in pill order, labelled for a phone", () => {
    expect(progressWindowOptions(NOW).map((o) => [o.id, o.label])).toEqual([
      ["4w", "4w"],
      ["12w", "12w"],
      ["26w", "6m"],
      ["all", "All"],
    ]);
  });

  it("dates each bounded span back from the injected clock", () => {
    const byId = new Map(progressWindowOptions(NOW).map((o) => [o.id, o]));
    expect(byId.get("4w")?.start).toBe("2026-08-08T10:00:00.000Z");
    expect(byId.get("12w")?.start).toBe("2026-06-13T10:00:00.000Z");
    expect(byId.get("26w")?.start).toBe("2026-03-07T10:00:00.000Z");
  });

  it("gives `all` no start, so it filters nothing", () => {
    expect(progressWindowOptions(NOW).find((o) => o.id === "all")?.start).toBeUndefined();
  });
});

describe("resolveProgressWindow", () => {
  it("defaults to 12w rather than to the first option", () => {
    expect(DEFAULT_PROGRESS_WINDOW).toBe("12w");
    expect(resolveProgressWindow(null, NOW).id).toBe("12w");
  });

  it("falls back to the default for an unrecognised id instead of failing", () => {
    // Deliberately unlike the export route, which must fail(400): nothing on a chart
    // screen leaves the app, so a silent substitution mislabels nothing.
    expect(resolveProgressWindow("since_version", NOW).id).toBe("12w");
    expect(resolveProgressWindow("", NOW).id).toBe("12w");
  });

  it("resolves each offered id to itself", () => {
    for (const option of progressWindowOptions(NOW)) {
      expect(resolveProgressWindow(option.id, NOW).id).toBe(option.id);
    }
  });
});
