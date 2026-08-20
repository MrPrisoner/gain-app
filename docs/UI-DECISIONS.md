# GAIN UI decisions — the session runner

Settled in a design pass against
[`fixtures/plans/home-training-v1.md`](../fixtures/plans/home-training-v1.md),
before any code existed. **Built in phase 4**, at
`src/routes/plan/[slug]/session/[key]/` with the pure logic in `src/lib/session/`; the
architectural half is ARCHITECTURE §9.

The build was made to conform to this document rather than the document to the build, and
that stays the direction of travel. Exactly one clause goes deliberately unbuilt — §3's
`2 × N` sub-line, for the reason recorded there.

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
component library — the real implementation is SvelteKit. Now that the runner is built,
the mockup is useful for **proportion and density only**.

---

## 1. Layout: a list, with one exercise open

Exercises render as a single scrolling list in prescribed order. The current one is
expanded and carries the set ledger; every other one collapses to a single line showing
name, target and completion state.

Rejected: one-card-at-a-time (you lose your place and can't see what's coming) and a flat
uniform list (the numbers you have to read and tap become too small).

**The list advances itself.** When the last set of an exercise is logged — and its rest,
if it has any, is done — the next exercise opens. Tapping any collapsed row still opens
it, so nothing is taken away; but the default path is never "hunt one-handed for the row
you are now on".

Hierarchy is carried by **weight and luminance**, not by colour — see §5.

### Settled 2026-08-15: one completion mark, everywhere

Weight and luminance alone turned out to be too quiet to answer the question a user
actually asks mid-session, which is not "where am I" but "how much of this have I
done". A finished row read as a slightly greyer version of an unfinished one, and the
warm-up pills had drifted into saying the same thing a completely different way — an
accent fill and an accent border, which is the visual language this app otherwise
reserves for *the thing you are about to tap*.

So there is now exactly one mark for finished, and it appears in three places: beside a
finished exercise's name, beside a checked-off warm-up pill, and beside a block heading
once everything in that block is done. A skip takes a dash rather than a tick and stays
neutral — a skip is finished-with, not achieved, and the export will say so too. The mark
is a tick in the accent hue, which keeps §5 intact: this is not a green "success" state
and must never become one.

Two consequences worth stating, because both were arrived at by trying the alternative:

- **The exercise row reserves the mark's width even when empty**, so names stay
  left-aligned down the list. **The pills deliberately do not**, because they are a wrap
  layout with no column to align, and reserving there cost the warm-up two extra rows at
  360 px — directly against §9.
- **Blocks are not exercises.** A `type: rounds` block only ever offers the current
  round's slots, so every exercise inside it reads as finished at the end of round 1 of 3.
  A rounds block's completion is the round counter and nothing else; anything that asks
  its exercises instead will mark a circuit complete two thirds early.

Sets are excluded on purpose. A set row already shows the reps, load and effort that were
logged, which is a stronger statement than a tick, and marking each one as well is clutter
in the densest part of the screen.

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

**The strip logs exactly one set** — the next unlogged one of the open exercise, per side
and per round where those apply. It names what it is about to write ("Set 2 of 3", "Side
plank — right") and what happened last time, and everything above it is a read-only
ledger. The exercise's own rows never carry inputs.

That is not only a tidiness argument, and it is the point at which this decision was once
nearly reversed: a first implementation put the inputs inline, one row per set. At 360 px
a row of set number + two number inputs + three effort keys has about 254 px to work in,
of which the fixed tracks take ~214 — and a browser's default `<input type="number">`
will not shrink below its ~170 px min-content width, so the row does not compress, it
overflows. One strip at the bottom removes the problem instead of demanding it be solved:
one set is being logged at a time, so it gets the full viewport, and read-only text
reflows.

**What the controls are:** a reps stepper, or a duration stepper for a `type: time`
exercise; a load stepper, **omitted entirely when the resolved load is bodyweight**; the
three effort keys, each with its **visible text label** as well as its fill; and the
deviation control (§7). Steppers are at least 44 px and want to be much larger.

**Pre-fill has a chain, not a source:** this session's own previous set of the same
exercise and side, else the last matching performance, else a configured default —
`default_kg` for weight, the reps or duration target's lower bound for reps/duration —
else blank. The within-session rung means a set bumped mid-exercise carries forward
instead of resetting every set; the configured-default rung is what makes a user's
*first* session one tap instead of blank, and it is the only reason `default_kg` is in
the contract at all.

**A failed write must be visible where the eyes already are.** Mid-set, an error rendered
at the bottom of the document is an error nobody sees, and a set that silently failed to
log looks exactly like one that succeeded. Errors surface adjacent to the strip, legible
at arm's length, dismissible — and **not in `var(--red)`**, which §5 has spoken for.

## 3. Load is total kilograms

A paired lift shows **12 kg**, not "6 kg each", with `2 × 6` beneath it as a quiet check.
Single-dumbbell movements (goblet squat, floor pullover) show the single dumbbell's
weight, because that is the total load being lifted.

One number, meaning the same thing in the log, the charts and the export.

### Settled 2026-08-10: the `2 × 6` sub-line is not built

The quiet check above needs GAIN to know a movement is performed with two dumbbells, and
**the contract has no field that says so.** `per_side` is not that field — the goblet
squat is single-dumbbell and not `per_side`, the floor press is paired and not `per_side`
— and adding a `paired` field means changing `docs/CONTRACT.md`, which ships verbatim in
every export and every bootstrap prompt. Judged not worth that surface.

So: **`weight_kg` is always the total being lifted**, the dial is labelled `kg total`, and
the sub-line is omitted. The invariant §3 actually exists to protect — one number meaning
one thing everywhere — is intact without it. This is settled, not an open task; do not
implement the sub-line and do not add the field on your own initiative.

One honest consequence follows, and is left alone deliberately. `default_kg` is written
per-dumbbell in the fixture's prose ("approximately 6 kg per dumbbell") while the log is a
total, and nothing can tell the two apart — so the very **first set** of a paired lift's
first-ever session pre-fills at half its true total. The user's correction carries forward
within that same session — set 2 pre-fills from what set 1 was actually logged as, not
from `default_kg` again — and full history takes over from the next session on. Inferring
"paired" from a slug or a load label would be a guess that is silently wrong; a number the
user corrects with two taps of the stepper is not. The real fix is upstream, in what the
authoring AI is told about loads.

**The dial steps 1 kg.** No per-load-configuration increment and no new contract field —
deliberately, to keep `loads` simple. An odd total on a paired lift — 11 kg — is exactly
what 1.25 kg plates produce, so it is a real weight and not a rounding error. The
awkward-looking number is the honest one.

**The load configuration is named on screen**: its `label` beside the dial ("Heavy
configuration"), its `note` in the expanded exercise. The plan already said which
configuration this movement uses and why; repeating it costs nothing and answers "which
dumbbells do I pick up" without leaving the session.

## 4. Rest runs itself, but only where the plan says so

When a set is logged, the rest timer takes **the whole screen** and names what is coming
next. You are not doing anything else during rest, and you are often reading it from a mat
at arm's length. A corner chip is the conventional choice and the wrong one here.

It appears **only where the contract declares `rest_sec`** — taken from the prescription,
falling back to the catalogue. Do not invent a default rest period.

Two kinds of block never rest between exercises, whatever the catalogue says: **checkoff**
blocks, which record no sets at all, and **rounds** blocks, where moving straight to the
next movement is the entire point. A rounds block may declare its own `rest_sec`, which
rests *between rounds* — so the abdominal finisher pauses once after round one, not four
times.

Both escapes are always available: add 30 seconds, or start the next set early.

**Ranged rest is drawn honestly.** For `rest_sec: [60, 90]` the timer counts down to 60,
then keeps counting *up* inside a shaded 60–90 band, so the state reads "ready, and you
are at 1:14" rather than pretending 60 is a finish line. The band is **drawn**, not
described in a caption — a fixed `rest_sec: 45` has no band and simply counts down, then
counts up as over.

**What is coming next is named on the overlay**, with its target: "Set 3 of 3 · 8–12 reps
at 12 kg", or the next exercise where the current one is finished. A full-screen timer
that shows only a number wastes the one screen the user is definitely looking at.

The screen takes a **wake lock** while resting, and releases it — a lock acquired after
the overlay has already closed is a leak that outlives the session.

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

**One narrow exception, settled 2026-08-15:** the post-session celebration screen's
confetti (§8) is accent, gold and silver — genuinely decorative, and deliberately kept out
of the green/amber/red triad rather than added to it. It is confined to a single
full-screen moment that carries no plan or symptom data; nothing else in the app gets this
exception.

**A second narrow exception, settled 2026-08-17:** the reset control on `/admin` is red.
The triad above belongs to the plan's pain-response framework, and it earns its
exclusivity on the surfaces where a user reads their own body signals — the session
runner, progress, the export. `/admin` renders no plan and no symptom data at all, so
there is no scale for red to compete with there, and red is the conventional signal for an
irreversible destructive action. The exception covers that button and the panel it sits
in, on that route, and nothing else: not the error message inside that panel, which stays
`var(--text)` because red-on-red is unreadable, and not destructive styling anywhere that
renders plan or symptom data. Note also what is *not* coloured — the per-user activity
line reads "Last trained 6 weeks ago" rather than showing an amber dot, because a sentence
needs no legend and the triad could not have been borrowed for it anyway.

## 6. The awkward primitives, and how each renders

The fixture exists to exercise these. A design that only handles `3 × 10 @ 20 kg` is not
finished.

| Primitive | Rendering |
|---|---|
| `tracking: checkoff` | Tappable pills. No set rows, no reps, no load, no effort. Excluded from progression. |
| `per_side: true` | One ledger row **per side** (L / R), because differing between sides is the entire reason the flag exists. |
| Ranged sets `[2, 3]` | Draw the **minimum** only, then offer "Add the optional 3rd set". Never pre-draw a set the plan did not commit to. |
| `type: rounds` | A round progress indicator on the block; the exercise list is **not** repeated per round. Rest fires between rounds only, and only if the block declares it. |
| `conditional: true` | The `condition` text is shown in full, with every declared substitute offered as a one-tap swap alongside "Do it". |
| Ranged reps `[8, 12]` | Shown as the target on each set row; the stepper pre-fills from last time, or the range's lower bound with no history — never the range's upper bound or its full target label. |
| Ranged duration `[20, 40]` sec | Same rule as ranged reps, for a `type: time` exercise's duration stepper — last time, else the range's lower bound. |

**A range is formatted, never interpolated.** In the contract a range is a tuple, so
dropping it into a template renders `8,12` and `20,40 sec` — which happened, to nearly
every prescription in the fixture at once, and reads as a typo rather than as a bug. One
formatter, en dash (U+2013), used at every site that shows a target.

**Adding the optional set is not a deviation.** The ranged-set "add the 3rd set" tap is
the plan being followed to the top of its declared range, and it writes no `deviation`
row. §7's `add_set` — a fourth set of a `sets: 3` prescription — is a departure from the
plan and does. The two paths look identical on screen and must not be merged in code.

**A swap takes the substitute's identity and the slot's targets.** Name, `type`,
`per_side`, `load` and `note` come from the substitute, because those are properties of a
movement and a substitute is a different movement — a `per_side` substitute really does
want L/R rows, a bodyweight one really does want the load dial gone. `sets`, `rest_sec`
and the rep target come from the occasion being replaced, because the substitute has no
prescription of its own for *this* slot. The condition does not carry over: swapping is
the answer to the prompt, so re-asking it on the movement you just chose is noise. Where
the substitute's `type` differs from the original's — the fixture's reverse-crunch →
front-plank, reps replaced by time — the plan has simply never said how long to hold it,
so the target renders as the set count alone rather than inventing a number.

### Settled 2026-08-15: a celebration screen sits between Finish and home

Tapping Finish used to write the finish op and navigate straight to `/`. It now shows a
full-screen celebration first — a randomised one-line message and a burst of falling
confetti — with a single "Back to home" button, dismissed by that button, Escape, or
nothing else. `WrapUpSheet` no longer navigates on success at all; it reports
`onFinished()` and the session route decides what comes after, which is what makes this
addable without touching where the finish op is written or what it does.

**The screen is a moment, never a step.** It renders after the finish op has already
landed and the workout's local key has already been cleared — `WrapUpSheet`'s `finish()`
does both before calling `onFinished()`. A user who backgrounds the phone, kills the
browser or otherwise never taps through has still finished a completed workout; nothing
about the screen is on the critical path of anything the export depends on.

**A red-flag stop does not reach it.** `onRedFlagStop` still ends the workout and
navigates home directly. A session that ended because something hurt is not an occasion,
and confetti over it would be the app cheering at the wrong moment — the same reasoning
that keeps `stopped` off any progress framing elsewhere in the export.

**The message claims only what GAIN actually knows.** The plan is authored and progressed
by an AI outside this app, so GAIN has no goal, streak or personal best to congratulate —
claiming one would be inventing a fact. Every message says only that a session was started
and finished, which is always and exactly true whenever the screen shows.

**Colour stays inside §5, with one named exception.** The confetti uses the accent hue
plus gold and silver rather than the plan's green/amber/red symptom triad — genuinely
multi-hued confetti would put "stop" red on screen in the moment right after training,
which is the opposite of what red means here. This is the one deliberately decorative use
of colour in the whole app, scoped to a single full-screen, session-agnostic moment that
carries no plan data; §5's rule against a green "success" state stands everywhere else.

**Neither ending leaves the session on the history stack.** "Back to home" and a
red-flag stop both replace the session's history entry rather than pushing home on top of
it, so Back from the home screen cannot walk back into a workout that is already over.
Both used to assign the browser's location directly, which pushes: the session URL stayed
on the stack and Back restored the page from bfcache with the celebration still showing,
so a user tapping Back to put the phone down got the confetti a second time over a
workout they had finished minutes earlier. A phone's Back button is how an app is left,
and the last screen of a session is exactly where it gets pressed.

**`prefers-reduced-motion: reduce` removes the particle field, not the screen.** The
message and the way home stay exactly as they are; only the falling motion goes. This is
the first reduced-motion handling anywhere in the app, on the one screen most likely to
need it — forty-odd animating elements across the full viewport is exactly the kind of
motion the preference exists to suppress.

## 7. Deviation is always one tap away

Skip, swap and add-a-set live behind a single control in the log strip, with the reason
captured as a chip (symptoms / fatigue / time / equipment / felt easy / other).

**If deviating is slower than lying, the log stops being true.** The reason is exported —
it is signal for the revising AI, not an apology.

**A deviation changes the screen, not only the database.** A skip collapses the exercise
showing that state and advances; a swap re-renders the slot as the substitute and logs
every later set against it; add and drop change the ledger's rows. A deviation that
writes its row and leaves the runner untouched is worse than one that does nothing at
all — the user believes they skipped, keeps logging into the slot they thought they left,
and the export tells the next AI they performed the movement the plan warned them off.

## 8. Wrap-up asks only what is due now

End-of-session metrics render from the contract's declared `session` metrics, filtered by
`prompt_when`. Scales render as a row of tappable cells — one tap, no slider.

**A row means a row.** An 0–10 scale is eleven cells in an eleven-column grid, which fits
at 320 px. Letting the cells wrap turns a scale into three ragged lines and destroys the
one thing that made it readable at a glance: position meaning magnitude.

**`prompt_when: start` metrics are asked before the runner opens**, not folded into the
wrap-up — "energy before" collected after the session is a different measurement. Same
rendering, same write path, all skippable, and a skipped metric writes nothing.

`prompt_when: next_morning` metrics are **not** asked at the end of the session. They are
surfaced the following day, and an unanswered one appears as a nudge on the Today screen.
Until that screen exists the wrap-up says so in as many words — a question the user can
see was declared and not asked needs to look deliberate, or it looks dropped.

**Both sheets scroll.** A wrap-up with three scales, or the deviation sheet with six
reason chips and a note field, is taller than a phone; without `max-height` and
`overflow-y` the top of it goes off-screen with no way to reach it. Both also honour
`env(safe-area-inset-bottom)`, take focus on open and return it on close, trap it while
open, and close on Escape.

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

## 11. First run, and every crossing to an AI

ARCHITECTURE §1 and §7 hold the detail. What binds them to the UI:

**Getting to an AI and back is the primary flow, not a settings-menu chore.** A user who
finds the handoff clumsy stops revising, and an unrevised plan is a notes app. Judge every
screen that touches this boundary by whether a round trip is one tap out and one paste
back.

- **Empty state is honest about what GAIN is.** "GAIN doesn't write plans — an AI does."
  Then one button that produces the whole prompt. Do not bury it behind a wizard.
- **Four questions, all skippable**, and the answers are **never stored** — they only fill
  a template the user copies. Nothing is written until a plan is imported.
- **Copy is the primary action**, download the fallback. Assume a phone with a chat open
  in another tab and no usable filesystem.
- **One document per crossing.** Never "copy this, and also copy that."
- **Import errors are addressed to the AI**, not the user: field path, expected, found,
  copy-pasteable in one tap. The user's fix is to paste the error back into the chat.
  Never show raw YAML, never ask them to edit it, never say only "import failed".
- **A failed import is a normal step**, so it must not feel like a wall. Keep the pasted
  text in place, and put the copy-the-error action next to it.
- **A pasted export bundle is a wrong-document error, not a parse failure.** It is a
  predictable mistake — the bundle is the last thing the user copied. Name it: "that is a
  GAIN export, not a plan. Paste what your AI gave you." Never a field-path error, and
  never an attempt to import it anyway.

---

## 12. The phone is the target, and it is checked mechanically

The narrow viewport is not a responsive afterthought here; it is the device the screen
exists for. **360 × 800 is the floor**, and every screen is also checked at 390 × 844 and
768 × 1024, in both themes.

`document.documentElement.scrollWidth <= window.innerWidth` is asserted on every screen at
every viewport, with the sheets and the rest overlay open as well as closed. **No
horizontal overflow, ever.** This is one assertion and it is worth more than any amount of
eyeballing: the failure it catches is a fixed-width track that silently pushes a control
off the edge, which looks like nothing at all on a desktop browser. `npm run test:e2e`
(Playwright, kept out of `npm run verify` — ARCHITECTURE §12) is where it lives.

Everything interactive is at least 44 px, and the log strip's controls are deliberately
larger than that. Sweaty hands, a phone on the floor, arm's length.

---

## What this does not decide

Still open: the Today/home screen with suggested-next-session, the history and progress
screens, and the offline sync-state indicator.
