# Fixture rebuild — one plan, current-generation, full coverage

**Status:** design, approved in principle 2026-08-13. Precedes phase 7.

## Why this exists

`fixtures/plans/home-dumbbell-v1.md` was written before the app existed. It is the spine of
the phase-1 test suite and it has done that job well, but it is now the only plan the build
has ever seen, and it is not the kind of plan the loop actually produces. A second plan,
authored by a current-generation AI against the shipped `docs/CONTRACT.md`, turned up
during manual testing and differs from the fixture in ways that are informative rather than
incidental.

Two of those differences are the argument for this work.

**The new plan silently lost a key.** It writes `progression.keep_load_when` where the Zod
schema declares `hold_load_when`. It parsed clean, because `progression` is a
`z.looseObject`, and the key was swallowed. Nothing will ever read it. The cause is in the
shipped spec: `docs/CONTRACT.md` shows `increase_load_when` and never names
`hold_load_when` or `reduce_load_when`, so the authoring AI had no way to know. This is the
same failure class the `plan`/`programme` invariant exists to prevent, arriving through a
door that invariant does not cover, and it will recur on every revision until the spec names
the keys. One fixture cannot catch this by construction — it takes a second, independently
authored document to notice that two names exist for one concept.

**The new plan models alternating movements differently.** The fixture marks `dead-bug`,
`bird-dog`, `mcgill-curl-up` and `reverse-lunge` as `per_side: true`. The new plan models
them as alternating-within-a-set with a total rep count, and argues the case in prose. Both
are legal contract usage. Only one of them is what the loop produces today.

The conclusion is not "keep both". Two fixtures means every contract change touches two
documents, and the second one rots. The conclusion is that the fixture should be replaced by
a document shaped like what the loop actually emits, with the primitive coverage the old one
carried folded into it.

## What the merged fixture must contain

A coverage diff across both documents found nine primitives the new plan does not exercise
and the fixture does. Each has a home in the new plan that does not distort it. Where the
addition also improves the plan's internal coherence, that is noted — those are the easy ones.

| # | Primitive | Where it goes |
|---|---|---|
| 1 | Set-scope metric | `symptoms_during` declared at set scope alongside its session-scope twin (see below) |
| 2 | `type: enum` metric | `technique` at exercise scope — Good / Acceptable / Broke down |
| 3 | A required metric (`optional` absent or false) | Session-scope `symptoms_during` loses `optional: true` |
| 4 | Scalar `duration_sec` | Warm-up `march-in-place` becomes `duration_sec: 60` rather than `reps: 40` |
| 5 | `conditional: true` with no `substitutes` | `floor-pullover`, condition worded as omit-rather-than-swap |
| 6 | Implicit block `tracking` and `type` | Session C's `main` and `core` blocks drop both keys; A, B and D keep them explicit |
| 7 | Prescription-level `load` override | Session C's `split-squat` carries `load: light-pair` |
| 8 | Ranged `sets` (`sets: [2, 3]`) | Two of session D's main movements — D is already the plan's "drop this when the week is short" session |
| 9 | Prescription-level `substitutes` | Session D's `goblet-squat` gets `substitutes: [bodyweight-squat]`, which the catalogue does not declare |

Item 2 is the coherent one: the new plan's own `increase_load_when` lists *"Technique held
together on the final set"* as a condition for adding load, and then provides no way to
record technique at all. Declaring the metric makes the plan more internally consistent, not
less.

Item 7 does the same double duty. Neither document currently pairs `per_side: true` with an
external load — the fixture's `supported-one-arm-row` gets there via a prescription-level
`load: heavy`, which is itself primitive 7, and the new plan has no `load:` override
anywhere. Loading session C's split squat closes both at once, and the new plan's
`future_progressions` already anticipates exactly that movement being loaded. The prose
paragraph explaining that unilateral work starts at bodyweight is adjusted to say that one
session carries the light pair as a bridge.

### The gap neither document covers

No fixture has ever declared **the same metric key at two scopes**. That is precisely what
AGENTS.md's `(scope, key)` invariant exists to prevent — *"a plan may legally declare `rpe`
at both set and session scope, and keying on the bare key merges two unrelated series into a
plausible wrong number"* — and `tests/summary.test.ts` already protects it at the unit
level, with a hand-built contract and log set that exist for no other reason. What is
missing is proof through the real path: nothing has ever shown the invariant surviving the
full pipeline — parse → synthetic logs → export summary — against a fixture that itself
looks like a plan someone would actually write, rather than a fixture manufactured to
demonstrate this one thing.

The merged fixture closes that gap by declaring `symptoms_during` at **both** set and
session scope: *"symptoms on this set"* and *"symptoms during this session"*. That is how a
symptom-monitoring plan would genuinely be written, it satisfies primitive 1 in the same
edit, and it makes the invariant testable end to end for the first time. Phase 7's metric
charts are the first consumer that would fail loudly if it broke.

## Fictionalising

The source document is a real plan for a real person: real name throughout, real symptom
history, a real physiotherapy referral, a real equipment inventory. AGENTS.md is
unambiguous — *"It is fictional, and must stay that way… this repository is public — never
commit real health data to it, in fixtures, tests or examples."*

What is worth keeping is the document's **structure**: how a current AI lays out prose
context, what it puts in the block versus the prose, the level of detail in the notes, the
way it records what it estimated versus what it confirmed. None of that depends on identity.

- `plan.slug` becomes `home-training`; the file is `fixtures/plans/home-training-v1.md`.
- The named individual becomes an unnamed second person. The document already addresses the
  reader as "you" in most places; the remaining third-person passages are converted.
- The symptom picture is retained in shape — a hip and lower-back complaint that rules out
  loaded hinging and forward bending — because that is what drives the exercise selection,
  the conditionals and the substitutes. The specific clinical history, the referral and the
  never-confirmed age are cut.
- The "what I estimated" section is retained. It is one of the most realistic things in the
  document and it exercises nothing, which is exactly why an AI-authored plan has one.

The result is a fictional plan that behaves like a real one. That is the same standard the
existing fixture is held to, and its "Import notes" oddities are deliberate test cases for
the same reason.

## Two corrections the fixture must carry

**`keep_load_when` becomes `hold_load_when`.** The fixture must use the key the schema
declares. Fixing the fixture is not the whole fix — `docs/CONTRACT.md` must name all three
`*_load_when` keys, since it is shipped verbatim in every export and bootstrap prompt and is
the only thing an authoring AI reads. Whether `progression` should remain a `z.looseObject`
is a separate decision, taken with that change rather than here.

**`version: 2` becomes `version: 1`.** The source document declares `version: 2` with
`based_on_version: null` while its own prose says *"This is a first plan. It has never been
trained."* That combination is incoherent and the parser currently accepts it. A separate
approved change makes `version > 1` with a null `based_on_version` a parse error with the
usual pasteable report; the fixture would fail that rule on the day it lands. It is a first
plan, so it is version 1, and `changelog` is reworded accordingly.

## What changes, and in what order

Twenty-nine files reference the fixture. Two of them are load-bearing and the rest are
mechanical.

| Weight | Files |
|---|---|
| Heavy | `tests/golden.test.ts` — the project's spine, and it asserts the fixture's declared shape by number. `tests/helpers/synthetic-logs.ts` — hardcodes `supported-one-arm-row`, `set_symptom`, `technique` and the substitution pair. `e2e/session-runner-walkthrough-a.spec.ts` and `-d.spec.ts` — written against v1's specific session content, so they are rewritten rather than renamed |
| Mechanical | `tests/db/{import,logs,second-import,workout}.test.ts`, `tests/session/{ledger,resume,session-view}.test.ts`, `tests/sync/{replay,replay.property}.test.ts`, `tests/server/*.test.ts`, `e2e/seed.ts`, `e2e/env.ts`, and the remaining e2e specs — mostly a slug swap |
| Docs | `AGENTS.md` ("The fixture" section, including the exercise/prescription counts), `docs/ARCHITECTURE.md` §6 and §7's worked import line, `docs/UI-DECISIONS.md`, the comment at `src/lib/db/review.ts:5`, and `design/session-runner-mockup.html` (byte-sensitive, excluded from formatting — edit by hand) |
| Unchanged | `docs/CONTRACT.md`'s `set_symptom` and `lying-triceps-extension` mentions are illustrative examples in shipped output, not references to the fixture. `docs/superpowers/plans/2026-08-12-phase-5-export.md` and `-phase-6-offline-pwa.md` are records of work already done — historical documents are not rewritten to match a later state of the tree |

**The counts are recomputed from the finished document, never estimated.** AGENTS.md and
ARCHITECTURE both state the fixture's shape as literal numbers, and `tests/golden.test.ts`
asserts them. Those three must agree with each other and with the file.

The sequence is deliberately one thing at a time, because the golden test and the two e2e
walkthroughs are what prove every earlier phase is still right:

1. Write the fictionalised, merged document. Parse it in isolation and confirm all nine
   primitives plus the two-scope metric are present.
2. Land it alongside the old fixture, and rewrite `tests/golden.test.ts` against it.
3. Port `tests/helpers/synthetic-logs.ts`, then the unit tests that hardcode v1 slugs.
4. Rewrite the two e2e walkthroughs against the new sessions.
5. Update the docs and the `review.ts` comment.
6. Delete `fixtures/plans/home-dumbbell-v1.md`.

Steps 2 through 5 each end with `npm run verify` green. Step 4 additionally needs
`npm run test:e2e`, which `verify` deliberately never runs.

## Done when

- `fixtures/plans/home-training-v1.md` parses clean and exercises every primitive listed
  above, including a metric key declared at two scopes.
- The golden round-trip test passes against it: import → synthetic logs → export →
  re-import, with every id surviving and `context_md` byte-identical.
- `npm run verify` is green and `npm run test:e2e` passes at all three viewports.
- Nothing outside `docs/superpowers/plans/` references `home-dumbbell`, and no health data
  anywhere in the tree belongs to a real person.
- AGENTS.md, `docs/ARCHITECTURE.md` and `tests/golden.test.ts` state the same counts.

## What this deliberately does not do

- **It does not change the schema**, beyond whatever the `hold_load_when` correction settles
  separately. The nine primitives are all already supported; the fixture simply never used
  them together.
- **It does not touch phase 7.** The fixture rebuild lands first, on its own, so that a green
  `verify` afterwards is a real signal rather than a result entangled with new features.
- **It does not keep the old fixture as a second parse-only case.** An unused fixture rots,
  and the merged document covers strictly more once the nine gaps close.
