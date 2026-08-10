// tests/actions/focus-trap.test.ts
import { describe, expect, it } from "vitest";
import { nextTrapFocusTarget } from "../../src/lib/actions/focus-trap";

describe("nextTrapFocusTarget", () => {
  const elements = ["a", "b", "c"] as const;

  it("lets Tab move forward normally between middle elements", () => {
    expect(nextTrapFocusTarget(elements, "a", false)).toBeUndefined();
    expect(nextTrapFocusTarget(elements, "b", false)).toBeUndefined();
  });

  it("wraps Tab from the last element back to the first", () => {
    expect(nextTrapFocusTarget(elements, "c", false)).toBe("a");
  });

  it("lets Shift+Tab move backward normally between middle elements", () => {
    expect(nextTrapFocusTarget(elements, "c", true)).toBeUndefined();
    expect(nextTrapFocusTarget(elements, "b", true)).toBeUndefined();
  });

  it("wraps Shift+Tab from the first element back to the last", () => {
    expect(nextTrapFocusTarget(elements, "a", true)).toBe("c");
  });

  it("forces focus back onto the list when active is outside it (e.g. the heading)", () => {
    // The heading carries tabindex="-1" so it is reachable by trapFocus's initial
    // `.focus()` call but deliberately excluded from `elements` (the Tab cycle) — Tab
    // from there must land on the first real control, Shift+Tab on the last.
    expect(nextTrapFocusTarget(elements, "heading" as never, false)).toBe("a");
    expect(nextTrapFocusTarget(elements, "heading" as never, true)).toBe("c");
  });

  it("forces focus back onto the list when nothing is active at all", () => {
    expect(nextTrapFocusTarget(elements, null, false)).toBe("a");
    expect(nextTrapFocusTarget(elements, null, true)).toBe("c");
  });

  it("is a no-op on an empty list — nothing to trap focus inside", () => {
    expect(nextTrapFocusTarget([], null, false)).toBeUndefined();
    expect(nextTrapFocusTarget([], null, true)).toBeUndefined();
  });

  it("wraps a single-element list to itself in both directions", () => {
    expect(nextTrapFocusTarget(["only"], "only", false)).toBe("only");
    expect(nextTrapFocusTarget(["only"], "only", true)).toBe("only");
  });
});
