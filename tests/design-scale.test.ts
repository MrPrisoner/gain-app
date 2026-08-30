/**
 * No `.svelte` file may carry a bare type or gap value — every one goes through a token
 * from `src/app.css`. Written after the remap rather than before it, because its job is
 * to keep the pass from eroding: twenty-five distinct `font-size` values and eleven
 * `gap` values accumulated one component at a time, each individually reasonable.
 *
 * `padding` is deliberately not asserted. Multi-value shorthands (`0.7rem 1.25rem`) and
 * genuine one-offs (`1rem 1.25rem 1.5rem`) make a clean rule impossible without an
 * exemption list, and an exemption list is the thing that rots. `font-size` and `gap`
 * are single-valued, which is what makes them assertable at all.
 *
 * `border-radius` is also not asserted: it was already tokenised before this work (91 of
 * 99 uses), and its exceptions — `50%` on a circle, `999px` on a pill, `2px` on a
 * hairline — are real geometry rather than drift.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");

function svelteFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return svelteFiles(full);
    return e.isFile() && e.name.endsWith(".svelte") ? [full] : [];
  });
}

const FILES = svelteFiles(SRC);

/** `font-size: 1.15em` inside a comment is not a declaration; strip comments first. */
function styles(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

const PROPERTIES = ["font-size", "gap", "row-gap", "column-gap"] as const;

describe("design scale", () => {
  it("has files to check", () => {
    expect(FILES.length).toBeGreaterThan(30);
  });

  it.each(PROPERTIES)("every `%s` is a token", (property) => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const body = styles(fs.readFileSync(file, "utf8"));
      for (const [, value] of body.matchAll(new RegExp(`${property}:\\s*([^;]+);`, "g"))) {
        const v = value!.trim();
        if (v.startsWith("var(--") || v === "inherit" || v === "0") continue;
        offenders.push(`${path.relative(process.cwd(), file)}: ${property}: ${v}`);
      }
    }
    expect(offenders, `use a token from app.css:\n${offenders.join("\n")}`).toEqual([]);
  });
});
