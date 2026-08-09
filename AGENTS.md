# AGENTS.md

Guidance for AI agents working in this repository — Claude Code, Cline, and anything
else that reads this file. It is the single source of truth; `CLAUDE.md` points here.

## Current state

**Phases 1–2 are done.** Phase 1 is the pure round-trip core: contract schema
(`src/lib/contract/`), parser (`src/lib/parse/`), diff engine (`src/lib/diff/`), export
generator (`src/lib/export/`) and both prompt templates (`src/lib/templates/`) — pure
functions over plain data, no I/O. Phase 2 is the storage layer (`src/lib/db/`): the
reconciled domain model as migration 001, per-user provisioning, the import writer and
import review — import writes a version, and a second import produces a correct diff.
No UI and no HTTP yet; phases 3–7 have not started, and the build-order table in
ARCHITECTURE §12 is the map.

Commands (Node 24 LTS — see `.nvmrc` and the `engines` field):

- `npm install` — dependencies
- `npm test` — Vitest; includes the golden round-trip test, the project's spine
- `npm run typecheck` — strict TypeScript, `tsc --noEmit`
- `npm run lint` — ESLint
- `npm run format` / `npm run format:check` — Prettier. `docs/`, `fixtures/`,
  `templates/` and `design/` are byte-sensitive and excluded from formatting; never
  remove them from `.prettierignore`

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first, then
[`docs/CONTRACT.md`](docs/CONTRACT.md), before doing anything substantive. The twelve
design decisions in ARCHITECTURE §2 are settled — implement against them rather than
relitigating them. The same applies to
[`docs/UI-DECISIONS.md`](docs/UI-DECISIONS.md), which settles how the session runner
behaves; read it before touching anything user-facing.

### Stack

TypeScript + SvelteKit, single Node container, SQLite via `better-sqlite3`, Zod for
contract validation, Vitest for tests. One image, one port, one volume. The phase-1/2
core is plain TypeScript with no framework — SvelteKit arrives with phase 3.

Node version, package manager, lint/format and CI are settled in ARCHITECTURE §12,
"Toolchain, settled". Implement those choices; do not make them again.

### How to report back

Short and scannable — bullets over prose, lead with what changed, and put anything the
user needs to decide under its own heading at the end, numbered so they can reply
"1. yes, 2. no". Never bury a question mid-paragraph. Ask rather than guess, and give a
recommendation with the question.

Design documents in this repo are the exception — `docs/` is written for AI agents and a
human reviewer, and its prose is deliberate. Do not "bullet-ify" it.

## What this app is

GAIN is the structured middle of a copy-paste loop. An AI writes a training plan in
some external chat; the user imports the Markdown here, trains and logs offline, then
exports a bundle to feed back to an AI for revision.

```
AI chat  ──md──►  import  ──►  train & log  ──►  export  ──md──►  AI chat
(external)      (structured)   (offline PWA)   (bundle)         (external)
```

**GAIN never calls an AI.** No API keys, no chat UI, no LLM in any code path. This is a
decision, not a gap.

**The loop is the product.** Everything else exists to make one round of it worth
completing, so every crossing between GAIN and an AI must be one tap out and one paste
back. Nothing the user assembles by hand, no format knowledge required, paste as the
primary transport, one document per crossing. A user who finds the handoff clumsy stops
revising, and an unrevised plan is a notes app with extra steps. See ARCHITECTURE §1.

A new user has no plan, so nothing to export, so **the loop cannot start itself.** That is
what `templates/bootstrap-prompt.md` is for — see ARCHITECTURE §7.

## The architecture that isn't obvious from any single file

### A plan is two representations, and both round-trip

A plan document is a ~350-line **skeleton** (a catalogue of every movement, then sessions
→ blocks → prescriptions, inside one fenced ` ```gain-plan ` YAML block) wrapped in ~500
lines of **prose context** (rationale, form cues, injury rules, progression philosophy).

The split is strict: **prose holds the reasoning, the block holds the prescription.**
Neither restates the other. Sets, reps, loads and rest appear only in the block; a plan
that also spells them out in prose has to keep two copies in sync and will not.

The skeleton is parsed into SQLite and drives the UI. The context is stored **verbatim**
and replayed into exports byte-for-byte. GAIN never paraphrases, summarises or
regenerates context — anything it cannot parse, it preserves. Nearly all of the document
is useless to the session UI and essential to the next AI revision.

### Exercise slugs are load-bearing, and their failure mode is silent

Every chart, progression calculation and trend join keys on `exercise_def.slug`,
resolved from the contract block's `id` fields. If a revised plan returns
`goblet-squat` as `goblet_squat`, history splits in two, nothing errors, and the loss is
unrecoverable. `plan.slug`, session `key` and metric `key` carry the same property.

Three defences, all of which must survive refactors: ID-preservation rules restated in
every export, rename detection in the import diff, and never silently minting a slug that
closely resembles an existing one.

Metric keys are the exception to "unique identifier": they are unique **within a scope**,
not across scopes, so a plan may legally declare `rpe` at both set and session scope.
Anything that indexes metric values — summaries, charts, CSV columns — must key on
`(scope, key)`. Keying on the bare key merges two unrelated series and reports a plausible
wrong number rather than failing.

### Isolation is physical, not a WHERE clause

Each user gets their own `gain.db` and their own directory under `/data/users/<id>/`.
There is no cross-user query because there is no cross-user database. There is no admin
role and no code path by which one user reads another's data. Do not introduce a shared
table keyed by `user_id`.

### Offline is a hard requirement, not a nicety

Workout state lives client-side in IndexedDB and syncs when it can. All writes carry a
client-generated ULID and are idempotent server-side, so replaying the sync queue can
never duplicate a set. A workout must survive connection loss, phone lock, browser kill,
container restart, and an expired session — a 401 must never discard queued local data.

That idempotency is physical: every table the client writes to — `workout`, `set_log`,
`metric_value`, `deviation`, `activity` — carries a `client_id TEXT UNIQUE`, and any new
log table needs one. A log table without that column looks fine until the day a queue is
replayed, and then it silently doubles someone's history.

## Invariants

These break things quietly. The test suite catches some of them — the golden round-trip
asserts byte-identity through import → export → re-import, `tests/parse.test.ts` asserts
every parser failure path produces a pasteable report, and the db tests assert
all-or-nothing at the version guard and across both stores — but the rest are yours to
protect:

- **`context_md` is byte-identical** through import → storage → export → re-import. The
  export replays `source_md` verbatim as Section 1, so the plan document is copied, never
  reassembled from `context_md` plus a block. The bundle itself is **not** re-importable —
  an AI reads a bundle and returns a plan document, and a pasted bundle gets an explanation
  rather than a second supported input format. See ARCHITECTURE §11.
- **Import is all-or-nothing, across two stores.** On any validation failure, report the
  failing field and write nothing. Never partially import. The catch is that an import
  writes to SQLite _and_ to the file tree, and only one of them can roll back: the
  verbatim document is staged beside its destination and renamed in after the transaction
  commits, never written straight to `plans/<slug>/v<N>.md`. The version guard reads
  `MAX(version_no)` and the insert depends on it, so the transaction is `IMMEDIATE`.
- **`docs/CONTRACT.md` is shipped output, not internal documentation.** It is reproduced
  verbatim in **both** outbound templates — Section 4 of every export and Section 2 of the
  bootstrap prompt — so editing it changes the instructions every AI receives, whether it
  is authoring a first plan or revising one.
- **Every failed import produces a pasteable report — not just contract violations.**
  Field path, expected, found, written for an AI to read. The user's recovery from a bad
  import is pasting the error back into their chat, never hand-editing YAML, so a failure
  path that returns an empty report is as broken as one that returns no error at all.
  Malformed YAML is the likeliest failure of all and gets the same treatment.
- **Both outbound templates instruct the AI to ask rather than assume**, with worked
  examples. "I have dumbbells" must produce a question about plates and increments, not a
  guessed weight. A wrong assumption is silent: it becomes a prescription the user cannot
  perform, and they conclude the plan is not for them. The only sanctioned estimates are a
  starting load and a starting rep target, both only after asking and both labelled as
  estimates in the prose.
- **Contract changes touch three places together:** `docs/CONTRACT.md`, the Zod schema,
  and the fixture. A spec change that leaves the fixture stale is a broken change.
- **The export's progress summary is arithmetic the AI will trust and not check.** It
  exists so the reviewing AI reads "goblet squat: 6 kg, 12/12/12" instead of deriving it
  from 400 CSV rows, which means a wrong number there becomes a wrong prescription, and
  nothing in the loop catches it. Load is per set, so a single hoisted weight is only
  correct when every set carried it; "first" and "latest" must be chronological, not
  whatever order the rows arrived in. The summary is Markdown tables built by string
  concatenation, so every free-text value — session names, metric labels, user notes —
  gets its `|` escaped or it eats the rest of the row.
- **The contract key is `plan`, and synonyms are not accepted.** `plan.slug`,
  `plan_version`, `plan_id`. The word was chosen partly because it is spelled
  identically in every variety of English, unlike `programme`/`program` — but a revising
  AI will still reach for `program`, `routine` or `workout`. The parser must reject those
  loudly rather than coercing them, and nothing may reintroduce them as aliases.

## The fixture

[`fixtures/plans/home-dumbbell-v1.md`](fixtures/plans/home-dumbbell-v1.md) is
the spine of the phase-1 test suite.

- **It is fictional, and must stay that way.** The profile, training history and symptom
  context are invented. It is modelled closely on a real AI-authored plan so it
  behaves like one, but this repository is public — never commit real health data to it,
  in fixtures, tests or examples.
- It exercises every primitive in one file: a rounds block, checkoff warm-ups, two
  conditional exercises, per-side reps and per-side time, ranged sets and ranged rest,
  bodyweight-to-loaded progressions, catalogue rest defaults overridden per occurrence,
  a movement that exists only as a substitute, and metrics at all three scopes.
- Its oddities are **deliberate test cases, not defects.** The eight documented
  interpretations in "Import notes" should not be tidied away.
- 23 exercises, 60 prescriptions, 4 sessions. The catalogue declares each movement once,
  so an exercise appearing in three sessions has one entry and three prescriptions — and
  one entry, `lying-triceps-extension`, has none, because it is only ever a substitute.

## Build order

Phase 1 is the pure round-trip core with **no UI at all**: contract parser, diff engine,
export generator, plus the golden test that imports the fixture, logs synthetic workouts,
exports, re-imports, and asserts every ID survives and `context_md` is unchanged.

Everything else is built on that guarantee, so it comes first. Full phase table in
ARCHITECTURE §12.

Parsing, diffing, progression logic and export generation are pure functions over plain
data — no I/O, and the clock is injected so they stay deterministic. The database layer
follows the same rule where it can: provisioning and import take an injected `now`.

Phase 2 reconciled ARCHITECTURE §5 with the exercise catalogue before writing any DDL —
the five gaps listed there are closed by `src/lib/db/schema.ts`, which is now the
schema's specification. `source_md` lives on disk at `plans/<plan.slug>/v<N>.md`; the DB
stores the path, never a second copy of the document.

## Non-goals

Do not build, and do not propose: in-app AI or chat; an exercise library with demo
videos; social or sharing features; nutrition tracking beyond plan-declared metrics;
wearable, Health/Fit or Strava integration; a native mobile app; or a calendar with
planned-schedule adherence.
