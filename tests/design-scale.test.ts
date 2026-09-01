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

/**
 * `font-size` inside an SVG chart's `viewBox` is plotted in fixed coordinate units, not
 * the rem-based type scale — a token there grows past the plotted geometry under a
 * larger root font size and clips against the chart edge instead of just re-flowing
 * (Sparkline's `.point-label` sits 10 user-units above its point; a token pushed its
 * ascent past the chart's top edge). Two files, one property each, named explicitly
 * rather than matched by a pattern so a third file can't silently join the exemption.
 */
const EXEMPT: ReadonlySet<string> = new Set([
  "src/lib/components/Sparkline.svelte:font-size",
  "src/lib/components/BarChart.svelte:font-size",
]);

describe("design scale", () => {
  it("has files to check", () => {
    expect(FILES.length).toBeGreaterThan(30);
  });

  it.each(PROPERTIES)("every `%s` is a token", (property) => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const relative = path.relative(process.cwd(), file);
      if (EXEMPT.has(`${relative}:${property}`)) continue;
      const body = styles(fs.readFileSync(file, "utf8"));
      // A negative lookbehind on the property name keeps `gap` from substring-matching
      // `row-gap`/`column-gap`, and `[;}]` (rather than requiring `;`) still catches a
      // block's last declaration when it has no trailing semicolon before the `}`.
      const pattern = new RegExp(`(?<![a-zA-Z-])${property}:\\s*([^;}]+)[;}]`, "g");
      for (const [, value] of body.matchAll(pattern)) {
        const v = value!.trim();
        if (v.startsWith("var(--") || v === "inherit" || v === "0") continue;
        offenders.push(`${relative}: ${property}: ${v}`);
      }
    }
    expect(offenders, `use a token from app.css:\n${offenders.join("\n")}`).toEqual([]);
  });
});
