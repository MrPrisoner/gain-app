# GAIN UI

Settled in a design pass against
[`fixtures/plans/home-training-v1.md`](../fixtures/plans/home-training-v1.md),
before any code existed. It is built, at `src/routes/plan/[slug]/session/[key]/` with the
pure logic in `src/lib/session/`; the architectural half is ARCHITECTURE §9.

**§1–§9 are the session runner's decisions** — settled first, against one screen used
one-handed, mid-set, on a phone, in a garage. **§10–§12 are the app-wide system** — the
token layer, the shared component primitives (`Button`, `Card`, `PageHeader`, `Field`,
`EmptyState`), and the two mechanical checks that hold every screen to the same floor.
That half exists because rules like the 44px touch-target minimum and the page-title
treatment belong to no single screen, and by the time `Button` and `PageHeader` existed
this document's "session runner" title no longer covered what it decided.

The build was made to conform to this document rather than the document to the build, and
that stays the direction of travel. **Exactly one clause goes deliberately unbuilt** —
§3's `2 × N` sub-line, for the reason recorded there. §5's symptom triad was also unbuilt
for most of this project's life, but through drift rather than decision; it is built now,
and §5 describes what exists.

These are decisions, not suggestions — implement against them rather than relitigating
them, the same way ARCHITECTURE §2 works. Where a decision has a *reason* attached, the
reason is the part that matters; if a future change makes the reason false, the decision
is open again.

The screen §1–§9 describe is used **one-handed, mid-set, on a phone, in a garage**. Every
decision below falls out of that.

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

Hierarchy is carried by **weight, size and position**, with luminance as reinforcement and
the accent tick (below) as the explicit mark — not by colour, see §5. Luminance alone
cannot do the job: at the WCAG 4.5:1 contrast floor §10 holds every text tier to, a third
tier cannot sit far enough below `--muted` to read as a distinct step by darkness alone, so
a design that leaned on luminance to carry hierarchy would be leaning on a gap too narrow
to see.

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

**What is coming next is named on the overlay**, as a name and two lines beneath it — a
context line naming where you are, then a row of icon-tagged figures below it: ⇅ reps or
⏱ time, and 🏋 the load. Two lines rather than one long sentence, and figures rather than
a fourth prose clause, because this is the one screen the user is definitely looking at
and the numbers on it are the ones they act on — the same reps/load iconography
`LogStrip`'s dials use, via the shared `FigureIcon` component, so the overlay and the
strip can never drift onto different glyphs for the same figure.

**The context line says whatever the strip behind it will say**, with one exception. Mid
exercise it is the coming slot ("Set 3 of 3", and "Round 2 of 2" between the rounds of a
circuit) — the same `formatSlotContext` the log strip's own context line is built from,
so dismissing the overlay can never reveal a different answer than the overlay gave. The
exception is crossing to a *new* exercise in a sequence block, where the useful figure is
the whole prescription rather than its first slot: "Dumbbell floor press" / "3 sets",
because nothing of that movement has been logged yet and "Set 1 of 3" says less. A rounds
block gets no such exception — a circuit's unit is the round, and a between-rounds
overlay reading "1 set" is both useless and a contradiction of the strip underneath it.

**Both shapes carry the load**, and the cross-exercise one carries it for the *first* set.
The load is the figure the user acts on during rest — it is what sends them to the rack —
so an overlay that names it only from set two onward is silent at the one moment it is
most useful, and the user has to dismiss the timer to find out what to load. The number
shown is the pre-fill the log strip is about to offer for that slot, never a second
derivation of it: a plate change and the dial that follows it can never disagree. It is
labelled "12 kg **total**", the same unit the strip's own dial carries, because §3 leaves
paired lifts with no `2 × N` sub-line to disambiguate them — and this is the number
someone reads on the way to the dumbbells.

The screen takes a **wake lock** while resting, and releases it — a lock acquired after
the overlay has already closed is a leak that outlives the session.

## 5. Colour is reserved for meaning

**One accent hue carries interactivity. Everything else is neutral.** That is the whole of
the rule as built, and the session runner honours it strictly: there is no colour anywhere
in the runner beyond the accent, and the one completion mark (§1) is an accent tick rather
than a green one.

This forces a specific consequence, and it is the part of this section that has always
been true: **Easy / Medium / Hard is a fill level, not a traffic light.** One, two or three
filled segments in the accent. Colouring "Hard" red would say *stop* about the outcome the
plan is usually trying to produce — the exact inversion of what red would mean if it meant
anything here.

### Corrected 2026-08-27, settled 2026-08-28: the symptom triad is built, and the reservation is back

For most of this project's life this section opened by reserving green, amber and red for
"the plan's pain-response framework (CONTRACT `safety`, fixture §4)", and forbade a success
green or an error red anywhere that might compete with it — while the framework itself had
never been rendered. The 2026-08-27 review (D1, D2) caught the gap: `safety.symptom_framework`
was parsed, validated, stored and exported, and no route or component ever read it back, so
the reservation was protecting the legibility of a scale that was never drawn, and the
`--green` token sat defined in all four theme blocks at zero call sites.

**The gap is closed.** `$lib/session/symptom-guide.ts` turns a plan's `safety` block into a
canonically-ordered (`green` → `yellow` → `red`), token-mapped, display-ready list — pure,
unit-tested, no framework. The runner's header carries a "Symptom guide" trigger, shown
only when the plan declares a framework at all, opening `SymptomGuideSheet.svelte`: each
level's label, its action as a verb ("Carry on" / "Modify" / "Stop"), its modifications, and
`safety.escalation` as a closing note. `DeviationSheet`'s `stop_red_flag` choice quotes the
`red` level inline, so the runner's one safety-critical control now says what stopping
means rather than asking blind. `e2e/symptom-guide.spec.ts` opens both from a real session
and asserts the fixture's own level text is on screen, not merely that a sheet's shell
rendered — the vacuous-assertion trap CLAUDE.md records under "Rules learned the hard
way".

**What is true now:**

- **Colour is never the sole carrier.** Every level renders its label and action word
  regardless of hue — the swatch reinforces, it does not replace. This is the same rule U1
  raised elsewhere in the runner (the symptom *scale*, a different surface — see below).
- **Inside the ordinary flow of the runner — logging sets, resting, the ledger — there is
  still no colour but the accent.** The symptom guide sheet and the red-flag quote inside
  the deviation sheet are the one exception, and it is the exception the original
  reservation was written for: this *is* the pain-response framework, not a second
  unrelated colour system competing with it.
- **Outside the runner, `--red` and `--amber` carry their ordinary meanings** — a blocking
  error, a destructive action, a warning — in the import review, the export screen, the
  sync banner, `/admin` and `/account`.
- **`--green` now has its first call sites**, in the symptom guide's `green` level
  swatch. Note how they reach CSS: `symptom-guide.ts` maps each level to a token *name*
  and the components interpolate it (`style:background={`var(${level.token})`}`), so
  grepping for a literal `var(--green)` finds nothing and reports the token as dead. It
  is not. Do not "clean up" an apparently-unused colour token without checking
  `TOKEN_BY_LEVEL` first.

**One vocabulary note, applied.** The contract's middle level is spelled `yellow`; the
design token is `--amber`. `symptom-guide.ts`'s `TOKEN_BY_LEVEL` is the one place that
mapping is made, so a future edit maps onto it rather than rediscovering the spelling
mismatch.

This section's rule from its preamble held: a decision's reason had gone false, so the
decision was open again, and building the framework closed it. Nothing here is a decision
still to make.

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

## 10. The token system

Everything below lives in `src/app.css`. Before these tokens existed, thirty-nine
`.svelte` files each arrived at their own type size, spacing value and shadow by eye — that
is what "inconsistent and unpolished" meant from the outside. The tokens are the standard
new code is expected to reach for; they are not yet a claim that every screen already does,
and the gaps that remain are named precisely below rather than smoothed over.

**Type** is a single family — **Plus Jakarta Sans**, self-hosted, no CDN — with
`font-variant-numeric: tabular-nums` on every figure that can be compared vertically, and a
nine-step scale rather than a bare `rem` at each call site:

| Token | Value | Typical use |
| --- | --- | --- |
| `--t-2xs` | 0.75rem / 12px | chart labels — the smallest text in the app |
| `--t-xs` | 0.8125rem / 13px | secondary meta |
| `--t-sm` | 0.875rem / 14px | the default — most of the app's text reads at this step |
| `--t-base` | 1rem / 16px | body copy, form values |
| `--t-md` | 1.125rem / 18px | sub-headings |
| `--t-lg` | 1.375rem / 22px | `PageHeader`'s `<h1>` |
| `--t-xl` | 1.75rem / 28px | prominent standalone figures |
| `--t-2xl` | 2.5rem / 40px | the largest static figure |
| `--t-display` | `clamp(3rem, 14vw, 4rem)` | the rest timer's clock and the error glyph — fluid so a fixed size cannot crowd a 360px viewport |

**No monospace anywhere.** Alignment is what monospace was doing, and tabular numerals do
it without the instrument-panel connotation. The app should read modern and clean, not
technical.

**Weight** is a five-step ladder, each with exactly one job — before it existed, `700` was
roughly half of every `font-weight` declaration in the app, so weight distinguished
nothing:

| Token | Weight | Job |
| --- | --- | --- |
| `--w-body` | 400 | body copy, prose, notes |
| `--w-medium` | 500 | meta lines, captions, units |
| `--w-semi` | 600 | card titles, buttons, labels |
| `--w-bold` | 700 | section headings, figures |
| `--w-display` | 800 | page titles, the rest timer |

**Spacing** is a 4/8px rhythm on the 16px base, `--s-1` through `--s-7` (4px to 48px). It is
the standard for every gap and padding, and for `gap` specifically it is mechanically
guarded: `tests/design-scale.test.ts` asserts every flex/grid `gap` declaration in the app
resolves to a step on the scale. Padding and margin were never swept the same way — the
test's own header comment says why: a multi-value shorthand (`padding: 0.75rem 1rem`) can't
be checked against a single-value scale without an exemption list nobody has built. So a
residual set of literal values remains: 109 literal `margin`/`padding` declarations across
33 files, of which most (79) already happen to equal a token's value but are written
longhand rather than as `var(--s-N)`, and 37 are genuinely off-scale. The largest single
pattern is `1.25rem` (12 sites across 9 files), used as a de-facto, uncatalogued spacing
step for section-separator rhythm — sweeping this residue is tracked
(`docs/todo-ui-followups.md`), not done.

`--pad-card` is the one derived spacing token — `var(--s-4)` (16px) on a phone, stepping to
`var(--s-5)` (24px) at 480px and up. Card padding was the single most-repeated value in the
app before this existed, and it is the one that decides how much line length a 360px phone
has: the runner nests three deep (block, exercise, set row), so 4px per level back is 12px
of content width.

**Two border tokens, two jobs.** `--line` is a hairline for dividers and card edges — quiet
by design, because a card boundary is decorative, not a control the user has to locate.
`--line-strong` is for anything the user can tap or type into — an input, a stepper, an
unfilled button's border — because WCAG's non-text contrast rule applies to a control's
boundary and not to a card's. Against `--surface`, the background most controls sit on, it
holds 4.21:1 in dark and 3.55:1 in light — comfortably past the 3:1 floor that rule sets.

Every tappable control's border in the app now carries `--line-strong` — `Button`'s
unfilled variants, every textarea and `<select>`, and every tappable pill, chip, row and
scale cell. A container's own edge (a `Card`, a static alert panel, a decorative fill
indicator) stays on `--line`, because WCAG's non-text contrast rule is about locating a
control's boundary, not about a card's. Reach for `--line` on a card edge and
`--line-strong` on anything tappable in anything you write — using the quiet one on a
control is how a button's outline goes invisible against its own background.

**Elevation** is three steps — `--shadow-1` (cards, list rows), `--shadow-2` (sheets, the
log strip, sticky chrome) and `--shadow-3` (reserved for full-screen overlays and modals;
nothing consumes it yet — `Card.svelte` is currently the only component with a `box-shadow`
at all, via its `elevation: 1 | 2` prop, mapped to `--shadow-1`/`--shadow-2`). The two
themes earn depth by opposite means, per `Card.svelte`'s own header comment: light gets a
true shadow, because it has ground to cast one against; dark gets a much weaker shadow plus
a 1px inset top highlight (`--edge-top`), because a shadow on a near-black ground reads as
nothing, and a lighter surface plus a visible edge is what actually separates a raised
surface from the one behind it there.

**Motion** is three durations and two easings — `--dur-fast` (120ms: press feedback,
focus), `--dur-base` (200ms: hover, colour, opacity) and `--dur-slow` (320ms: sheets,
overlays), with `--ease` for a standard transition and `--ease-out` for anything entering.
`prefers-reduced-motion: reduce` collapses all three durations to 1ms at `:root` — a strict
superset of the opt-out `CelebrationOverlay` already carried for its own particle field,
which removes elements rather than shortening a duration and so keeps that handling on top
of this one. `Button`'s press feedback — an opacity dip on `:active`, never a
`transform: scale`, which would shift a control's neighbours in a flex row — is the first
consumer.

**`--dim` is a size-and-weight distinction now, not a third luminance step.** It used to be
the darkest of three text tiers and failed WCAG AA outright — 2.80:1 on light ground,
3.79:1 on dark surface, against a 4.5:1 requirement. Raised to pass (`#8d97a5` dark /
`#646d78` light — 4.67:1 to 6.62:1 across the app's actual surfaces in each theme, worst
case against `--hover`), it necessarily now sits close to `--muted`: there is no room for a
third tier to sit legibly further down the luminance scale and still clear 4.5:1. So a call
site that wants a step below `--muted` pairs `--dim` with a lighter weight and the app's
default size (`--t-sm` + `--w-medium`, against `--t-base` + `--w-semi` for the tier above)
rather than relying on darkness alone to carry the distinction — the same lesson §1's
2026-08-15 completion-mark note already drew one level up (weight and luminance alone were
"too quiet"), applied here one level down, to text.

Both light and dark themes are first-class: every token above is defined as a custom
property in both palettes, components read the tokens and never a literal colour or pixel
value, and the app honours both `prefers-color-scheme` and an explicit `data-theme`
override.

### The five primitives

`src/lib/components/Button.svelte`, `Card.svelte`, `Field.svelte`, `PageHeader.svelte` and
`EmptyState.svelte` are what turn the tokens above into shared building blocks, rather than
leaving every screen to reassemble the same button or card border from raw CSS. Each is
small and its own header comment or props carry the detail; this is the pointer, not the
full account.

- **`Button`** is the one place the 44px touch-target floor, press feedback and disabled
  state live — a `variant` of `primary | secondary | quiet | danger`, a `size` of `md`
  (default) or `lg`, an optional `href` to render as a styled anchor instead of a
  `<button>`, and `pending`/`pendingLabel` to disable a control and swap its label while an
  in-flight request has not yet satisfied its precondition (see "A control that can post
  before its precondition exists must be disabled" earlier in this file). Called from, for
  example, the generate/copy/download actions on `plan/[slug]/export/+page.svelte`.
- **`Card`** is the only component with a `box-shadow` — `elevation: 1 | 2`, mapped to
  `--shadow-1`/`--shadow-2` per the "Elevation" note above — plus a `padded` prop (default
  `true`) applying `--pad-card`. Reach for it for any raised content well; called from, for
  example, `plan/[slug]/export/+page.svelte`.
- **`Field`** pairs a label with one form control, plus optional `hint`/`error` paragraphs
  rendered as `{id}-hint`/`{id}-error`. `asGroup` swaps the default `<label for={id}>` for a
  `<span id="{id}-label">` when the wrapped control is a `<fieldset>` — a fieldset has
  nothing for a `for` attribute to point at. The span carries no accessible-name
  relationship on its own; the caller's `<fieldset>` must reference it with
  `aria-labelledby="{id}-label"` or the group has no accessible name at all. Called
  plainly from `import/ImportPlanForm.svelte`'s paste textarea, and with `asGroup` (plus
  the matching `aria-labelledby`) from `plan/[slug]/export/+page.svelte`'s history-window
  radio group.
- **`PageHeader`** is the `<h1>` treatment (`--t-lg` / `--w-display`, see "Type" above) plus
  an optional `subtitle` and an optional `backHref`/`backLabel` rendering a `BackLink`
  beneath the title. Reach for it at the top of any read route; called from, for example,
  `plan/[slug]/history/+page.svelte`.
- **`EmptyState`** is a compact "nothing here yet" block — a `title`, an optional `body`
  paragraph, and an optional `children` snippet for a call-to-action beneath it — so an
  empty chart says so in a few lines rather than drawing its full well with nothing in it.
  Called from, for example, `plan/[slug]/history/+page.svelte`.

`Button`'s `href` and `size` were removed rather than kept ahead of use: neither ever had a
call site, and `href` combined with `disabled`/`pending` to leave a real gap (an `<a>`
rendered `pointer-events: none` + `aria-disabled`, neither of which blocks keyboard
Enter/Space on a real anchor) that nothing depended on and nothing would have caught until
the first call site shipped it. `pending`/`pendingLabel` stay — `account/+page.svelte`'s
reset flow uses them for its own `?/reset` race, the same "a control that can post before
its precondition exists must be disabled" concern the runner has. `Card`'s `elevation` and
`padded`, and `Field`'s `hint` and `error`, still have no call site; each is tracked in
`docs/todo-ui-followups.md` rather than removed on sight, pending an adoption site that
would actually exercise it.

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

`document.documentElement.scrollWidth <= window.innerWidth` is asserted with the sheets and
the rest overlay open as well as closed. **No horizontal overflow, ever.** This is one
assertion and it is worth more than any amount of eyeballing: the failure it catches is a
fixed-width track that silently pushes a control off the edge, which looks like nothing at
all on a desktop browser. `npm run test:e2e` (Playwright, kept out of `npm run verify` —
ARCHITECTURE §12) is where it lives, via `assertNoHorizontalOverflow` in `e2e/helpers.ts`.

**What is actually enforced, as of 2026-08-30** — stated precisely, because this section
has already been corrected once for claiming more than the suite delivers, and an
over-claimed mechanical check is worse than an acknowledged manual one:

- **Overflow** is asserted at all three viewports on the runner and its four overlays,
  Home, export, the four progress routes, history, versions, admin, account and `/import`
  — the last covering the empty paste box, a parse-failure report, the wrong-document
  explanation and the revision review screen, which is the widest shape on the route. It
  is **not** asserted on `/login`, `/offline`, `+error`, the pre-session metric gate, or
  the activity sheet and next-morning prompt in their *open* states.
- **Both themes** now extends past the three screens that had it (the runner, pinned to
  360 × 800; admin and account, across all three viewport projects). `e2e/theme-coverage.spec.ts`
  adds Home, `/import`, export, progress, history and versions, at all three viewport
  projects, in both `colorScheme`s — the path a real user actually arrives on, rather than
  the `data-theme` override the runner's own spec exercises. Each check asserts more than
  that the page rendered: `getComputedStyle(document.body).backgroundColor` must equal the
  theme's `--ground` (`rgb(10, 12, 15)` dark, `rgb(244, 246, 248)` light), so a theme that
  silently failed to apply cannot pass by rendering the wrong one. **What this still does
  not reach:** `/login`, `/offline`, `+error`, and the runner's own overlays and sheets
  beyond what its dedicated spec covers.
- **44 px touch targets** are now asserted by `e2e/touch-targets.spec.ts`, on Home,
  `/import`, `/account`, export, progress, history and versions, at all three viewport
  projects. It checks every `button`, `a[href]`, non-hidden `input`, `select`, `textarea`
  and `[role="button"]`, skipping elements hidden by CSS, the visually-hidden-input
  pattern (≤2×2 CSS px), and an inline text link. `Button`'s `min-height`/`min-width:
  2.75rem` (§10) is what makes the swept routes pass — before it existed the floor was
  applied on eleven files and absent on five. **What this does not reach: `/admin` and the
  session runner itself are not in its route list**, so the log strip's controls —
  deliberately larger than 44 px, for sweaty hands and a phone on the floor — are believed
  compliant rather than mechanically checked, and `/admin` is likewise unverified by this
  sweep specifically, though its overflow coverage above still applies. One further gap
  the selector itself cannot close: `Sparkline` and `BarChart` give each plotted point a
  real `role="button"` hit circle (24 viewBox units, scaled by the chart's own
  `width: 100%` SVG), which renders under 44 CSS px on a narrow phone whenever a chart
  actually has data to plot. This is a pre-existing sizing bug in both files, and this pass
  did not touch it — the layout-chrome remap task (Task 3) edited the same two files, but
  only to move their label font sizes onto scale tokens (`10px` → `var(--t-2xs)`, and
  similarly for the rest); it never touched the hit-circle/hit-rect geometry, which is the
  part that is actually broken. The token remap is also why "12px" is not literally true at
  this call site: the label text lives inside the same viewBox that the chart's own
  `width: 100%` scales, so a CSS-px-valued token renders at a size that scales with the
  container's width there, the same mechanism behind the hit-target bug — not at the
  fixed CSS pixel size the token implies everywhere else. Separately, progress's charts
  render their empty `emptyLabel` state, with no circles at all, unless another spec has
  already seeded duration data into the shared test database first, so a narrow run of just
  this one spec file can appear to pass. Running the full suite — the way `npm run test:e2e`
  and CI do — seeds that data, and the touch-targets check on the progress route then fails
  on this. That failure is a known, already-understood assertion, not an intermittent one:
  the next person who sees it red should not spend time debugging it as new.

**Every sweep also runs under one fixed state, not several — a gap in kind, not just in
route.** All three viewport projects authenticate through `GAIN_DEV_USER`'s auth bypass
against a database with a plan already seeded, so every route above is checked in exactly
one condition: an ordinary, non-admin user, mid-plan, signed in. A control that only
renders in a *different* state is exercised by no sweep at all, regardless of whether its
route is in scope — this is distinct from the route gaps named above. Known instances: the
header's "Sign out" button (`+layout.svelte`'s `.linklike` styling, no `min-height`, ~21px
tall in production — rendered only when the app is *not* running under the dev bypass); the
admin-only "Users" link (rendered only for an actual admin session); the sync banner's
"Discard" button for a quarantined offline write (a genuinely destructive control by this
repo's own quarantine invariant — see CLAUDE.md's "Offline is a hard requirement" section);
and first-run home's three buttons (rendered only when a user has zero plans, and the e2e
fixture always seeds one). None of these are believed compliant by inference from a sibling
control that *is* swept — they are simply unchecked, and are recorded here so that is known
rather than assumed.

**One accepted keyboard cost, recorded so it is not rediscovered as a bug.** The progress
window pickers navigate on `change`, so arrow-keying a *closed* `<select>` on a desktop
keyboard fires one navigation per keypress. Accepted: the target is a phone, where a
`<select>` commits once on dismiss.

**Native `<select>` and radio inputs stay native, deliberately, next to a custom pill
pattern used everywhere else for the same kind of choice.** `DeviationSheet`'s substitute
picker, the three progress window pickers, and `DispositionList` all use a plain
`<select>`; the export screen's history-window choice uses plain radios. Converting any of
these to the app's pill/chip visual pattern would mean hand-rolling roving-tabindex and
ARIA listbox semantics the platform gives a `<select>` for free, and would trade away the
one thing a native control does that a custom one cannot: on a phone, it opens the OS's own
picker sheet — full-height, thumb-scrollable, and already accessible to whatever assistive
tech the user has configured system-wide. The substitute picker's option list in particular
can run long (every exercise in the catalogue), which a native control handles for free and
a row of pills does not. This is not an oversight the rest of the pill sweep missed; it is
the correct choice for a control whose job is picking one of several values by name rather
than toggling a small, fixed set of states.

---

## What this does not decide

§1–§9 cover the session runner specifically; §10–§12 cover the tokens, primitives and
mechanical checks every screen shares. Neither half settles a given screen's own
information architecture or interaction model outside those two remits. Home's suggested
next session, history, progress and the offline sync-state indicator are all built, and
their decisions live where they were made: ARCHITECTURE §9 and §10 for the architecture,
and CLAUDE.md's Invariants for the two that hardened into rules — the sync banner's
700 ms / 1.5 s gate, and the celebration being a moment rather than a step.

§5's symptom framework — whether GAIN shows a plan's green/yellow/red pain guidance to
the person training — was the last genuinely open question here, and it is settled and
built: see §5.

What this document still does not cover is a given screen's own layout judgement calls —
navigation structure, which actions get visual weight, and the like — outside what §10–§12
hold every screen to. A new surface gets its decisions recorded here when it has any worth
settling, and not before — an empty section reserving a screen that does not exist is the
drift this document has already been corrected for once.
