# GAIN UI design system — phases 1 and 2

**This is a tracking document. Delete it when the work closes**, per CLAUDE.md's "Tracking
work, and folding it back in" — the durable half folds into `docs/UI-DECISIONS.md` §10 and
`src/app.css`'s module comment, and this file goes.

Approved 2026-08-30: systematise rather than redesign; phases 1 and 2 now, phase 3
re-reviewed afterwards; desktop gets the minimum treatment; both mechanical checks land
with the work.

---

## 1. The problem, measured

GAIN's *design* is sound. `docs/UI-DECISIONS.md` argues its case well and the runner
honours it — the rest overlay, the log strip and the wrap-up sheet are each individually
considered. Nothing about the information architecture or the interaction model is at
fault.

What is missing is the layer beneath them. The app has colour and radius tokens and
nothing else, so thirty-nine Svelte files each arrive at their own type, spacing and
elevation by eye. That is what "inconsistent and unpolished" means from the outside, and
it is measurable:

| Measure | Found | Target |
| --- | --- | --- |
| Distinct `font-size` values | 25 — ten of them between 0.75 and 1.1rem | 9-step scale |
| `<h1>` rules | 9 of 19 set no size at all, falling to the browser's 2em | one `PageHeader` |
| Distinct `gap` values | 11 | 7-step scale |
| Distinct `padding` values | 25+ | the same 7 steps |
| `font-weight` values | 6, of which `700` is 48 of the 76 uses | 5, each with a job |
| `box-shadow` declarations | **0** | 3 elevation tokens |
| `transition` declarations | **2** | duration + easing tokens |
| Components defining their own button CSS | 12 | one `Button` |
| `border-radius` | tokenised, 91 uses | already correct — leave it |

Two colour defects are measured rather than eyeballed, and both are real accessibility
failures:

- **`--dim` fails WCAG AA in both themes** — 2.80:1 on light ground, 3.79:1 on dark
  surface, against a 4.5:1 requirement. It carries genuine information across eleven
  files (upcoming exercises, ledger labels, chart captions), which is why an
  unlogged exercise row reads as *disabled* rather than as *not yet done*.
- **Surfaces are 1.08:1 against the ground** in both themes, and the border meant to
  rescue them is 1.24–1.30:1. Cards are all but invisible as objects. With no shadow
  anywhere in the codebase there is no elevation language at all — which is the single
  largest contributor to the flat, unfinished feel.

## 2. Scope

**In:** phase 1 (the token layer) and phase 2 (the component primitives), plus the two
mechanical checks in §7.

**Out, for now:** phase 3 — the screen-level judgement calls (home's five-identical-pills
nav, the duplicated plan name, progress's chart-height empty states, the effort keys'
undersized fill segments, native `<select>`/`<radio>` beside custom pills, destructive
actions styled neutral, and history's "1 sets" plural bug). These are recorded here so
they are not lost, and are re-reviewed against the finished system rather than guessed at
now.

**Out permanently:** anything that reopens `docs/UI-DECISIONS.md`. See §6.

## 3. Phase 1 — the token layer

All of this lands in `src/app.css`. It is additive: the tokens are defined and the
existing declarations are remapped onto them, but no screen gains or loses an element.

### 3.1 Type scale

The scale is not invented — it is the existing distribution, snapped. The dominant cluster
is real: 0.85rem and 0.9rem together account for 74 of the 124 declarations and mean the
same thing, so they collapse onto one token and the app's most-used text size finally has
a name.

| Token | Value | Replaces | Sites |
| --- | --- | --- | --- |
| `--t-2xs` | 0.75rem / 12px | `10px`, `12px`, `0.7rem`, `0.75rem` | 9 |
| `--t-xs` | 0.8125rem / 13px | `0.8rem`, `0.8125rem` | 8 |
| `--t-sm` | 0.875rem / 14px | `0.85rem`, `0.85em`, `0.875rem`, `0.9rem` | 74 |
| `--t-base` | 1rem / 16px | `0.95rem`, `1rem`, `1.05rem` | 14 |
| `--t-md` | 1.125rem / 18px | `1.1rem`, `1.15rem`, `1.2rem` | 4 |
| `--t-lg` | 1.375rem / 22px | `1.25rem`, `1.3rem`, `1.4rem` | 7 |
| `--t-xl` | 1.75rem / 28px | `1.5rem`, `1.6rem`, `2rem` | 4 |
| `--t-2xl` | 2.5rem / 40px | `2.5rem` | 1 |
| `--t-display` | `clamp(3rem, 14vw, 4rem)` | `3.5rem`, `4rem` | 3 |

Two notes on the moves that are visible rather than sub-pixel:

- **The 10px chart labels go to 12px.** Ten-pixel text is below any reasonable floor and
  these are read on a phone. `Sparkline` and `BarChart` are the only sites.
- **`--t-display` becomes fluid.** The rest timer's clock and the error/offline glyph are
  fixed at 3.5–4rem today; a clamp keeps them from crowding a 360px viewport while
  letting them grow on a tablet. This is the one type change that alters a runner
  screen, and it strictly reduces overflow risk.

### 3.2 Weight

`700` is currently applied to 48 of 76 declarations, so weight distinguishes nothing.
Plus Jakarta Sans is a variable face already loaded at `400..800`; give each step a job.
`750` is dropped — it exists twice and reads identically to `700`.

| Token | Weight | Job |
| --- | --- | --- |
| `--w-body` | 400 | body copy, prose, notes |
| `--w-medium` | 500 | meta lines, captions, units |
| `--w-semi` | 600 | card titles, buttons, labels |
| `--w-bold` | 700 | section headings, figures |
| `--w-display` | 800 | page titles, the rest timer |

### 3.3 Spacing

A 4/8px rhythm on the 16px base. As with type, the mapping is a snap of what is there.

| Token | Value | Replaces |
| --- | --- | --- |
| `--s-1` | 0.25rem / 4px | `0.15rem`, `0.25rem`, `0.3rem`, `3px` |
| `--s-2` | 0.5rem / 8px | `0.35rem`, `0.4rem`, `0.5rem` |
| `--s-3` | 0.75rem / 12px | `0.6rem`, `0.75rem` |
| `--s-4` | 1rem / 16px | `0.9rem`, `1rem` |
| `--s-5` | 1.5rem / 24px | `1.25rem`, `1.5rem` |
| `--s-6` | 2rem / 32px | `2rem` |
| `--s-7` | 3rem / 48px | `3rem` |

One derived token, because card padding is the most-repeated value in the app (33 sites at
`1.25rem`) and it is the one that decides how much content width a 360px phone has:

```css
--pad-card: var(--s-4);            /* 16px */
@media (min-width: 480px) { --pad-card: var(--s-5); }   /* 24px */
```

Tightening cards from 20px to 16px at phone width buys back 8px of usable line length per
nesting level, and the runner nests three deep — block, exercise, set row. That directly
serves UI-DECISIONS §12's 360px floor.

### 3.4 Colour corrections

Only the failing values change. The accent hue, the symptom triad and every semantic
meaning stay exactly as settled.

| Token | Was (dark / light) | Becomes | Why |
| --- | --- | --- | --- |
| `--dim` | `#6b7480` / `#8b95a1` | `#8d97a5` / `#68717d` | 4.5:1 against the *worst* surface in each theme (4.74 dark on hover, 4.56 light on ground) |
| `--ground` | `#0b0d10` / — | `#0a0c0f` / unchanged | widens the dark ladder slightly |
| `--surface` | `#14171c` / — | `#16191f` / unchanged | ditto |
| `--raised` | `#1b1f26` / — | `#1e222a` / unchanged | ditto |
| `--hover` | `#232831` / — | `#272c36` / unchanged | ditto |
| `--line` | `#272d36` / `#e3e7ec` | `#333a45` / `#dfe4ea` | a hairline that is actually visible in dark (1.54:1, was 1.30) |
| `--line-strong` | *new* | `#5c6674` / `#848e9a` | 3.02 / 3.32:1 — **control boundaries only** |

`--line-strong` exists because WCAG's non-text contrast rule applies to the boundary of a
control the user must identify — an input, a stepper, an unfilled button — and not to a
decorative card edge. Two tokens keeps the card hairline quiet without leaving form
controls illegible. Use `--line` for dividers and card edges; `--line-strong` for anything
you can tap or type into.

**One honest consequence of the `--dim` fix, recorded because it changes a design
premise.** At 4.5:1 the third text tier necessarily sits close to `--muted` — you cannot
have a legible tier much dimmer than muted and still pass. So `--dim` stops being a third
*luminance* step and becomes a size-and-weight distinction instead (`--t-sm` +
`--w-medium` against `--t-base` + `--w-semi`). This is not a regression: UI-DECISIONS §1's
own 2026-08-15 note already found that luminance alone was "too quiet to answer the
question a user actually asks mid-session", and added the completion tick for exactly that
reason. The same lesson applies one level down.

### 3.5 Elevation

Three steps, defined per theme because the two themes convey depth by opposite means —
light by shadow, dark by a lighter surface plus a visible hairline, since a shadow on a
near-black ground reads as nothing.

| Token | Used by |
| --- | --- |
| `--shadow-1` | cards, list rows |
| `--shadow-2` | sheets, the log strip, sticky chrome |
| `--shadow-3` | full-screen overlays, modals |

Light gets true shadows (`0 1px 2px` / `0 4px 12px` / `0 12px 32px`, all in
`rgba(15,19,25, …)`). Dark gets a much weaker shadow plus a 1px top inset highlight at
`rgba(255,255,255,0.04)`, which is what actually separates a raised surface from the one
behind it on a dark ground.

### 3.6 Motion

The app has two transitions in total, so every state change snaps. Tokens, plus a global
reduced-motion killswitch:

| Token | Value | Job |
| --- | --- | --- |
| `--dur-fast` | 120ms | press feedback, focus |
| `--dur-base` | 200ms | hover, colour, opacity |
| `--dur-slow` | 320ms | sheets, overlays |
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` | standard |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | entering |

`prefers-reduced-motion: reduce` collapses all three durations to `1ms` at the `:root`
level, which is a strict superset of the handling `CelebrationOverlay` already does for
itself — that component keeps its own particle-field opt-out, since removing motion there
means removing elements, not shortening a duration.

Press feedback must not shift layout bounds. Use `background`/`opacity`, never a
`transform: scale` on a control that sits in a flex row.

## 4. Phase 2 — component primitives

`src/lib/components/` currently holds five components, none of which is a general
primitive. Twelve files style their own buttons. The extraction is lower-risk than it
sounds, because the markup already converged on a vocabulary without anyone writing it
down: `class="primary"` appears 15 times, `secondary` 9, `quiet` 4, `danger` 1. Phase 2
formalises the convention that exists rather than imposing a new one.

Five primitives, each following the repo's existing rule that a route is thin and the
logic lives in `$lib`:

| Component | API | Replaces |
| --- | --- | --- |
| `Button.svelte` | `variant: primary \| secondary \| quiet \| danger`, `size: md \| lg`, `icon?`, `href?`, `disabled`, `pending` | 12 files' local button CSS |
| `Card.svelte` | `elevation: 1 \| 2`, `padding?` | ~14 hand-rolled card rules |
| `PageHeader.svelte` | `title`, `subtitle?`, `back?` | 19 `<h1>` sites, 9 of them unstyled |
| `Field.svelte` | `label`, `hint?`, `error?`, `for` | ad-hoc label/input pairs |
| `EmptyState.svelte` | `title`, `body?`, `action?` | the chart-height "No data yet" voids |

Four points that are decisions rather than mechanics:

- **`Button` renders an `<a>` when given `href`.** Half the "buttons" on the home screen
  are navigation, and today they are `<a>` elements hand-styled to look like buttons in
  one file and `<button>` elements in another. One component, correct element, one set of
  focus and press states.
- **`Button` owns the 44px floor.** `min-height: 2.75rem` is applied inconsistently today
  and absent entirely on `/admin`, `/account`, `/export`, `/import` and the layout chrome
  (UI-DECISIONS §12 says so). Putting it in the primitive is what makes the §7 check
  passable rather than a wall of individual fixes.
- **`PageHeader` settles the title inconsistency.** Right now `/export` puts its `<h1>`
  inside the card, `/progress` and `/history` put a browser-default 32px one outside it —
  which is what makes `Home Training Plan — progress` wrap to two lines at 390px — and
  home has no page title at all. One component, one treatment, `--t-lg` on phones.
- **`EmptyState` never reserves chart height.** `/progress` currently draws four
  full-height chart wells to say "No data yet" four times. The primitive is compact by
  construction.

`BackLink`, `MetricRow`, `Sparkline`, `BarChart` and `ArchivedNote` stay; they are remapped
onto the tokens but not restructured. `BackLink` is subsumed into `PageHeader`'s `back`
prop at its call sites, and kept as a component for the places that need it standalone.

## 5. Desktop — the minimum

Approved as minimum: no two-column layouts, no new navigation.

- A wider measure on the routes that are read rather than tapped — `/import`, `/export`,
  `/versions/[n]` — via a `--measure-wide` max-width, instead of every route sharing the
  phone column.
- `/import`'s paste box grows with the viewport (`min-height` in `vh`) rather than sitting
  as a short wide strip above two-thirds of empty screen.

That is the whole of it. The single centred column stays the app's shape.

## 6. What does not change

`docs/UI-DECISIONS.md` is settled and this work implements against it, not around it.
(It is renamed to `docs/UI.md` by §9.1; the decisions below are unchanged by that.)

- **§5 — one accent hue in the runner.** `ui-ux-pro-max` proposed an orange-and-green
  fitness palette; it is rejected. Green, amber and red belong to the plan's symptom
  framework and nothing else may compete with them.
- **§1 — one completion mark**, an accent tick, in all three places. Untouched.
- **§3 — no `2 × N` sub-line, no `paired` field.** Untouched.
- **§2 — the log strip's controls stay deliberately larger than 44px.** The floor in §4 is
  a floor, not a target, and must not shrink the strip.
- **§8 — the wrap-up scale stays an eleven-column grid that never wraps.**

The typographic direction is confirmed rather than changed: the `ui-ux-pro-max` search
independently returned Plus Jakarta Sans as the single-family system for this product
profile, with the 800/700/600/400 weight ladder §3.2 adopts. The font choice was already
right; only the discipline around it was missing.

## 7. Testing

Phase 1 is a wide, mechanical edit across nearly every `.svelte` file, which is precisely
the shape of change CLAUDE.md's "Rules learned the hard way" warns about: *"A whole-file
regex is how a space-significant string gets broken silently."* A previous whitespace pass
turned `.log-strip .strip-set` into `.log-strip.strip-set`, and `npm run verify` passed
clean. So:

- **No whole-file regex.** Remap one file at a time, and diff each for lost whitespace in
  selectors before moving on.
- `npm run verify` after each phase, and `npm run test:e2e` — not `verify` alone, which
  provably cannot see this class of breakage.

Two new mechanical checks land with this work, closing the two gaps UI-DECISIONS §12
already admits to:

1. **Touch targets.** Every interactive element is at least 44×44 CSS px, asserted at all
   three viewport projects. This is the same shape of assertion as the existing overflow
   sweep and catches the same class of desktop-invisible bug. `Button`'s floor (§4) is what
   makes it pass.
2. **Both themes everywhere.** The existing light-theme coverage is three screens, and the
   runner's theme spec is pinned to 360×800. Extend the theme forcing across home, import,
   export, progress, history and versions at all three viewports.

§12's own prose is updated to describe what is then true, rather than left claiming more
or less than the suite delivers.

## 8. Risks

- **Bulk remap breaking a selector silently.** Mitigated by §7's file-at-a-time rule and by
  `test:e2e` being mandatory rather than optional here.
- **The `--pad-card` tightening changing every screen's rhythm at once.** It is a single
  token, so it is one line to revisit if 16px reads as cramped on a real phone.
- **`--t-sm` absorbing 74 sites.** The move is ±0.4px per site, so the risk is not visual
  but that some site genuinely wanted to be different. Any that does gets an explicit
  different token, not a return to a bare rem value.
- **`--t-display`'s clamp on the rest timer.** The one runner-visible type change. Checked
  at 360, 390 and 768 in both themes before it stands.

## 9. The documentation outcome

Approved 2026-08-30, after auditing `docs/UI-DECISIONS.md` against the code. The audit
found the document broadly accurate — §1's three completion marks, §4's acquired-and-
released wake lock, §5's rendered symptom framework and §12's precise coverage claims
(including "44 px touch targets are asserted **nowhere**") all verify against the build.
It is not drifting, and nothing in it needs relitigating. Three things follow from this
work rather than from any fault in it.

### 9.1 `UI-DECISIONS.md` becomes `UI.md`

The document is titled "the session runner", and its closing section deliberately pushes
home, history and progress decisions elsewhere — ARCHITECTURE §9/§10 and CLAUDE.md's
Invariants. That split was correct while the runner was the only designed surface.

Phase 2 breaks it. `Button`, `Card` and `PageHeader` are app-wide, and the rules they
carry — the 44 px floor, the page-title treatment, the elevation steps — belong to no
single screen and have nowhere to live under the current split.

So: **rename it to `docs/UI.md`, leave §1–§9 untouched as the runner's decisions, and let
§10–§12 become the app-wide system section.** One document, broader title. A separate
`DESIGN-SYSTEM.md` was rejected for the reason CLAUDE.md gives elsewhere: it would leave
two standing documents that have to agree about colour, and eventually they would not.

Every inbound reference is updated in the same commit — CLAUDE.md links it twice, and
ARCHITECTURE and README each refer to it.

### 9.2 §1's premise is restated

§1 says hierarchy is "carried by **weight and luminance**, not by colour". The luminance
half is falsified by §3.4: at 4.5:1 the third text tier cannot sit far enough below
`--muted` for luminance alone to separate them. The document already half-admits this in
its own 2026-08-15 note — weight and luminance were "too quiet to answer the question a
user actually asks mid-session", which is why the completion tick was added.

Restate it rather than leave it standing: hierarchy is carried by **weight, size and
position**, with luminance as reinforcement and the accent tick as the explicit mark. A
premise the code contradicts is how the next reader re-derives the same finding.

### 9.3 `design/session-runner-mockup.html` is deleted

It was last touched 2026-08-14; §1's completion-mark decision is dated 2026-08-15, so the
mockup already cannot show the tick and already contradicts the built runner. The document
has narrowed it to "**proportion and density only**" — and proportion and density are
precisely what §3.1 and §3.3 change. After this work it is accurate about nothing, while
still looking authoritative to anyone who opens it. It goes in the commit that lands
phase 1, along with the paragraph in `UI.md`'s preamble that points at it.

`git show <sha>:design/session-runner-mockup.html` recovers it if anyone ever wants it.

## 10. When this closes

In the same commit that finishes the work:

- **Fold the durable half in.** `UI.md` §10 currently says only "a single family, no
  monospace, both themes first-class"; it gains the scale, the weight ladder, the spacing
  rhythm, the two-token border rule (`--line` vs `--line-strong`) and the reason `--dim`
  stopped being a luminance tier. `src/app.css`'s module comment gains the same in short
  form, since that is the file nobody editing a token can miss. §12 gains the two new
  checks from §7.
- **Carry the §9 documentation changes out** — the rename, the §1 restatement, the mockup
  deletion — rather than leaving them for a follow-up.
- **Record phase 3's list** wherever it is picked up next. It is deferred work, not a
  finding, so it does not belong in a standing document.
- **Delete this file.**
