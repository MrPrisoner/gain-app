import { describe, expect, it } from "vitest";
import { confirmationFor, describeActivity, schemaNote } from "../../src/lib/admin/user-status";
import type { UserStats } from "../../src/lib/server/admin-stats";

const NOW = new Date("2026-08-17T09:00:00Z");

function stats(overrides: Partial<UserStats> = {}): UserStats {
  return {
    userId: "01KZKQ4GB22EEQBF20YDKD1BYE",
    displayLabel: "alice",
    oidcSub: "sub-1",
    createdAt: "2026-03-12T00:00:00.000Z",
    lastLoginAt: "2026-08-16T00:00:00.000Z",
    provisioned: true,
    plans: 1,
    planVersions: 1,
    workoutsStarted: 4,
    workoutsFinished: 3,
    setLogs: 88,
    lastWorkoutAt: "2026-08-14T07:00:00.000Z",
    diskBytes: 1024,
    schemaVersion: 2,
    ...overrides,
  };
}

describe("describeActivity", () => {
  it("names the empty account before anything else", () => {
    expect(describeActivity(stats({ provisioned: false, plans: 0 }), NOW)).toBe("No plan yet");
    expect(describeActivity(stats({ plans: 0 }), NOW)).toBe("No plan yet");
  });

  it("separates having a plan from having used it", () => {
    expect(describeActivity(stats({ workoutsStarted: 0, lastWorkoutAt: null }), NOW)).toBe(
      "Plan imported, not trained yet",
    );
  });

  it("reads recent training in days", () => {
    expect(describeActivity(stats({ lastWorkoutAt: "2026-08-17T06:00:00.000Z" }), NOW)).toBe(
      "Last trained today",
    );
    expect(describeActivity(stats({ lastWorkoutAt: "2026-08-16T06:00:00.000Z" }), NOW)).toBe(
      "Last trained yesterday",
    );
    expect(describeActivity(stats({ lastWorkoutAt: "2026-08-14T06:00:00.000Z" }), NOW)).toBe(
      "Last trained 3 days ago",
    );
  });

  it("switches to weeks, then months, as the gap grows", () => {
    expect(describeActivity(stats({ lastWorkoutAt: "2026-08-03T06:00:00.000Z" }), NOW)).toBe(
      "Last trained 2 weeks ago",
    );
    expect(describeActivity(stats({ lastWorkoutAt: "2026-05-17T06:00:00.000Z" }), NOW)).toBe(
      "Last trained 3 months ago",
    );
  });

  it("says 1 week rather than 7 days at the boundary", () => {
    expect(describeActivity(stats({ lastWorkoutAt: "2026-08-10T09:00:00.000Z" }), NOW)).toBe(
      "Last trained 1 week ago",
    );
  });
});

describe("confirmationFor", () => {
  it("uses the label when there is one", () => {
    expect(confirmationFor("alice", "01KZKQ4GB22EEQBF20YDKD1BYE")).toBe("alice");
  });

  it("falls back to the tail of the user id", () => {
    expect(confirmationFor(null, "01KZKQ4GB22EEQBF20YDKD1BYE")).toBe("KD1BYE");
  });
});

describe("schemaNote", () => {
  it("says nothing for an unprovisioned user", () => {
    expect(schemaNote(null, 2)).toBeNull();
  });

  it("says nothing once a user is on the current version", () => {
    expect(schemaNote(2, 2)).toBeNull();
  });

  it("names the gap for a user behind the current version", () => {
    expect(schemaNote(1, 2)).toBe("schema v1 of v2 — will migrate on next visit");
  });
});
