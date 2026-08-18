# Phase 8 — revision diff review and rename mapping: design

**Status:** approved design, not yet planned or built.
**Date:** 2026-08-18.
**Contract:** ARCHITECTURE §8 (import pipeline), §11 (export, Section 0), §12 (build
order, phase 8); CONTRACT §7 (validation behaviour, blocking vs. warning);
UI-DECISIONS §11 (every crossing to an AI), §12 (the phone is the target); CLAUDE.md's
"Exercise slugs are load-bearing, and their failure mode is silent" and "Import is
all-or-nothing, across two stores".

**Done when:** a logged block exports, comes back revised from an AI, and the diff is
reviewed and committed — including a slug the AI renamed, mapped back onto its history
rather than silently splitting it. That is the loop closing, and it is the last thing
the build owes.

---

## 1. What this closes

Every other crossing in the loop works. A user can bootstrap a plan, import it, train
offline, and export a bundle. What they cannot do is come back: `prepareImportReview`
already computes a full `ContractDiff` for a revision, and the home screen renders it as
one sentence saying the detailed review "arrives in a later phase", then commits as-is.

So the engine is done and the phase is the UI on top of it — with one exception that is
not UI at all. The roadmap's second item, rename mapping, has **no write path**. Nothing
between the review and `importPlan` can carry a decision, and `importPlan` has no input
that could express one. That is the real work here; the screen is the easy half.

The stakes are the ones CLAUDE.md states: if `goblet-squat` returns as `goblet_squat`,
every chart splits in two, nothing errors, and the loss is unrecoverable. The diff engine
already *detects* this (`findRenameCandidates`, three heuristics). Detection with no
remedy is a warning the user can only act on by going back to the AI and asking for a
re-emit — which works, but is a wasted crossing for a fixable one-character mistake.

---

## 2. The rename write path

### Why `exercise_def.slug` is mutated

Every log read path renders `exercise_def.slug`, joined via `exercise_def_id`
(`src/lib/db/logs.ts`, `src/lib/db/workout-history.ts`). Every progress read matches that
string against a slug taken from the version's `contract_json`
(`src/lib/progress/exercise-series.ts` compares `set.exercise_slug` to the slug from
`exerciseOccurrences`). The two sides of that comparison must agree, which fixes the
answer: an accepted rename adopts the AI's new spelling and carries the existing history
onto it, by updating the `exercise_def` row.

Two alternatives were considered and rejected.

**An `exercise_alias` table**, keeping `exercise_def.slug` genuinely immutable and
resolving old slugs through aliases, solves *resolution* but not *presentation*. The log
reads would still render the old slug while the contract carries the new one, so a
canonical slug still has to be chosen — at which point the alias table is doing nothing
the direct update does not, at the cost of teaching every slug-resolving call site about
aliases.

**Rewriting the incoming document** to restore the old slug before import is rejected
outright. `source_md` must be byte-identical to what the AI emitted, because Section 1 of
the next export replays it verbatim; a rewritten document is no longer what the AI wrote.
It is also textually unsafe, since a slug string-replaced across an 800-line document will
hit prose occurrences as well as the contract block.

### Where it runs

Inside `importPlan`'s existing `IMMEDIATE` transaction, **before `upsertExerciseDefs`**.
This ordering is load-bearing: after the upsert, a fresh `exercise_def` has already been
minted for the new slug and the history is already split, so a rename applied afterwards
would be repairing damage the same transaction had just caused.

`ImportPlanInput` gains `renames: readonly { from: string; to: string }[]`, defaulting to
empty. First imports never carry any.

### Validation, all before any write

- `from` exists as an `exercise_def` for this plan.
- `from` is **absent** from the incoming catalogue. Renaming away from a slug the
  document still uses is incoherent, and would leave the upsert re-creating it.
- `to` is **present** in the incoming catalogue.
- `to` is not already an `exercise_def` for this plan, or the update violates
  `UNIQUE (plan_id, slug)`.
- No duplicate `from` and no duplicate `to` across the mapping set.

A failure returns a new `ImportPlanFailure` kind. It never throws: phase 4 settled that a
thrown error inside a form action is a 500 that destroys the page, and this action is
reached with a document the user may have spent a chat session obtaining.

### The two writes

```sql
UPDATE exercise_def SET slug = :to WHERE plan_id = :planId AND slug = :from;

UPDATE deviation SET substitute_exercise_slug = :to
 WHERE substitute_exercise_slug = :from
   AND workout_id IN (SELECT w.id FROM workout w
                        JOIN plan_version pv ON pv.id = w.plan_version_id
                       WHERE pv.plan_id = :planId);
```

`deviation.substitute_exercise_slug` is the only slug in the schema stored as loose text
rather than reached through `exercise_def_id`, so it is the only column that goes stale on
its own. The join through `plan_version` is not decoration: `workout` keys on
`plan_version_id`, and without it a rename in one plan would rewrite an identically-named
slug's deviations in another plan in the same database.

`version_exercise.substitutes_json` and `prescription.substitutes_json` are deliberately
left alone. They are per-version records of what that version's document said, and that
document said the old slug.

### Consequences accepted

**`exercise_def.slug` is no longer unconditionally stable.** The schema comment
(`-- STABLE ACROSS VERSIONS`) becomes "stable across versions except by an explicit,
reviewed rename", and CLAUDE.md's slug invariant gains the same qualification. This is a
narrowing of a guarantee, so it is written down rather than left to be rediscovered.

**`first_seen_version` is not touched.** It records when the *movement* entered the plan,
which a rename does not change. `last_seen_version` is updated by the upsert immediately
afterwards, as normal.

**Old versions' stored documents keep the old spelling.** `contract_json` and
`plans/<slug>/v<N>.md` for versions before the rename still say `goblet-squat` while
`exercise_def` now says `goblet_squat`. Nothing built today reads an old version's
contract against current logs, so this is latent rather than broken — but "old plan
versions stay browsable" is an open Loose End, and whoever builds it needs to resolve
slugs through `exercise_def` rather than through the archived contract.

**A queued offline op naming the old slug will quarantine.** `requireExercise`
(`src/lib/sync/replay.ts`) resolves `op.exerciseSlug` per op, so only the affected ops are
held — the existing per-op resolution already prevents one bad slug quarantining a whole
batch. Quarantined ops are retained and surfaced by the banner, and the Discard control
added in phase 9 clears them. No new machinery is required, but the review screen warns
when the outbox is non-empty, because the user is the only one who can judge whether those
ops matter.

---

## 3. The import flow moves to `/import`

Today `ImportPlanForm` renders in three places on the home screen (empty state, the
single-plan card, and a standalone card when there are several plans), while the parse
failure report and the review both render at the bottom of the document. That is already
the phase-4 "an error the user cannot see" problem in miniature, and a diff with dozens of
changed targets would make the home screen unusable.

The whole flow moves to one route: paste box, parse-error report, and diff review
together. Home's empty state and each plan card link to it.

Two constraints force this rather than a review-only route. UI-DECISIONS §11 requires a
failed import to keep the pasted text in place with the copy-the-error action beside it,
so the textarea must live wherever errors render. And ARCHITECTURE §8 insists the first
import is not a special case in the pipeline — routing revisions to their own screen while
first imports stayed inline would make it one again. One route, one pipeline, three entry
points collapsed into one.

The cost is honest: first run gains a tap. A new user gets their bootstrap prompt on Home,
then follows a link to paste the result. A diff that cannot fit on the home screen is
worth that tap, but it is a real regression to the flow §11 cares most about, and the
empty state's link needs to be prominent rather than incidental.

### State between review and commit

Nothing is stashed server-side. The source document and the rename dispositions ride
hidden form fields, exactly as `source_md` does today, and the commit action re-parses the
document, re-derives the diff, and re-validates the dispositions against it.

This is deliberate. A user who edits the textarea between review and commit gets their
mappings rejected rather than silently applied to a different document, and the
all-or-nothing guarantee stays a property of one transaction rather than of a session
store that could outlive it.

---

## 4. `src/lib/diff/present.ts`

One pure module, `ContractDiff` plus both contracts in, a `DiffPresentation` out. It
resolves display names against the incoming catalogue, formats values, groups changes into
the sections the screen renders, and derives the list of removed slugs needing a
disposition. Unit-tested without SvelteKit, in the same shape as every other phase here:
pure logic in `$lib`, a thin route.

It owns range formatting for the whole screen. `FieldChange.from` and `.to` are `unknown`,
and a contract range is a tuple — `[8, 12]` interpolates as `8,12`. Phase 4 was bitten by
exactly this, and a diff shows two ranges per changed target, so the formatting lives in
one place rather than at each call site.

---

## 5. The review screen

A first import renders on this same route and is unchanged from today: the counts
summary and a commit button, with no diff to review and no dispositions to make. What
follows describes the revision case.

Rendered in the order the user acts in.

1. **Blocking problems**, when `diff.blocking` is non-empty. Commit is disabled and a
   copy-for-the-AI action is offered, because the fix belongs to the AI. Reachable in
   practice by re-pasting an already-imported version.
2. **Identity check** — one row per removed slug, each requiring an explicit *Renamed
   to […]* or *Removed on purpose*. The dropdown offers every added slug, with heuristic
   candidates pre-selected but overridable. Commit stays disabled until every row has a
   disposition.
3. **The changelog**, always visible and never folded. It is the AI's own account of what
   it did and it frames everything below it.
4. **What changes**, as collapsed groups with counts in their headings: sessions, blocks,
   exercises added and changed, targets changed, metrics, loads, and the
   scheduling/progression/safety flags.
5. **Warnings** not already covered by a disposition — unreferenced catalogue entries,
   orphaned metric keys, a `based_on_version` mismatch.

On (2), an untouched row is not implicit acceptance. Requiring a choice is a handful of
taps on a realistic revision, and the entire justification for this screen is that this
particular mistake is silent and unrecoverable; letting a removal pass unexamined
reintroduces the failure mode the screen exists to close.

On (4), the counts do the reviewing and the detail verifies it. Seven headline numbers are
scannable on a phone; several dozen open rows are not, and a screen nobody reads is
ceremony rather than review. Cards throughout, never tables (UI-DECISIONS §12).

---

## 6. Colour: a runner-scoped rule stated globally

CLAUDE.md forbids `var(--red)` for errors and forbids green success states, attributing
both to UI-DECISIONS §5's symptom triad. Read literally that is app-wide. It is not what
the codebase does, and it is not what §5 means.

`--red` and `--amber` already appear in `src/routes/admin/+page.svelte`,
`src/routes/plan/[slug]/export/+page.svelte`, `src/routes/+layout.svelte` (the sync
banner, visible on every screen including this one) and `src/routes/+page.svelte`. The
session runner is the one place they are withheld, and the phase-4 review that wrote the
rule was entirely about the runner.

So the boundary is: **inside the session runner, green/amber/red mean symptom severity and
nothing else. Outside it, they carry their ordinary meanings.** The review screen is
outside. Blocking problems are red, and the amber sync banner above them reads as
consistent rather than competing.

Correcting CLAUDE.md's wording to say this is part of the phase. The rule was right; its
stated scope was wrong, and a rule that overclaims gets ignored wholesale by the next
agent who notices it does not match the code.

---

## 7. `fixtures/plans/home-training-v2.md`

The phase's "done when" is a real round trip, and there is nothing to import: the
repository holds only `home-training-v1.md`, and `tests/diff.test.ts` builds small
synthetic contracts. A second fixture is required and is the largest content item in the
phase.

Fictional, as v1 is and must remain — this repository is public. Contract-valid,
`version: 2`, `based_on_version: 1`, with a real changelog. Required coverage:

- **Two renames**: one the heuristics catch (punctuation-mangled, the `goblet_squat`
  case) and one they miss entirely — a different word with a different display name.
  The second is what proves any-removed-onto-any-added mapping earns its place over
  offering only the detected candidates.
- **One genuine removal**, so *Removed on purpose* is exercised rather than assumed.
- One added exercise, and several changed targets spanning reps, sets, load and rest.
- One added and one removed metric definition.
- Edited prose context, so Section 1's verbatim replay is exercised on a second version.

It deliberately does **not** inherit v1's every-primitive obligation.
`tests/fixture-coverage.test.ts` hardcodes v1 and that is where the obligation belongs;
v2's job is to exercise the diff, and a second 800-line document would be a second thing
to keep in sync forever.

---

## 8. Removing the per-user `ai_template`

The roadmap's third phase-8 item is a template editor with multiple named templates, per
ARCHITECTURE §11. It is cut, and the per-user copy is removed with it.

`templates/default-ai-instructions.md` is shipped app code. In 100 lines it references the
export's section numbering, the `weight_kg` total-kilograms invariant, a cross-reference
into Section 4, the six substitution tokens, the parser's field-level error behaviour, and
the whole-document-replacement semantics of import. A per-user copy pinned at provisioning
does not merely go stale — after a schema or export change it actively misinstructs the
AI, with the app's authority behind it. And that is the situation today:
`seedTemplatesIfEmpty` only seeds an empty table, so every registered user is pinned to
whatever the file said on the day they first signed in, with no editor and therefore no
reason for any of them to have diverged.

The feature it was meant to serve is already served better elsewhere. Section 0's own text
says *"Read Section 1 first, and follow its principles. The plan states its own coaching
philosophy, constraints and exclusions. Those are decisions made with context you do not
have."* Having said that, it has delegated every user-specific judgement to the plan
document. A user who wants "go easy on my shoulder this block" says so in the chat, the AI
writes it into the plan's prose context, and it then rides along in Section 1 of every
future export — maintained by the AI, round-tripping properly, instead of sitting in a
side-channel the loop never revisits.

This also removes an inconsistency rather than creating one. All three outbound documents
are `?raw` imports at build time; `contractMd` and `bootstrapPromptTemplate` are already
used straight from the asset. Only `defaultInstructionsTemplate` took a detour through the
database, and it fell back to the asset anyway.

The work: migration 002 on `gain.db` drops the table; `getDefaultTemplate`,
`seedTemplatesIfEmpty`, `SeedTemplate` and the `seedTemplates` option are deleted;
`bundle-for-plan.ts` uses `defaultInstructionsTemplate` directly; `admin-stats.ts`'s
forbidden-read list drops the table. Documentation: ARCHITECTURE §11's Section 0 bullet is
rewritten to argue why it is app code, §12's phase-8 row and ROADMAP's phase-8 list drop
the editor, and CLAUDE.md's shipped-output invariant widens from `docs/CONTRACT.md` to
cover `templates/` as well — the rule was always "editing this changes what every AI
receives", and it applies to all three files.

It ships as the first commit of the phase, because it is independent of everything else
and it shrinks the surface the rest of the phase touches.

---

## 9. Testing

| Test | Proves |
|---|---|
| `tests/diff/present.test.ts` | grouping, name resolution, and range formatting — `[8, 12]` never reaches a string as `8,12` |
| `tests/diff.test.ts`, extended | the engine against the real v1 → v2 pair, not only synthetic contracts |
| `tests/db/rename.test.ts` | history follows the rename; deviations rewritten and correctly scoped to one plan; each validation case rejected; nothing written on failure |
| `tests/golden.test.ts`, extended | v2 imports on top of v1 and its Section 1 comes back byte-identical |
| `e2e/revision-walkthrough.spec.ts` | seed v1, log a set, import v2 with a rename, commit, then assert the Progress detail for the **new** slug shows the set logged under the **old** one |

The e2e assertion is the phase-7 lesson applied: prove the data path fired rather than
that a component's shell rendered. It is also the only test in the list that would catch a
split history end to end, which is the failure this whole phase exists to prevent.

---

## 10. What this does not do

- **Metric key renames.** The diff already warns that a disappeared metric key orphans its
  history, and metric values key on `(scope, key)` rather than on a def row, so the
  mapping would be a different mechanism against a different table. Out of scope; the
  warning stands.
- **Browsing old plan versions**, which stays a Loose End. §2 notes the constraint this
  phase imposes on whoever builds it.
- **Translating queued offline ops across a rename.** Ops naming the old slug quarantine
  and are discardable, as designed. Translating them needs a rename ledger the schema does
  not have and this spec deliberately does not add.
- **Any settings area.** Plan archiving and old-version browsing remain unhoused Loose
  Ends rather than getting a speculative home.
