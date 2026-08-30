# GAIN UI Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give GAIN a complete design-token layer and the five component primitives its markup already implies, so that type, spacing, elevation and motion stop being re-decided in thirty-nine files.

**Architecture:** Phase 1 adds tokens to `src/app.css` and remaps existing declarations onto them, area by area. Phase 2 extracts `Button`, `Card`, `PageHeader`, `Field` and `EmptyState` into `$lib/components/` and adopts them. Nothing about the information architecture, the runner's interaction model or the settled decisions in `docs/UI-DECISIONS.md` changes. Phase 3 (screen-level polish) is out of scope and listed in the spec's §2.

**Tech Stack:** SvelteKit (Svelte 5 runes), plain CSS custom properties, Vitest (node environment, no DOM), Playwright.

**Spec:** [`docs/superpowers/specs/2026-08-30-ui-design-system-design.md`](../specs/2026-08-30-ui-design-system-design.md)

## Global Constraints

- **Node 24 LTS.** `npm run verify` is the contract; run it before claiming a task done.
- **Svelte 5 runes only.** `$state`, `$derived`, `$props`, `$effect`. There is not one `export let` or `createEventDispatcher` in `src/`, and a new component written from memory is the likeliest place that breaks. Check `package.json` before trusting recall.
- **Never write a literal control character** — write the escape (`\u0000`, spelled out, not the character itself). Two checks enforce it, and `npm run check:chars` covers Markdown and CSS too. This plan's own first draft tripped it.
- **No whole-file regex, ever.** A previous bulk pass turned `.log-strip .strip-set` into `.log-strip.strip-set` and `npm run verify` passed clean. Remap one file at a time and read the diff.
- **`npm run verify` cannot see this class of change.** Every task that touches a `.svelte` file also runs the relevant Playwright project. `verify` proves it compiles; `test:e2e` proves it renders.
- **Prettier after every TypeScript/Svelte edit:** `npx prettier --write <file>`. `docs/`, `fixtures/`, `templates/` and `design/` are byte-sensitive and excluded — never remove them from `.prettierignore`.
- **Icons come from `~icons/lucide/*`** and carry no size or colour of their own. Never add `width`/`height` at a call site.
- **UI-DECISIONS is settled.** §5 (one accent hue in the runner; green/amber/red belong to the symptom framework), §1 (one completion mark), §3 (no `2 × N`, no `paired` field), §2 (strip controls stay larger than 44 px), §8 (the wrap-up scale never wraps). Implement against these.
- **Playwright viewport projects are named** `small-android` (360×800), `iphone` (390×844), `tablet-portrait` (768×1024) and `offline`. Not `phone` or `mobile`.
- **A killed Playwright run holds ports 4319/4320.** `ss -ltnp | grep -E '4319|4320'` names the pid.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `tests/design-tokens.test.ts` | Parses `src/app.css` and asserts every text/surface pair meets WCAG AA. The permanent guard against this regressing. |
| `tests/design-scale.test.ts` | Asserts no `.svelte` file carries a bare `font-size`/`gap` value outside the token set. |
| `src/lib/components/Button.svelte` | The one button. Owns variant, size, the 44 px floor, press feedback, and `href` → `<a>`. |
| `src/lib/components/Card.svelte` | Surface + elevation + padding. |
| `src/lib/components/PageHeader.svelte` | Page title, optional subtitle, optional back link. |
| `src/lib/components/Field.svelte` | Label + hint + error + control association. |
| `src/lib/components/EmptyState.svelte` | Compact "nothing here yet", never chart-height. |
| `e2e/touch-targets.spec.ts` | Every interactive element ≥ 44×44 px, all three viewports. |
| `e2e/theme-coverage.spec.ts` | Both themes across home, import, export, progress, history, versions. |

**Modified:** `src/app.css` (the token layer), all 39 `.svelte` files under `src/` (remap), `e2e/session-runner-theme.spec.ts` (its hardcoded `--ground` hex changes), `docs/UI-DECISIONS.md` → `docs/UI.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `README.md`.

**Deleted:** `design/session-runner-mockup.html`, and at the end both this plan and its spec.

---

## Task 1: The token contrast test, and the colour corrections that make it pass

This is the spine. `--dim` fails WCAG AA in both themes, and the light theme's entire symptom triad fails as text — findings that were measured, not eyeballed, and that a test can hold forever. Written first so the failure is real before the fix lands.

**Files:**

- Create: `tests/design-tokens.test.ts`
- Modify: `src/app.css` (the four palette blocks)
- Modify: `e2e/session-runner-theme.spec.ts:43-45` (its `GROUND` constant hardcodes `#0b0d10`)

**Interfaces:**

- Consumes: nothing.
- Produces: `readThemeTokens(theme: "light" | "dark"): Record<string, string>` and `contrastRatio(a: string, b: string): number`, exported from the test file.

- [ ] **Step 1: Write the failing test**

Create `tests/design-tokens.test.ts`:

```ts
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
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

function channel(c: number): number {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
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
      expect(contrastRatio(t[fg], t[bg]), `--${fg} on --${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(SEMANTIC_TEXT)("%s reads as body text on the surfaces it appears on", (fg) => {
    for (const bg of ["ground", "surface", "raised"] as const) {
      expect(contrastRatio(t[fg], t[bg]), `--${fg} on --${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("line-strong is a distinguishable control boundary", () => {
    for (const bg of SURFACES) {
      expect(
        contrastRatio(t["line-strong"], t[bg]),
        `--line-strong on --${bg}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("accent-in reads on an accent fill", () => {
    expect(contrastRatio(t["accent-in"], t.accent)).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/design-tokens.test.ts`

Expected: FAIL. `--line-strong` is undefined in both themes (the token does not exist yet), `--dim` fails on every surface, and the light theme's `--green`, `--amber` and `--red` all fail.

- [ ] **Step 3: Apply the corrected palettes**

In `src/app.css`, replace the colour values in **all four** blocks — `:root`, `@media (prefers-color-scheme: light) :root`, `:root[data-theme="light"]` and `:root[data-theme="dark"]`. The dark values go in `:root` and `[data-theme="dark"]`; the light values in the media query and `[data-theme="light"]`. Every value below is solved against the *worst* surface it can land on, not a convenient one.

Dark:

```css
--ground: #0a0c0f;
--surface: #16191f;
--raised: #1e222a;
--hover: #272c36;
--line: #333a45;
--line-soft: #22262f;
--line-strong: #727d8b;
--text: #f2f5f8;
--muted: #99a3b0;
--dim: #8d97a5;
--accent: #5b8def;
--accent-in: #0b0d10;
--accent-soft: rgba(91, 141, 239, 0.15);
--green: #3fa96a;
--amber: #d9a23f;
--amber-soft: rgba(217, 162, 63, 0.12);
--red: #e0655b;
```

Light:

```css
--ground: #f4f6f8;
--surface: #ffffff;
--raised: #f8fafb;
--hover: #eff2f5;
--line: #dfe4ea;
--line-soft: #edf0f4;
--line-strong: #7f8995;
--text: #0f1319;
--muted: #5c6672;
--dim: #646d78;
--accent: #2560cd;
--accent-in: #ffffff;
--accent-soft: rgba(37, 96, 205, 0.1);
--green: #277544;
--amber: #876314;
--amber-soft: rgba(135, 99, 20, 0.1);
--red: #b34038;
```

What changed and why, so a reviewer does not have to re-derive it:

| Token | Was → is | Reason |
| --- | --- | --- |
| `--dim` | `#6b7480` → `#8d97a5` (dark), `#8b95a1` → `#646d78` (light) | failed 4.5:1; now 4.74 dark on hover, 4.67 light on hover |
| `--ground`/`--surface`/`--raised`/`--hover` | dark ladder lifted one step | widens the separation the elevation tokens then reinforce |
| `--line` | `#272d36` → `#333a45` (dark), `#e3e7ec` → `#dfe4ea` (light) | a hairline that is actually visible in dark (1.54:1, was 1.30) |
| `--line-strong` | **new** | control boundaries at ≥3:1; `--line` stays quiet for card edges |
| `--accent` | unchanged (dark), `#2c6be0` → `#2560cd` (light) | the light accent failed on `--hover`; dark is untouched, so the brand hue is unchanged |
| `--green`/`--amber`/`--red` | unchanged (dark), all darkened (light) | the light triad sat at 3.93–4.63:1 **as text**, and `--red` names a failed import |

This preserves every *meaning*. §5's reservation is intact; the triad is the same triad, only legible.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/design-tokens.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Fix the theme spec's hardcoded ground**

`e2e/session-runner-theme.spec.ts` asserts the computed `body` background against a hardcoded hex. `--ground` changed in dark, so update it:

```ts
const GROUND = {
  dark: "rgb(10, 12, 15)", // #0a0c0f
  light: "rgb(244, 246, 248)", // #f4f6f8
} as const;
```

That spec failing is the check working, not a problem to route around.

- [ ] **Step 6: Verify nothing else regressed**

Run: `npm run verify`
Run: `npx playwright test --project=small-android e2e/session-runner-theme.spec.ts e2e/symptom-guide.spec.ts`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
npx prettier --write tests/design-tokens.test.ts e2e/session-runner-theme.spec.ts
git add tests/design-tokens.test.ts src/app.css e2e/session-runner-theme.spec.ts
git commit -m "fix(ui): make every colour token meet AA, and assert it off app.css"
```

---

## Task 2: Type, weight, spacing and motion tokens

Purely additive — the tokens are defined, nothing consumes them yet, and no screen changes. Splitting this from Task 3's remap keeps the "did anything move?" question answerable.

**Files:**

- Modify: `src/app.css`

**Interfaces:**

- Consumes: nothing.
- Produces: the `--t-*`, `--w-*`, `--s-*`, `--pad-card`, `--dur-*`, `--ease*`, `--shadow-*` and `--edge-top` custom properties, used by every later task.

- [ ] **Step 1: Add the scales to `:root`**

Append to the existing `:root` block in `src/app.css`, after the radius tokens:

```css
/* Type scale. Nine steps, snapped from the 124 `font-size` declarations that preceded
     them rather than imported from a ratio — `--t-sm` absorbs 74 of those on its own,
     because `0.85rem` and `0.9rem` were two spellings of one intention. */
--t-2xs: 0.75rem;
--t-xs: 0.8125rem;
--t-sm: 0.875rem;
--t-base: 1rem;
--t-md: 1.125rem;
--t-lg: 1.375rem;
--t-xl: 1.75rem;
--t-2xl: 2.5rem;
/* The two full-screen figures — the rest timer's clock and the error glyph. Fluid so
     they cannot crowd a 360 px viewport, which fixed 3.5–4rem could. */
--t-display: clamp(3rem, 14vw, 4rem);

/* Weight. Plus Jakarta Sans is loaded as a variable face at 400..800; before this,
     `700` was 48 of 76 declarations and weight therefore distinguished nothing. */
--w-body: 400;
--w-medium: 500;
--w-semi: 600;
--w-bold: 700;
--w-display: 800;

/* Spacing: a 4/8px rhythm on the 16px base. */
--s-1: 0.25rem;
--s-2: 0.5rem;
--s-3: 0.75rem;
--s-4: 1rem;
--s-5: 1.5rem;
--s-6: 2rem;
--s-7: 3rem;

/* Card padding is the most-repeated value in the app and the one that decides how much
     line length a 360px phone has — the runner nests three deep, so 4px per level is
     12px of content width. One token, so it is one line to revisit. */
--pad-card: var(--s-4);

/* Motion. Before these there were two transitions in the whole codebase, so every
     state change snapped. */
--dur-fast: 120ms;
--dur-base: 200ms;
--dur-slow: 320ms;
--ease: cubic-bezier(0.2, 0, 0, 1);
--ease-out: cubic-bezier(0, 0, 0.2, 1);
```

- [ ] **Step 2: Add the elevation tokens to each theme block**

The two themes convey depth by opposite means — light by shadow, dark by a lighter surface plus a hairline highlight, because a shadow on a near-black ground reads as nothing. So these belong in the four palette blocks, not in the shared `:root` scales above.

Dark (`:root` and `:root[data-theme="dark"]`):

```css
--shadow-1: 0 1px 2px rgba(0, 0, 0, 0.4);
--shadow-2: 0 4px 12px rgba(0, 0, 0, 0.45);
--shadow-3: 0 16px 40px rgba(0, 0, 0, 0.6);
--edge-top: inset 0 1px 0 rgba(255, 255, 255, 0.04);
```

Light (the media query and `:root[data-theme="light"]`):

```css
--shadow-1:
  0 1px 2px rgba(15, 19, 25, 0.06), 0 1px 3px rgba(15, 19, 25, 0.05);
--shadow-2:
  0 4px 12px rgba(15, 19, 25, 0.08), 0 1px 3px rgba(15, 19, 25, 0.06);
--shadow-3: 0 12px 32px rgba(15, 19, 25, 0.16);
--edge-top: none;
```

- [ ] **Step 3: Add the responsive card padding and the reduced-motion killswitch**

After the theme blocks:

```css
/* One step of breathing room once there is room to breathe. Phones keep 16px. */
@media (min-width: 480px) {
  :root {
    --pad-card: var(--s-5);
  }
}

/* A strict superset of the handling `CelebrationOverlay` already does for itself — that
   component removes its particle field, which is removing elements rather than
   shortening a duration, so it keeps its own opt-out as well. */
@media (prefers-reduced-motion: reduce) {
  :root {
    --dur-fast: 1ms;
    --dur-base: 1ms;
    --dur-slow: 1ms;
  }
}
```

- [ ] **Step 4: Confirm the token test still passes**

The `defines every token the other theme defines` case now also covers the shadow tokens, so a shadow added to one theme and not the other fails here.

Run: `npx vitest run tests/design-tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm nothing rendered differently**

Run: `npm run verify`
Run: `npx playwright test --project=iphone`
Expected: PASS. Nothing consumes the new tokens yet, so any failure here means a palette value from Task 1 is wrong, not a scale.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/app.css
git add src/app.css
git commit -m "feat(ui): add the type, weight, spacing, motion and elevation scales"
```

---

## Tasks 3–8: Remap each area onto the tokens

Six tasks, one per area, all the same shape. They are separated so a reviewer can reject one area's judgement without rejecting the others, and so a bisect lands on one area.

**The mapping table below is the whole specification.** Apply it literally; where a value is genuinely between two steps, round to the nearer and note it in the commit body rather than inventing a token.

| Was | Becomes |
| --- | --- |
| `10px`, `12px`, `0.7rem`, `0.75rem` | `var(--t-2xs)` |
| `0.8rem`, `0.8125rem` | `var(--t-xs)` |
| `0.85rem`, `0.85em`, `0.875rem`, `0.9rem` | `var(--t-sm)` |
| `0.95rem`, `1rem`, `1.05rem` | `var(--t-base)` |
| `1.1rem`, `1.15rem`, `1.2rem` | `var(--t-md)` |
| `1.25rem`, `1.3rem`, `1.4rem` | `var(--t-lg)` |
| `1.5rem`, `1.6rem`, `2rem` | `var(--t-xl)` |
| `2.5rem` | `var(--t-2xl)` |
| `3.5rem`, `4rem` | `var(--t-display)` |
| `font-weight: 750` | `var(--w-bold)` |
| `font-weight: 400/500/600/700/800` | `var(--w-body/medium/semi/bold/display)` |
| gap/padding `0.15rem`, `0.25rem`, `0.3rem`, `3px` | `var(--s-1)` |
| gap/padding `0.35rem`, `0.4rem`, `0.5rem` | `var(--s-2)` |
| gap/padding `0.6rem`, `0.75rem` | `var(--s-3)` |
| gap/padding `0.9rem`, `1rem` | `var(--s-4)` |
| gap/padding `1.25rem`, `1.5rem` | `var(--s-5)` |
| gap/padding `2rem` | `var(--s-6)` |
| gap/padding `3rem` | `var(--s-7)` |
| card padding of `1.25rem` | `var(--pad-card)` |

Each of Tasks 3–8 runs these five steps:

- [ ] **Step 1: Remap the area's files, one at a time.** Open each file, replace values by hand or with a _line-scoped_ edit. Never a whole-file regex — the bulk-edit failure this rule exists for turned `.log-strip .strip-set` into `.log-strip.strip-set` and passed `verify` clean.
- [ ] **Step 2: Read each diff.** Confirm no selector lost a space and no string literal changed. `git diff -- <file>` per file.
- [ ] **Step 3: `npm run verify`.** Expected: PASS.
- [ ] **Step 4: Run the area's Playwright coverage at all three viewports.** The exact command is named per task below. Expected: PASS, with no new horizontal-overflow failures — that assertion is the one that catches a token change pushing a fixed track off a 360px edge.
- [ ] **Step 5: `npx prettier --write` the changed files, then commit** with the message named per task.

### Task 3: Layout chrome and shared components

**Files:** `src/routes/+layout.svelte`, `src/routes/+error.svelte`, `src/routes/offline/+page.svelte`, `src/routes/login/+page.svelte`, `src/lib/components/BackLink.svelte`, `MetricRow.svelte`, `ArchivedNote.svelte`, `Sparkline.svelte`, `BarChart.svelte`

One substantive change beyond the mapping: `Sparkline.svelte:119` and `BarChart.svelte:95` use `10px` axis labels. Ten-pixel text is below any reasonable floor and these are read on a phone — they go to `var(--t-2xs)` (12px) like everything else in that row of the table.

**Test:** `npx playwright test e2e/home-walkthrough.spec.ts e2e/progress-walkthrough.spec.ts`
**Commit:** `refactor(ui): map the layout chrome and shared components onto the scales`

### Task 4: Home screen

**Files:** `src/routes/+page.svelte`, `NextSessionCard.svelte`, `NextMorningPrompt.svelte`, `ActivityStrip.svelte`, `ActivitySheet.svelte`, `SessionOverrideList.svelte`, `SessionSummary.svelte`

**Test:** `npx playwright test e2e/home-walkthrough.spec.ts e2e/archive-walkthrough.spec.ts`
**Commit:** `refactor(home): map the home screen onto the scales`

### Task 5: Session runner

The largest area and the one with the least margin for error — ten files, and `+page.svelte` alone is 866 lines. `--t-display` on `RestTimer.svelte:214` is the one type change that alters a runner screen, so check the timer at all three viewports in both themes before moving on.

**Files:** `src/routes/plan/[slug]/session/[key]/` — `+page.svelte`, `ExerciseCard.svelte`, `LogStrip.svelte`, `BlockSection.svelte`, `RestTimer.svelte`, `DeviationSheet.svelte`, `WrapUpSheet.svelte`, `SymptomGuideSheet.svelte`, `CelebrationOverlay.svelte`, `FigureIcon.svelte`

**Test:** `npx playwright test e2e/session-runner*.spec.ts e2e/symptom-guide.spec.ts e2e/rest-timer-announcement.spec.ts`
**Commit:** `refactor(session): map the runner onto the scales`

### Task 6: Import and export

**Files:** `src/routes/import/+page.svelte`, `ImportPlanForm.svelte`, `DiffGroups.svelte`, `DispositionList.svelte`, `src/routes/plan/[slug]/export/+page.svelte`

**Test:** `npx playwright test e2e/import-failures.spec.ts e2e/export-walkthrough.spec.ts e2e/revision-walkthrough.spec.ts`
**Commit:** `refactor(import): map import and export onto the scales`

### Task 7: Progress, history and versions

**Files:** `src/routes/plan/[slug]/progress/` (all four `+page.svelte`), `history/` (both), `versions/` (both)

**Test:** `npx playwright test e2e/progress-walkthrough.spec.ts e2e/history-walkthrough.spec.ts e2e/versions-walkthrough.spec.ts`
**Commit:** `refactor(progress): map progress, history and versions onto the scales`

### Task 8: Admin and account

**Files:** `src/routes/admin/+page.svelte`, `src/routes/account/+page.svelte`

**Test:** `npx playwright test e2e/admin-walkthrough.spec.ts e2e/account-reset-walkthrough.spec.ts`
**Commit:** `refactor(admin): map admin and account onto the scales`

---

## Task 9: Lock the scales in

Without this, the next component written from memory reintroduces `0.85rem` and the whole pass erodes one file at a time. Same shape as `tests/db/log-tables.test.ts`: assert the property off the real source, not off a list someone has to remember to update.

**Files:**

- Create: `tests/design-scale.test.ts`

**Interfaces:**

- Consumes: the `--t-*`/`--s-*` names defined in Task 2.
- Produces: nothing.

- [ ] **Step 1: Write the test**

```ts
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
        const v = value.trim();
        if (v.startsWith("var(--") || v === "inherit" || v === "0") continue;
        offenders.push(`${path.relative(process.cwd(), file)}: ${property}: ${v}`);
      }
    }
    expect(offenders, `use a token from app.css:\n${offenders.join("\n")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/design-scale.test.ts`
Expected: PASS if Tasks 3–8 were complete. **If it fails, it has found a file those tasks missed** — fix the file, not the test. Do not add an exemption list.

- [ ] **Step 3: Commit**

```bash
npx prettier --write tests/design-scale.test.ts
git add tests/design-scale.test.ts
git commit -m "test(ui): assert every type and gap value goes through a token"
```

---

## Task 10: The touch-target check, and the `Button` that makes it pass

UI-DECISIONS §12 states plainly that 44 px targets are "asserted **nowhere**", and that `min-height: 2.75rem` is absent on `/admin`, `/account`, `/export`, `/import` and the layout chrome. The check comes first so the gap is demonstrated, then the primitive closes it in one place rather than five.

**Files:**

- Create: `e2e/touch-targets.spec.ts`
- Create: `src/lib/components/Button.svelte`
- Modify: `src/routes/admin/+page.svelte`, `src/routes/account/+page.svelte`, `src/routes/plan/[slug]/export/+page.svelte`, `src/routes/import/+page.svelte`

**Interfaces:**

- Consumes: `--s-*`, `--t-*`, `--w-*`, `--dur-*`, `--ease`, `--line-strong`, `--accent`, `--accent-in`, `--hover`, `--red` from Tasks 1–2.
- Produces:

```ts
type ButtonProps = {
  variant?: "primary" | "secondary" | "quiet" | "danger"; // default "secondary"
  size?: "md" | "lg"; // default "md"
  href?: string; // renders <a> instead of <button>
  type?: "button" | "submit";
  disabled?: boolean;
  pending?: boolean; // disables and shows the pending label
  pendingLabel?: string;
  onclick?: (event: MouseEvent) => void;
  children: import("svelte").Snippet;
  icon?: import("svelte").Snippet;
};
```

- [ ] **Step 1: Write the failing check**

Create `e2e/touch-targets.spec.ts`:

```ts
/**
 * UI-DECISIONS §12's open gap, closed. Everything interactive is at least 44 CSS px in
 * both directions — the same shape of assertion as the overflow sweep, catching the same
 * class of bug: one that is invisible on a desktop browser and decides whether a control
 * can be hit at arm's length with sweaty hands.
 *
 * Asserted per route rather than per component, because the failure mode is a *screen*
 * whose controls were never given a floor — `/admin`, `/account`, `/export` and `/import`
 * used padding alone, with no minimum, before `Button` existed.
 */

import { expect, test, type Page } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";

const INTERACTIVE =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]';

async function undersized(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll(selector)) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const { width, height } = el.getBoundingClientRect();
      if (width === 0 && height === 0) continue;
      // An inline link inside a paragraph is text, not a control, and WCAG exempts it.
      if (el.tagName === "A" && style.display === "inline") continue;
      if (width < 44 || height < 44) {
        const label = (el.textContent ?? "").trim().slice(0, 30);
        bad.push(
          `${el.tagName.toLowerCase()} "${label}" ${Math.round(width)}x${Math.round(height)}`,
        );
      }
    }
    return bad;
  }, INTERACTIVE);
}

const ROUTES = [
  ["home", "/"],
  ["import", "/import"],
  ["account", "/account"],
  ["export", `/plan/${E2E_PLAN_SLUG}/export`],
  ["progress", `/plan/${E2E_PLAN_SLUG}/progress`],
  ["history", `/plan/${E2E_PLAN_SLUG}/history`],
  ["versions", `/plan/${E2E_PLAN_SLUG}/versions`],
] as const;

for (const [name, url] of ROUTES) {
  test(`${name} has no undersized touch target`, async ({ page }) => {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    expect(await undersized(page), "every control is at least 44x44 CSS px").toEqual([]);
  });
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test --project=small-android e2e/touch-targets.spec.ts`
Expected: FAIL on several routes, naming the undersized controls. Record that list in the commit body — it is the evidence the primitive is needed.

- [ ] **Step 3: Write `Button.svelte`**

Create `src/lib/components/Button.svelte`. The variant names are not invented: the markup had already converged on them without anyone writing them down — `class="primary"` appears 15 times, `secondary` 9, `quiet` 4, `danger` 1.

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    variant?: "primary" | "secondary" | "quiet" | "danger";
    size?: "md" | "lg";
    href?: string;
    type?: "button" | "submit";
    disabled?: boolean;
    pending?: boolean;
    pendingLabel?: string;
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
    icon?: Snippet;
  };

  let {
    variant = "secondary",
    size = "md",
    href,
    type = "button",
    disabled = false,
    pending = false,
    pendingLabel,
    onclick,
    children,
    icon,
  }: Props = $props();

  // A control that can post before its precondition exists must be disabled — the runner
  // once rendered every logging control while `?/start` was still in flight, and a fast
  // tap posted an empty workout id straight into a 500.
  const inert = $derived(disabled || pending);
</script>

{#if href}
  <a class="btn {variant} {size}" class:inert {href} aria-disabled={inert || undefined}>
    {#if icon}{@render icon()}{/if}
    {@render children()}
  </a>
{:else}
  <button class="btn {variant} {size}" {type} disabled={inert} {onclick}>
    {#if icon}{@render icon()}{/if}
    {#if pending && pendingLabel}{pendingLabel}{:else}{@render children()}{/if}
  </button>
{/if}

<style>
  /* The 44px floor lives here and nowhere else. Before this it was applied in eleven
     files and absent in five, which is why `e2e/touch-targets.spec.ts` could not pass. */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    min-height: 2.75rem;
    min-width: 2.75rem;
    padding: var(--s-2) var(--s-4);
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    font-size: var(--t-sm);
    font-weight: var(--w-semi);
    text-decoration: none;
    cursor: pointer;
    /* Never `transform` — a scale on a control inside a flex row shifts its neighbours. */
    transition:
      background-color var(--dur-fast) var(--ease),
      border-color var(--dur-fast) var(--ease),
      opacity var(--dur-fast) var(--ease);
  }

  .btn.lg {
    min-height: 3.25rem;
    padding: var(--s-3) var(--s-5);
    font-size: var(--t-base);
  }

  .btn:hover {
    text-decoration: none;
  }

  .primary {
    background: var(--accent);
    color: var(--accent-in);
  }

  .secondary {
    background: var(--surface);
    color: var(--text);
    border-color: var(--line-strong);
  }

  .quiet {
    background: transparent;
    color: var(--accent);
  }

  .danger {
    background: transparent;
    color: var(--red);
    border-color: var(--red);
  }

  .secondary:hover:not(:disabled),
  .quiet:hover:not(:disabled) {
    background: var(--hover);
  }

  .primary:active:not(:disabled),
  .secondary:active:not(:disabled),
  .quiet:active:not(:disabled),
  .danger:active:not(:disabled) {
    opacity: 0.85;
  }

  .btn:disabled,
  .btn.inert {
    opacity: 0.5;
    cursor: default;
    pointer-events: none;
  }
</style>
```

- [ ] **Step 4: Adopt it on the four routes the check names**

Replace the hand-styled buttons on `/admin`, `/account`, `/export` and `/import` with `<Button>`, deleting the local button CSS as you go. `/account`'s "Reset my data…" and `/admin`'s reset take `variant="danger"` — they are destructive and were styled as neutral as "History".

- [ ] **Step 5: Run the check and watch it pass**

Run: `npx playwright test e2e/touch-targets.spec.ts`
Expected: PASS at all three viewports.

- [ ] **Step 6: Verify**

Run: `npm run verify`
Run: `npx playwright test e2e/admin-walkthrough.spec.ts e2e/account-reset-walkthrough.spec.ts e2e/export-walkthrough.spec.ts e2e/import-failures.spec.ts`

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/components/Button.svelte e2e/touch-targets.spec.ts
git add -A
git commit -m "feat(ui): add the Button primitive and assert the 44px floor"
```

---

## Task 11: `PageHeader`, and both-theme coverage

The title treatment is the most visible inconsistency in the app: `/export` puts its `<h1>` inside the card, `/progress` and `/history` put a **browser-default 32px** one outside it — which is what makes "Home Training Plan — progress" wrap to two lines at 390 px — and home has no page title at all. Nine of nineteen `<h1>` rules set no size whatsoever.

**Files:**

- Create: `src/lib/components/PageHeader.svelte`
- Create: `e2e/theme-coverage.spec.ts`
- Modify: every route with an `<h1>`

**Interfaces:**

- Consumes: `BackLink.svelte`, `--t-lg`, `--w-display`, `--s-*`.
- Produces: `PageHeader` with `{ title: string; subtitle?: string; backHref?: string; backLabel?: string }`.

- [ ] **Step 1: Write the theme-coverage check**

Create `e2e/theme-coverage.spec.ts`. UI-DECISIONS §12 admits the light palette "is never rendered at 390 or 768, and never at all on home, import, export, progress, history or versions". This closes that.

```ts
/**
 * Both themes, on the six screens §12 says are never rendered in light at all. The
 * existing `session-runner-theme.spec.ts` covers the runner and pins itself to 360; this
 * covers everything else at whichever viewport project runs it.
 *
 * `colorScheme` is set through Playwright's own emulation rather than a `data-theme`
 * attribute, because `prefers-color-scheme` is the path a real user arrives on — the
 * attribute override already has coverage in the runner's spec.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import { assertNoHorizontalOverflow } from "./helpers";

const ROUTES = [
  ["home", "/"],
  ["import", "/import"],
  ["export", `/plan/${E2E_PLAN_SLUG}/export`],
  ["progress", `/plan/${E2E_PLAN_SLUG}/progress`],
  ["history", `/plan/${E2E_PLAN_SLUG}/history`],
  ["versions", `/plan/${E2E_PLAN_SLUG}/versions`],
] as const;

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    for (const [name, url] of ROUTES) {
      test(`${name} renders without overflow`, async ({ page }) => {
        await page.goto(url);
        await page.waitForLoadState("networkidle");
        await assertNoHorizontalOverflow(page);
        // Assert the theme actually took, not merely that a page rendered — the trap
        // `session-runner-theme.spec.ts`'s own header documents at length.
        const ground = await page.evaluate(
          () => getComputedStyle(document.body).backgroundColor,
        );
        expect(ground).toBe(scheme === "dark" ? "rgb(10, 12, 15)" : "rgb(244, 246, 248)");
      });
    }
  });
}
```

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/theme-coverage.spec.ts`
Expected: PASS (it is coverage, not a fix — if it fails, a token from Task 1 is wrong).

- [ ] **Step 3: Write `PageHeader.svelte`**

```svelte
<script lang="ts">
  import BackLink from "./BackLink.svelte";

  let {
    title,
    subtitle,
    backHref,
    backLabel = "Back to your plans",
  }: {
    title: string;
    subtitle?: string;
    backHref?: string;
    backLabel?: string;
  } = $props();
</script>

<header class="page-head">
  <h1>{title}</h1>
  {#if subtitle}<p class="sub">{subtitle}</p>{/if}
  {#if backHref}<BackLink href={backHref} label={backLabel} />{/if}
</header>

<style>
  .page-head {
    margin: 0 0 var(--s-5);
  }

  /* `--t-lg` rather than the browser's 2em. Nine of the nineteen h1 rules in this app
     set no size at all, which is why a plan name plus " — progress" wrapped to two lines
     on a 390px phone. */
  h1 {
    margin: 0;
    font-size: var(--t-lg);
    font-weight: var(--w-display);
    line-height: 1.2;
  }

  .sub {
    margin: var(--s-1) 0 0;
    color: var(--muted);
    font-size: var(--t-sm);
  }
</style>
```

- [ ] **Step 4: Adopt it everywhere**

Replace each route's `<h1>` and its local rule. The plan-scoped routes pass `backHref` so the stray "Back to your plans" link at the bottom of `/progress`, `/history` and `/versions` becomes part of the header instead of floating.

- [ ] **Step 5: Verify**

Run: `npm run verify`
Run: `npx playwright test e2e/theme-coverage.spec.ts e2e/touch-targets.spec.ts e2e/progress-walkthrough.spec.ts e2e/history-walkthrough.spec.ts e2e/versions-walkthrough.spec.ts e2e/export-walkthrough.spec.ts`

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/components/PageHeader.svelte e2e/theme-coverage.spec.ts
git add -A
git commit -m "feat(ui): add PageHeader and cover both themes on the six read screens"
```

---

## Task 12: `Card`, `Field` and `EmptyState`

The three remaining primitives, grouped because each is small and none needs a test of its own beyond the route coverage that already exists.

**Files:**

- Create: `src/lib/components/Card.svelte`, `Field.svelte`, `EmptyState.svelte`
- Modify: the routes that hand-roll each

**Interfaces:**

- Produces:
  - `Card` — `{ elevation?: 1 | 2; padded?: boolean; children: Snippet }`
  - `Field` — `{ label: string; id: string; hint?: string; error?: string; children: Snippet }`
  - `EmptyState` — `{ title: string; body?: string; children?: Snippet }`

- [ ] **Step 1: Write `Card.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    elevation = 1,
    padded = true,
    children,
  }: { elevation?: 1 | 2; padded?: boolean; children: Snippet } = $props();
</script>

<div class="card e{elevation}" class:padded>{@render children()}</div>

<style>
  /* Light conveys depth by shadow; dark by a lighter surface plus a hairline highlight,
     because a shadow on a near-black ground reads as nothing. `--edge-top` is `none` in
     light and an inset highlight in dark, so one rule serves both. */
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
  }

  .padded {
    padding: var(--pad-card);
  }

  .e1 {
    box-shadow: var(--shadow-1), var(--edge-top);
  }

  .e2 {
    box-shadow: var(--shadow-2), var(--edge-top);
  }
</style>
```

- [ ] **Step 2: Write `Field.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    label,
    id,
    hint,
    error,
    children,
  }: { label: string; id: string; hint?: string; error?: string; children: Snippet } =
    $props();
</script>

<div class="field">
  <label for={id}>{label}</label>
  {#if hint}<p class="hint" id="{id}-hint">{hint}</p>{/if}
  {@render children()}
  <!-- An error the user cannot see is worse than a crash: it belongs next to the control
       that failed, not at the bottom of the document in muted grey. -->
  {#if error}<p class="error" id="{id}-error" role="alert">{error}</p>{/if}
</div>

<style>
  .field {
    display: grid;
    gap: var(--s-2);
  }

  label {
    font-size: var(--t-sm);
    font-weight: var(--w-semi);
  }

  .hint {
    margin: 0;
    color: var(--muted);
    font-size: var(--t-sm);
  }

  .error {
    margin: 0;
    color: var(--red);
    font-size: var(--t-sm);
    font-weight: var(--w-medium);
  }
</style>
```

- [ ] **Step 3: Write `EmptyState.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    title,
    body,
    children,
  }: { title: string; body?: string; children?: Snippet } = $props();
</script>

<div class="empty">
  <p class="title">{title}</p>
  {#if body}<p class="body">{body}</p>{/if}
  {#if children}{@render children()}{/if}
</div>

<style>
  /* Compact by construction. `/progress` previously drew four full chart wells to say
     "No data yet" four times, which is most of a phone screen spent on absence. */
  .empty {
    display: grid;
    gap: var(--s-2);
    justify-items: start;
    padding: var(--s-4) 0;
    color: var(--muted);
  }

  .title {
    margin: 0;
    font-size: var(--t-sm);
    font-weight: var(--w-semi);
  }

  .body {
    margin: 0;
    font-size: var(--t-sm);
  }
</style>
```

- [ ] **Step 4: Adopt each**

`Card` on home, export, import, account, admin and the runner's blocks. `Field` on `/import`'s paste box and `/export`'s window picker. `EmptyState` on `/progress`'s four "No data yet" wells and `/history`'s empty list.

**Do not change `Sparkline`/`BarChart` themselves** — they render their container unconditionally by design, and assertions elsewhere depend on that. Swap the _caller's_ empty branch to `EmptyState`, leaving the chart components alone.

- [ ] **Step 5: Verify**

Run: `npm run verify`
Run: `npx playwright test`
Expected: the full suite passes. This is the broadest adoption task, so run everything.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/components/Card.svelte src/lib/components/Field.svelte src/lib/components/EmptyState.svelte
git add -A
git commit -m "feat(ui): add the Card, Field and EmptyState primitives"
```

---

## Task 13: Desktop minimum

Approved as _minimum_: no two-column layouts, no new navigation, the single centred column stays the app's shape.

**Files:**

- Modify: `src/app.css` (two tokens), `src/routes/+layout.svelte`, `src/routes/import/+page.svelte`

- [ ] **Step 1: Add the measure tokens**

In `src/app.css`'s `:root`:

```css
/* The app is one centred column. Routes that are *read* rather than tapped — the paste
     box, the export bundle, a plan version — get a wider one; everything else keeps the
     phone measure, because a session is a phone screen wherever it is opened. */
--measure: 44rem;
--measure-wide: 60rem;
```

- [ ] **Step 2: Apply it**

In `+layout.svelte`, have `.content`'s `max-width` read `var(--measure)`, and add a modifier class the wide routes opt into. Apply the wide measure on `/import`, `/export` and `/plan/[slug]/versions/[n]`.

- [ ] **Step 3: Grow the paste box**

`/import`'s textarea is a short wide strip above two-thirds of empty screen at 1440px. Give it `min-height: min(60vh, 40rem)` so it uses the viewport it is given while staying finite on a phone.

- [ ] **Step 4: Verify**

Run: `npm run verify`
Run: `npx playwright test e2e/import-failures.spec.ts e2e/export-walkthrough.spec.ts e2e/versions-walkthrough.spec.ts e2e/theme-coverage.spec.ts`
Expected: PASS. `tablet-portrait` (768) is the widest configured project, so also check 1440 once by hand with a throwaway spec under `e2e/` — screenshot it, read it, and **delete the spec before committing**.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): give the read-heavy routes a wider measure on desktop"
```

---

## Task 14: Fold the durable half in, and delete the scaffolding

The last task, and the one that must not be skipped: the spec's §9 and §10.

**Files:**

- Rename: `docs/UI-DECISIONS.md` → `docs/UI.md`
- Modify: `docs/UI.md` (§1's premise, §10, §12, the mockup paragraph), `src/app.css` (module comment), `CLAUDE.md`, `docs/ARCHITECTURE.md`, `README.md`
- Delete: `design/session-runner-mockup.html`, `docs/superpowers/specs/2026-08-30-ui-design-system-design.md`, `docs/superpowers/plans/2026-08-30-ui-design-system.md`

- [ ] **Step 1: Rename the document and update every reference**

```bash
git mv docs/UI-DECISIONS.md docs/UI.md
grep -rn 'UI-DECISIONS' --include='*.md' --include='*.ts' --include='*.svelte' . | grep -v node_modules
```

Update each hit. CLAUDE.md links it twice; ARCHITECTURE and README each refer to it. The document's own title becomes `# GAIN UI` and its opening paragraph explains the split: §1–§9 are the runner's decisions, §10–§12 are the app-wide system.

- [ ] **Step 2: Restate §1's premise**

§1 currently says hierarchy is "carried by **weight and luminance**, not by colour". The luminance half is false at 4.5:1 — the third text tier cannot sit far enough below `--muted` for luminance alone to separate them. Rewrite it as **weight, size and position**, with luminance as reinforcement and the accent tick as the explicit mark, and say in one sentence why (the contrast floor), so the next reader does not re-derive it.

- [ ] **Step 3: Rewrite §10 as the system section**

It currently says only "a single family, no monospace, tabular nums, both themes first-class". It gains: the nine-step type scale, the five-step weight ladder, the 4/8 spacing rhythm, `--pad-card`, the two-token border rule (`--line` for card edges, `--line-strong` at ≥3:1 for anything tappable), the elevation pair and why the two themes convey depth differently, the motion tokens, and the reason `--dim` stopped being a luminance tier.

- [ ] **Step 4: Update §12 with the two new checks**

It currently states, accurately, that 44 px is "asserted **nowhere**" and that light is rendered on three screens only. Both are now false in the app's favour. Replace with what `e2e/touch-targets.spec.ts` and `e2e/theme-coverage.spec.ts` actually assert — precisely, since this section has been corrected once already for over-claiming.

- [ ] **Step 5: Delete the mockup and the paragraph pointing at it**

```bash
git rm design/session-runner-mockup.html
```

Remove the preamble paragraph in `docs/UI.md` that introduces it. It was last touched 2026-08-14 and §1's completion-mark decision is dated 2026-08-15, so it already contradicted the built runner; this pass changed the proportion and density that were its last remaining claim to usefulness.

- [ ] **Step 6: Update `src/app.css`'s module comment**

Its header currently describes only the colour reservation. Give it the scales in short form — it is the one file nobody editing a token can miss.

- [ ] **Step 7: Delete the tracking documents**

```bash
git rm docs/superpowers/specs/2026-08-30-ui-design-system-design.md
git rm docs/superpowers/plans/2026-08-30-ui-design-system.md
```

No strikethrough, no "done" section, no archive directory. `git log` and `git show <sha>:<path>` recover anything that mattered. **Carry phase 3's list forward** into wherever the next piece of work is tracked — it is deferred work, not a finding, so it does not belong in a standing document.

- [ ] **Step 8: Final verification**

Run: `npm run verify`
Run: `npm run test:e2e`
Expected: the whole suite, including the `offline` project, passes.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "docs(ui): fold the design system into UI.md and retire the mockup"
```

---

## Self-Review

**Spec coverage.** §3.1 type → Task 2 + Tasks 3–8. §3.2 weight → same. §3.3 spacing and `--pad-card` → same. §3.4 colour → Task 1. §3.5 elevation → Task 2 (tokens) + Task 12 (`Card` consumes them). §3.6 motion → Task 2 + Task 10 (`Button`'s press feedback is the first consumer). §4 primitives → Tasks 10, 11, 12. §5 desktop → Task 13. §6 constraints → Global Constraints. §7 testing → Tasks 1, 9, 10, 11. §9 documentation → Task 14. §10 closure → Task 14. **No gaps.**

**Placeholders.** None. Every code step carries its code; the six remap tasks share one mapping table stated in full rather than "similar to Task 3".

**Type consistency.** `readThemeTokens`/`contrastRatio` are defined and exported in Task 1 and referenced by name thereafter. `Button`'s prop names in its interface block match its implementation. `Card`'s `elevation` is `1 | 2` in both its interface block and its `.e1`/`.e2` rules. `PageHeader`'s `backHref`/`backLabel` map onto `BackLink`'s existing `href`/`label` props.

**Two things deliberately left to the executor.** Tasks 3–8 name the files and the mapping but not each individual line, because there are roughly 300 of them and enumerating them would be less reliable than the table plus the two guard tests (Task 9 catches a missed value; the overflow assertion catches a wrong one). And Task 9 asserts `font-size` and `gap` but not `padding`, because shorthand padding cannot be checked without an exemption list — the reasoning is in the test's own header comment.
