import { describe, expect, it } from "vitest";
import { occurredAtMsFor } from "../../src/lib/home/activity-when";

describe("occurredAtMsFor", () => {
  it('returns now unchanged for "now"', () => {
    const now = Date.parse("2026-08-15T18:00:00.000Z");
    expect(occurredAtMsFor("now", now)).toBe(now);
  });

  it('returns today at noon for "earlier_today" when now is in the afternoon', () => {
    const now = Date.parse("2026-08-15T18:00:00.000Z");
    expect(occurredAtMsFor("earlier_today", now)).toBe(Date.parse("2026-08-15T12:00:00.000Z"));
  });

  it('clamps "earlier_today" to now when now is before noon', () => {
    const now = Date.parse("2026-08-15T08:00:00.000Z");
    expect(occurredAtMsFor("earlier_today", now)).toBe(now);
  });

  it('returns yesterday at noon for "yesterday", regardless of the time of day now', () => {
    const now = Date.parse("2026-08-15T08:00:00.000Z");
    expect(occurredAtMsFor("yesterday", now)).toBe(Date.parse("2026-08-14T12:00:00.000Z"));
  });
});
