import { describe, expect, it } from "vitest";
import { ulidAt } from "../helpers/ulid-at";
import {
  RESUME_WINDOW_MS,
  isResumable,
  workoutStartedAtMs,
} from "../../src/lib/session/workout-age";

const NOW = new Date("2026-09-19T20:00:00.000Z");

describe("workoutStartedAtMs", () => {
  it("decodes the start time a ULID client id carries", () => {
    const ms = Date.parse("2026-09-19T14:02:00.000Z");
    expect(workoutStartedAtMs(ulidAt(ms))).toBe(ms);
  });

  it("returns undefined for anything that is not a ULID", () => {
    // A client id from a future format, or a corrupted localStorage value. Guessing a
    // time here would silently gate resume on a fabricated number.
    expect(workoutStartedAtMs("not-a-ulid")).toBeUndefined();
    expect(workoutStartedAtMs("")).toBeUndefined();
  });
});

describe("isResumable", () => {
  it("is true just inside the window", () => {
    expect(isResumable(ulidAt(NOW.getTime() - RESUME_WINDOW_MS + 1000), NOW)).toBe(true);
  });

  it("is false exactly at the window", () => {
    expect(isResumable(ulidAt(NOW.getTime() - RESUME_WINDOW_MS), NOW)).toBe(false);
  });

  it("is false past the window", () => {
    expect(isResumable(ulidAt(NOW.getTime() - RESUME_WINDOW_MS - 1000), NOW)).toBe(false);
  });

  it("is false for an undecodable client id", () => {
    // Refusing to resume is the safe direction: the cost of a wrong `false` is starting
    // a fresh workout, and the cost of a wrong `true` is a multi-day session duration
    // in the export.
    expect(isResumable("not-a-ulid", NOW)).toBe(false);
  });

  it("is true for a clock that has gone backwards", () => {
    // A device clock corrected backwards can put `started_at` in the future. That is a
    // session started moments ago, not an ancient one.
    expect(isResumable(ulidAt(NOW.getTime() + 60_000), NOW)).toBe(true);
  });
});

describe("RESUME_WINDOW_MS", () => {
  it("is twelve hours", () => {
    expect(RESUME_WINDOW_MS).toBe(12 * 60 * 60 * 1000);
  });
});
