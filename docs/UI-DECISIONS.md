# GAIN UI decisions — the session runner

Settled in a design pass against
[`fixtures/plans/home-dumbbell-v1.md`](../fixtures/plans/home-dumbbell-v1.md),
before any code existed. Nothing here is built: the session runner is **phase 4**, and it
depends on the phase-1 round-trip core. See ARCHITECTURE §11.

These are decisions, not suggestions — implement against them rather than relitigating
them, the same way ARCHITECTURE §2 works. Where a decision has a *reason* attached, the
reason is the part that matters; if a future change makes the reason false, the decision
is open again.

The screen this describes is used **one-handed, mid-set, on a phone, in a garage**. Every
decision below falls out of that.

**There is a mockup**, at
[`design/session-runner-mockup.html`](../design/session-runner-mockup.html) — open it in a
browser, no build step and no network. It shows every decision here rendered with real
fixture data, including the awkward primitives in §6.

It is **illustrative, not authoritative.** This document is the specification; the mockup
is a snapshot of what it looked like on 2026-08-08. Where they disagree, this document
wins. Do not reverse-engineer behaviour from the markup, and do not treat its CSS as a
component library — the real implementation is SvelteKit.

---

## 1. Layout: a list, with one exercise open

Exercises render as a single scrolling list in prescribed order. The current one is
expanded and carries the set ledger; every other one collapses to a single line showing
name, target and completion state.

Rejected: one-card-at-a-time (you lose your place and can't see what's coming) and a flat
uniform list (the numbers you have to read and tap become too small).

Hierarchy is carried by **weight and luminance**, not by colour — see §5.

## 2. Effort is the commit action

The log strip is pinned to the bottom of the viewport, in the thumb zone. It contains a
reps stepper, a load stepper, and three effort keys: **Easy / Medium / Hard**.

Tapping an effort key **logs the set**. There is no separate save button.

Reps and load pre-fill from the last performance of that exercise, so the common case is
one tap. The steppers are for the exception, not the rule. This only works while
pre-filling is usually right — under double progression it is.

**Three keys, not four, and no RIR in the hot path.** Plans talk in RIR and the
contract may declare an optional `rir` metric, but users reliably know how hard a set
*felt* and do not reliably know their reps in reserve. `rir` stays supported as a declared
optional metric; it never appears in the log strip.

## 3. Load is total kilograms

A paired lift shows **12 kg**, not "6 kg each", with `2 × 6` beneath it as a quiet check.
Single-dumbbell movements (goblet squat, supported one-arm row) show the single dumbbell's
weight, because that is the total load being lifted.

One number, meaning the same thing in the log, the charts and the export.

**The dial steps 1 kg.** No per-load-configuration increment and no new contract field —
deliberately, to keep `loads` simple. An odd total on a paired lift displays as `2 × 5.5`,
which is exactly what 1.25 kg plates produce. The awkward-looking number is the honest one.

## 4. Rest runs itself, but only where the plan says so

When a set is logged, the rest timer takes **the whole screen** and names what is coming
next. You are not doing anything else during rest, and you are often reading it from a mat
at arm's length. A corner chip is the conventional choice and the wrong one here.

It appears **only where the contract declares `rest_sec`**. The warm-up and the abdominal
finisher declare none, so logging there moves straight on without an interruption. Do not
invent a default rest period.

Both escapes are always available: add 30 seconds, or start the next set early.

**Ranged rest is drawn honestly.** For `rest_sec: [60, 90]` the timer counts down to 60,
then keeps counting *up* inside a shaded 60–90 band, so the state reads "ready, and you
are at 1:14" rather than pretending 60 is a finish line.

## 5. Colour is reserved for meaning

**Green, amber and red belong to the plan's pain-response framework** (CONTRACT
`safety`, fixture §4) and appear nowhere decorative. One accent hue carries interactivity.
Everything else is neutral.

This forces a specific consequence: **Easy / Medium / Hard is a fill level, not a traffic
light.** One, two or three filled segments in the accent. Colouring "Hard" red would say
*stop* about the outcome the plan is usually trying to produce — the exact inversion
of what red means everywhere else in this app.

Semantic colour and accent colour must stay separate. Do not introduce a green "success"
state or a red "error" state that competes with the symptom scale.

## 6. The awkward primitives, and how each renders

The fixture exists to exercise these. A design that only handles `3 × 10 @ 20 kg` is not
finished.

| Primitive | Rendering |
|---|---|
| `tracking: checkoff` | Tappable pills. No set rows, no reps, no load, no effort. Excluded from progression. |
| `per_side: true` | One ledger row **per side** (L / R), because differing between sides is the entire reason the flag exists. |
| Ranged sets `[2, 3]` | Draw the **minimum** only, then offer "Add the optional 3rd set". Never pre-draw a set the plan did not commit to. |
| `type: rounds` | A round progress indicator on the block; the exercise list is **not** repeated per round. |
| `conditional: true` | The `condition` text is shown in full, with every declared substitute offered as a one-tap swap alongside "Do it". |
| Ranged reps `[8, 12]` | Shown as the target on each set row; the stepper pre-fills from last time, not from the range. |

## 7. Deviation is always one tap away

Skip, swap and add-a-set live behind a single control in the log strip, with the reason
captured as a chip (symptoms / fatigue / time / equipment / felt easy / other).

**If deviating is slower than lying, the log stops being true.** The reason is exported —
it is signal for the revising AI, not an apology.

## 8. Wrap-up asks only what is due now

End-of-session metrics render from the contract's declared `session` metrics, filtered by
`prompt_when`. Scales render as a row of tappable cells — one tap, no slider.

`prompt_when: next_morning` metrics are **not** asked at the end of the session. They are
surfaced the following day, and an unanswered one appears as a nudge on the Today screen.

## 9. The warm-up does not collapse

Six pills sit above the first working exercise every session. Small enough not to be in
the way; visible enough that it does not quietly stop happening.

## 10. Type and colour tokens

Typography is a single family — **Plus Jakarta Sans**, self-hosted, no CDN — with
`font-variant-numeric: tabular-nums` on every figure that can be compared vertically.

**No monospace anywhere.** Alignment is what monospace was doing, and tabular numerals do
it without the instrument-panel connotation. The app should read modern and clean, not
technical.

Both light and dark themes are first-class: define the palette as custom properties, style
components through the tokens only, and honour both `prefers-color-scheme` and an explicit
theme override.

---

## What this does not decide

Still open, and not blocking phase 1: the history and progress screens, the import review
and diff UI, the AI-template editor, the offline sync-state indicator, and onboarding for
a user's first import.
