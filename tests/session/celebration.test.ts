import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CELEBRATION_MESSAGES, pickCelebrationMessage } from "../../src/lib/session/celebration";

describe("pickCelebrationMessage", () => {
  it("picks the first message at 0 and the last just below 1", () => {
    expect(pickCelebrationMessage(() => 0)).toBe(CELEBRATION_MESSAGES[0]);
    expect(pickCelebrationMessage(() => 0.999999)).toBe(CELEBRATION_MESSAGES.at(-1));
  });

  it("reaches every message across the unit interval", () => {
    const seen = new Set<string>();
    for (let i = 0; i < CELEBRATION_MESSAGES.length; i++) {
      seen.add(pickCelebrationMessage(() => i / CELEBRATION_MESSAGES.length));
    }
    expect(seen.size).toBe(CELEBRATION_MESSAGES.length);
  });

  // The screen this feeds has no fallback: whatever comes back is rendered. `undefined`
  // reaching it would read as a blank celebration, which is worse than no celebration.
  it("always returns a real message, whatever the generator does", () => {
    fc.assert(
      fc.property(fc.double({ noDefaultInfinity: false, noNaN: false }), (value) => {
        expect(CELEBRATION_MESSAGES).toContain(pickCelebrationMessage(() => value));
      }),
    );
  });

  it("says nothing about goals, streaks or personal bests — GAIN cannot know any of them", () => {
    for (const message of CELEBRATION_MESSAGES) {
      expect(message).not.toMatch(/streak|personal best|\bPB\b|record|goal/i);
    }
  });
});
