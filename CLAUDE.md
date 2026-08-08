# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

**This repository contains no code yet.** It holds an agreed design, a specification, a
settled UI design, a test fixture and a template. Phase 1 has not started.

There are therefore **no build, test, lint or run commands** — do not invent them, and do
not report a command as having been run. `package.json` and the toolchain arrive with
phase 1.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first, then
[`docs/CONTRACT.md`](docs/CONTRACT.md), before doing anything substantive. The twelve
design decisions in ARCHITECTURE §2 are settled — implement against them rather than
relitigating them. The same applies to
[`docs/UI-DECISIONS.md`](docs/UI-DECISIONS.md), which settles how the session runner
behaves; read it before touching anything user-facing.

### Stack, once phase 1 scaffolds it

TypeScript + SvelteKit, single Node container, SQLite via `better-sqlite3`, Zod for
contract validation, Vitest for tests. One image, one port, one volume.

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

## The architecture that isn't obvious from any single file

### A plan is two representations, and both round-trip

A plan document is a ~100-line **skeleton** (sessions → exercises → set targets,
inside one fenced ` ```gain-plan ` YAML block) wrapped in ~1200 lines of **prose
context** (rationale, form cues, injury rules, progression philosophy).

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

## Invariants

These break things quietly, and no test catches them today:

- **`context_md` is byte-identical** through import → storage → export → re-import.
- **Import is all-or-nothing.** On any validation failure, report the failing field and
  write nothing. Never partially import.
- **`docs/CONTRACT.md` is shipped output, not internal documentation.** It is reproduced
  verbatim as Section 4 of every export, so editing it changes the instructions every
  revising AI receives.
- **Contract changes touch three places together:** `docs/CONTRACT.md`, the Zod schema,
  and the fixture. A spec change that leaves the fixture stale is a broken change.
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
- It exercises every primitive in one file: a rounds block,
  checkoff warm-ups, two conditional exercises, per-side reps and per-side time, ranged
  sets and ranged rest, bodyweight-to-loaded progressions, both substitute forms, and one
  exercise carrying two display names under a single stable slug.
- Its oddities are **deliberate test cases, not defects.** The dual-named
  `overhead-triceps-extension` and the five documented interpretations in "Import notes"
  should not be tidied away.

## Build order

Phase 1 is the pure round-trip core with **no UI at all**: contract parser, diff engine,
export generator, plus the golden test that imports the fixture, logs synthetic workouts,
exports, re-imports, and asserts every ID survives and `context_md` is unchanged.

Everything else is built on that guarantee, so it comes first. Full phase table in
ARCHITECTURE §11.

Parsing, diffing, progression logic and export generation are pure functions over plain
data — no I/O, and the clock is injected so they stay deterministic.

## Non-goals

Do not build, and do not propose: in-app AI or chat; an exercise library with demo
videos; social or sharing features; nutrition tracking beyond plan-declared metrics;
wearable, Health/Fit or Strava integration; a native mobile app; or a calendar with
planned-schedule adherence.
