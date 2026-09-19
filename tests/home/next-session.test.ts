import { describe, expect, it } from "vitest";
import { suggestNextSession } from "../../src/lib/home/next-session";

const SESSIONS = [
  { key: "A", order: 1 },
  { key: "B", order: 2 },
  { key: "C", order: 3 },
  { key: "D", order: 4 },
];
const SEQUENCE = ["A", "B", "C", "D"];
const DONE = "2026-08-12T09:00:00.000Z";

describe("suggestNextSession", () => {
  it("suggests the sequence's first entry with no history at all", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, []);
    expect(result.suggestedKey).toBe("A");
    expect(result.lastSession).toBeUndefined();
  });

  it("suggests the entry after the most recent in-sequence workout", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "B", startedAt: "2026-08-12T08:00:00.000Z", completedAt: DONE },
      { sessionKey: "A", startedAt: "2026-08-05T08:00:00.000Z", completedAt: DONE },
    ]);
    expect(result.suggestedKey).toBe("C");
  });

  it("wraps from the sequence's last entry back to its first", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "D", startedAt: "2026-08-12T08:00:00.000Z", completedAt: DONE },
    ]);
    expect(result.suggestedKey).toBe("A");
  });

  it("advances the cursor on any workout status — a stop is still an attempt", () => {
    // The caller (`recentWorkoutsForPlan`) now includes completed_at, which this function
    // uses to filter for finished workouts. A finished session — whether normally
    // completed or stopped with a red flag — advances the cursor. An abandonment
    // (completedAt === undefined) does not.
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "A", startedAt: "2026-08-12T08:00:00.000Z", completedAt: DONE },
    ]);
    expect(result.suggestedKey).toBe("B");
  });

  it("falls back to declared order when the plan has no sequence", () => {
    const result = suggestNextSession(SESSIONS, undefined, [
      { sessionKey: "B", startedAt: "2026-08-12T08:00:00.000Z", completedAt: DONE },
    ]);
    expect(result.suggestedKey).toBe("C");
  });

  it("falls back to declared order when the sequence is empty", () => {
    const result = suggestNextSession(SESSIONS, [], []);
    expect(result.suggestedKey).toBe("A");
  });

  it("ignores a workout on a session the sequence omits when finding the cursor", () => {
    // E is not in SEQUENCE. The most recent *in-sequence* workout is still A, so the
    // suggestion advances from A, not from E.
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "E", startedAt: "2026-08-13T08:00:00.000Z", completedAt: DONE },
      { sessionKey: "A", startedAt: "2026-08-12T08:00:00.000Z", completedAt: DONE },
    ]);
    expect(result.suggestedKey).toBe("B");
  });

  it("reports the very last workout as `lastSession` even when it is unsequenced", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "E", startedAt: "2026-08-13T08:00:00.000Z", completedAt: DONE },
      { sessionKey: "A", startedAt: "2026-08-12T08:00:00.000Z", completedAt: DONE },
    ]);
    expect(result.lastSession).toEqual({ key: "E", startedAtDate: "2026-08-13" });
  });

  it("builds one override entry per declared session, in order, with its own last-done date", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "B", startedAt: "2026-08-12T08:00:00.000Z", completedAt: DONE },
      { sessionKey: "A", startedAt: "2026-08-05T08:00:00.000Z", completedAt: DONE },
    ]);
    expect(result.overrides).toEqual([
      { key: "A", lastDoneDate: "2026-08-05" },
      { key: "B", lastDoneDate: "2026-08-12" },
      { key: "C", lastDoneDate: undefined },
      { key: "D", lastDoneDate: undefined },
    ]);
  });
});

describe("suggestNextSession and unfinished workouts", () => {
  it("does not advance the cursor past a workout that was never finished", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "B", startedAt: "2026-08-12T08:00:00.000Z", completedAt: undefined },
      { sessionKey: "A", startedAt: "2026-08-05T08:00:00.000Z", completedAt: DONE },
    ]);
    // B was abandoned, so A is still the last session that happened.
    expect(result.suggestedKey).toBe("B");
  });

  it("still advances on a finished workout of any status", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "B", startedAt: "2026-08-12T08:00:00.000Z", completedAt: DONE },
    ]);
    expect(result.suggestedKey).toBe("C");
  });

  it("skips an unfinished workout to reach the finished one behind it", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "C", startedAt: "2026-08-14T08:00:00.000Z", completedAt: undefined },
      { sessionKey: "B", startedAt: "2026-08-12T08:00:00.000Z", completedAt: DONE },
    ]);
    expect(result.suggestedKey).toBe("C");
  });

  it("reports no last session when the only workout is unfinished", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "A", startedAt: "2026-08-12T08:00:00.000Z", completedAt: undefined },
    ]);
    expect(result.lastSession).toBeUndefined();
  });

  it("does not report a lastDoneDate for a session only ever abandoned", () => {
    const result = suggestNextSession(SESSIONS, SEQUENCE, [
      { sessionKey: "A", startedAt: "2026-08-12T08:00:00.000Z", completedAt: undefined },
    ]);
    expect(result.overrides.find((o) => o.key === "A")?.lastDoneDate).toBeUndefined();
  });
});
