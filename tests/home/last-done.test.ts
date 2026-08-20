import { describe, expect, it } from "vitest";
import { lastDoneLabel } from "../../src/lib/home/last-done";

describe("lastDoneLabel", () => {
  it("answers the question a session row is actually asking", () => {
    expect(lastDoneLabel("2026-08-20", "2026-08-20")).toBe("today");
    expect(lastDoneLabel("2026-08-19", "2026-08-20")).toBe("yesterday");
    expect(lastDoneLabel("2026-08-17", "2026-08-20")).toBe("3 days ago");
  });

  it("says a session has never been done rather than saying nothing", () => {
    expect(lastDoneLabel(undefined, "2026-08-20")).toBe("not done yet");
  });

  it("switches to weeks once counting days stops being readable", () => {
    expect(lastDoneLabel("2026-08-14", "2026-08-20")).toBe("6 days ago");
    expect(lastDoneLabel("2026-08-13", "2026-08-20")).toBe("1 week ago");
    expect(lastDoneLabel("2026-08-06", "2026-08-20")).toBe("2 weeks ago");
    expect(lastDoneLabel("2026-06-25", "2026-08-20")).toBe("8 weeks ago");
  });

  /** Past a couple of months "9 weeks ago" stops being a fact anyone can place, and the
   * date is both shorter to read and more useful. */
  it("falls back to a date once the gap is too large to count", () => {
    expect(lastDoneLabel("2026-06-18", "2026-08-20")).toBe("18 Jun 2026");
    expect(lastDoneLabel("2025-12-31", "2026-08-20")).toBe("31 Dec 2025");
  });

  /** Month boundaries and leap days are exactly where a hand-rolled day count goes
   * wrong, and the failure is silent — a plausible number, off by one. */
  it("counts across month and year boundaries", () => {
    expect(lastDoneLabel("2026-07-31", "2026-08-01")).toBe("yesterday");
    expect(lastDoneLabel("2025-12-31", "2026-01-01")).toBe("yesterday");
    expect(lastDoneLabel("2024-02-29", "2024-03-01")).toBe("yesterday");
    expect(lastDoneLabel("2026-02-28", "2026-03-02")).toBe("2 days ago");
  });

  /**
   * `todayDate` is the server's date and `lastDoneDate` comes from a client-stamped
   * `started_at`, so a workout logged late in the evening in a timezone ahead of the
   * server can legitimately carry tomorrow's date. Reading "in 1 day" off a training
   * screen is worse than reading "today", and the difference never matters.
   */
  it("clamps a future date to today rather than counting forwards", () => {
    expect(lastDoneLabel("2026-08-21", "2026-08-20")).toBe("today");
  });

  it("does not guess at a date it cannot read", () => {
    expect(lastDoneLabel("not-a-date", "2026-08-20")).toBe("not-a-date");
  });
});
