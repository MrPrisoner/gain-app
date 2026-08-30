/**
 * The design tokens' accessibility contract, asserted off `src/app.css` itself rather
 * than off a duplicated table — the same reasoning as `tests/db/log-tables.test.ts`,
 * which asserts a property off `PRAGMA index_list` instead of off the DDL text.
 *
 * Two failures this was written to catch, both measured on the pre-token palette:
 * `--dim` sat at 2.80:1 on light ground and 3.79:1 on dark surface while carrying real
 * information across eleven files, and the *light* theme's whole symptom triad
 * (`--green`, `--amber`, `--red`) sat between 3.93 and 4.63:1 as text, on a screen where
 * `--red` names a failed import and `--amber` a warning.
 *
 * Scope note: the triad is asserted against `--ground`, `--surface` and `--raised`, the
 * three surfaces an error panel or a swatch actually sits on, and not against `--hover`.
 * `--hover` is a background for a pressed or hovered neutral control; no triad text and
 * no accent text lands on one today. If that changes, add it here — the value that would
 * then be needed is `--accent: #6b98f1` in dark, and a darker triad still.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = fs.readFileSync(path.join(process.cwd(), "src/app.css"), "utf8");

/** The body of the first `{...}` block following `selector`, brace-matched so a nested
 * rule cannot end it early. */
function blockAfter(selector: string): string {
  const start = CSS.indexOf(selector);
  if (start === -1) throw new Error(`no such selector in app.css: ${selector}`);
  const open = CSS.indexOf("{", start + selector.length);
  let depth = 0;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}" && --depth === 0) return CSS.slice(open + 1, i);
  }
  throw new Error(`unbalanced block for ${selector}`);
}

/**
 * Both explicit `data-theme` blocks are complete palettes by construction — `app.css`
 * duplicates them deliberately so a toggle wins in both directions — which is why they,
 * rather than the media query, are what this reads.
 */
export function readThemeTokens(theme: "light" | "dark"): Record<string, string> {
  const body = blockAfter(`:root[data-theme="${theme}"]`);
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) {
      tokens[name] = value.trim();
    }
  }
  return tokens;
}

function channel(c: number): number {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const values = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16) / 255));
  const [r, g, b] = values as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const values = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  const [hi, lo] = values as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["ground", "surface", "raised", "hover"] as const;
const TEXT_ON_EVERY_SURFACE = ["text", "muted", "dim", "accent"] as const;
const SEMANTIC_TEXT = ["green", "amber", "red"] as const;

describe.each(["light", "dark"] as const)("%s theme", (theme) => {
  const t = readThemeTokens(theme);

  it("defines every token the other theme defines", () => {
    const other = readThemeTokens(theme === "light" ? "dark" : "light");
    expect(Object.keys(t).sort()).toEqual(Object.keys(other).sort());
  });

  it.each(TEXT_ON_EVERY_SURFACE)("%s reads as body text on every surface", (fg) => {
    for (const bg of SURFACES) {
      const fgColor = t[fg];
      const bgColor = t[bg];
      if (!fgColor || !bgColor) throw new Error(`missing token: --${!fgColor ? fg : bg}`);
      expect(contrastRatio(fgColor, bgColor), `--${fg} on --${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(SEMANTIC_TEXT)("%s reads as body text on the surfaces it appears on", (fg) => {
    for (const bg of ["ground", "surface", "raised"] as const) {
      const fgColor = t[fg];
      const bgColor = t[bg];
      if (!fgColor || !bgColor) throw new Error(`missing token: --${!fgColor ? fg : bg}`);
      expect(contrastRatio(fgColor, bgColor), `--${fg} on --${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("line-strong is a distinguishable control boundary", () => {
    const lineStrong = t["line-strong"];
    if (!lineStrong) throw new Error("missing token: --line-strong");
    for (const bg of SURFACES) {
      const bgColor = t[bg];
      if (!bgColor) throw new Error(`missing token: --${bg}`);
      expect(contrastRatio(lineStrong, bgColor), `--line-strong on --${bg}`).toBeGreaterThanOrEqual(
        3,
      );
    }
  });

  it("accent-in reads on an accent fill", () => {
    const accentIn = t["accent-in"];
    const accent = t.accent;
    if (!accentIn || !accent)
      throw new Error(`missing token: ${!accentIn ? "--accent-in" : "--accent"}`);
    expect(contrastRatio(accentIn, accent)).toBeGreaterThanOrEqual(4.5);
  });
});
