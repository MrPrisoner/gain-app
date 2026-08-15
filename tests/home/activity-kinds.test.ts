import { describe, expect, it } from "vitest";
import { slugifyActivityKind, suggestActivityKinds } from "../../src/lib/home/activity-kinds";

describe("slugifyActivityKind", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyActivityKind("Squash")).toBe("squash");
    expect(slugifyActivityKind("Trail Run")).toBe("trail-run");
  });

  it("collapses runs of non-alphanumerics into one hyphen", () => {
    expect(slugifyActivityKind("Yoga / Pilates!!")).toBe("yoga-pilates");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugifyActivityKind("  -Surfing- ")).toBe("surfing");
  });

  it("returns an empty string for input with nothing sluggable", () => {
    expect(slugifyActivityKind("   ///  ")).toBe("");
  });
});

describe("suggestActivityKinds", () => {
  it("returns the kinds already used, most-recent-first, deduplicated", () => {
    const kinds = suggestActivityKinds([{ kind: "squash" }, { kind: "yoga" }, { kind: "squash" }]);
    expect(kinds.slice(0, 2)).toEqual(["squash", "yoga"]);
  });

  it("always includes rest, even with no activity history at all", () => {
    expect(suggestActivityKinds([])).toEqual(["rest"]);
  });

  it("never lists rest twice, whatever order history logged it in", () => {
    const kinds = suggestActivityKinds([{ kind: "rest" }, { kind: "squash" }]);
    expect(kinds.filter((k) => k === "rest")).toHaveLength(1);
  });

  it("caps the total at the given limit, rest always present within it", () => {
    const activities = ["a", "b", "c", "d", "e", "f", "g"].map((kind) => ({ kind }));
    const kinds = suggestActivityKinds(activities, 4);
    expect(kinds).toHaveLength(4);
    expect(kinds[3]).toBe("rest");
    expect(kinds.slice(0, 3)).toEqual(["a", "b", "c"]);
  });
});
