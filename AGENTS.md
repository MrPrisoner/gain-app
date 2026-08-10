# AGENTS.md

Guidance for AI agents working in this repository — Claude Code, Cline, and anything
else that reads this file. It is the single source of truth; `CLAUDE.md` points here.

## Current state

**Phases 1–4 are done.** Phase 1 is the pure round-trip core: contract schema
(`src/lib/contract/`), parser (`src/lib/parse/`), diff engine (`src/lib/diff/`), export
generator (`src/lib/export/`) and both prompt templates (`src/lib/templates/`) — pure
functions over plain data, no I/O. Phase 2 is the storage layer (`src/lib/db/`): the
reconciled domain model as migration 001, per-user provisioning, the import writer and
import review — import writes a version, and a second import produces a correct diff.
Phase 3 is the web app: SvelteKit scaffolded at the repo root, OIDC auth against
Authentik with the group gate, sessions in `control.db`, the container (`Dockerfile`,
`compose.yaml`), and first run — empty state → bootstrap prompt out → paste a plan in →
commit. Phase 4 is the session runner (`src/routes/plan/[slug]/session/[key]/`): it logs a
full session of the real fixture plan on a phone — warm-up checkoff, the pinned log strip,
per-side and ranged-set exercises, rest timers, rounds blocks, skip/substitute/add-set/
drop-set deviations, a reload that resumes ledger and cursor rather than just the workout
row, the pre-session and wrap-up metric prompts, and a red-flag stop — which is phase 4's
own "done when" (ARCHITECTURE §12). `e2e/session-runner-walkthrough-a.spec.ts` and
`e2e/session-runner-walkthrough-d.spec.ts` walk both fixture sessions end-to-end as the
durable proof of that. Phase 5 (offline PWA: IndexedDB, sync queue, idempotency) is next;
phases 5–7 have not started, and the build-order table in ARCHITECTURE §12 is the map.

Commands (Node 24 LTS — see `.nvmrc` and the `engines` field):

- `npm install` — dependencies
- `npm test` — Vitest; includes the golden round-trip test, the project's spine
- `npm run test:e2e` — Playwright, the session runner in a real browser at three
  viewports. Needs `npx playwright install chromium` once first (~150MB), which is
  exactly why it is deliberately kept out of `npm run verify` — CI's few-seconds check
  never downloads a browser. `e2e/` is still typechecked, linted and formatted by
  `verify`; it is only never _executed_ by it
- `npm run typecheck` — strict TypeScript, `tsc --noEmit`; `tsc` never sees `.svelte`
- `npm run check` — `svelte-check` covers the `.svelte` files typecheck cannot
- `npm run dev` / `npm run build` — Vite dev server / adapter-node production build
  (`node build` serves it; `ORIGIN` required outside dev)
- `npm run lint` — ESLint
- `npm run format` / `npm run format:check` — Prettier. `docs/`, `fixtures/`,
  `templates/` and `design/` are byte-sensitive and excluded from formatting; never
  remove them from `.prettierignore`
- `npm run check:chars` — rejects literal control characters in tracked text files
- `npm run verify` — all of the above in CI's order, then `npm run build`. A few seconds.
  Run this before saying work is done rather than reasoning about whether it would pass.
  It short-circuits, so a lint failure means the tests never ran. The build is in there
  because typecheck and `svelte-check` do not exercise the adapter, the `?raw` asset
  imports or the Vite config — code that passes both and still cannot ship is a real
  failure mode, not a hypothetical one

**One agent at a time.** Agents do not work concurrently in this repository. If you find
uncommitted changes you did not make, stop and ask rather than committing around them.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first, then
[`docs/CONTRACT.md`](docs/CONTRACT.md), before doing anything substantive. The twelve
design decisions in ARCHITECTURE §2 are settled — implement against them rather than
relitigating them. The same applies to
[`docs/UI-DECISIONS.md`](docs/UI-DECISIONS.md), which settles how the session runner
behaves; read it before touching anything user-facing.

### Stack

TypeScript + SvelteKit, single Node container, SQLite via `better-sqlite3`, Zod for
contract validation, Vitest for tests. One image, one port, one volume. The phase-1/2
core is plain TypeScript with no framework, and since phase 3 it doubles as the
SvelteKit app's `$lib` — the app imports the core directly, and the core's tests still
run without the framework.

Node version, package manager, lint/format and CI are settled in ARCHITECTURE §12,
"Toolchain, settled". Implement those choices; do not make them again.

**Every dependency here is on a current major, and probably a newer one than you
remember.** Zod 4, TypeScript 6, ESLint 10, Vitest 4, Node 24, better-sqlite3 13. Zod is
the one that bites: this repo uses `z.strictObject`, `z.looseObject` and `error:`, and a
model reaching for Zod 3 from memory writes `z.object().strict()` and `message:` — then
"fixes" correct code into broken code. Check `package.json` and the real API before
changing schema code, rather than trusting recall. If a docs lookup is available, use it.

### Agent tooling

Committed so every agent gets the same setup. It is a convenience, not the contract:
`npm run verify` is the contract, and it is what CI runs.

- `.mcp.json` — a documentation server (Context7), for exactly the version problem above.
  Claude Code picks it up automatically. Cline and others read their own MCP settings
  file; the server is `npx -y @upstash/context7-mcp` over stdio. `CONTEXT7_API_KEY` is
  optional and only raises rate limits.
- `.claude/settings.json` — a `PostToolUse` hook that runs Prettier on the file just
  edited and `tsc --noEmit` across the project, and feeds any type errors straight back.
  Claude Code only.
- `.claude/commands/verify.md` — `/verify`, a thin wrapper over `npm run verify`. Claude
  Code only.
- `.vscode/settings.json` — pins Prettier as the formatter for every language it handles,
  so format-on-save cannot reformat a byte-sensitive file behind `.prettierignore`, and
  points the editor at the repo's TypeScript rather than the bundled one.

**Without hooks or slash commands, do the same thing by hand.** Run
`npx prettier --write <file>` after editing a TypeScript file, and `npm run verify`
before saying the work is done. That is all the hook and `/verify` automate, and an agent
that does it manually is in exactly the same position as one that does not have to.

**Where the hook changes what you see.** It rewrites the file after your edit, so a
follow-up edit whose target region was reformatted will not match — read the file back
first. It also typechecks the whole project on every edit, so during a multi-file
refactor it reports errors from files you have not reached yet. That is expected, not a
signal to stop and not a reason to revert.

**`npm run lint` is type-aware**, so it needs the TypeScript project to resolve and fails
differently from a syntax-only pass.

**Never write a literal control character — write the escape.** `\u0000`, not the
character itself. Two checks enforce this: the `gain/no-control-characters` ESLint rule
covers TypeScript, and `npm run check:chars` covers every tracked text file, Markdown and
JSON included. If either fires, fix the character; do not reach for an `eslint-disable`
or narrow the glob. It is worth two checks because it is easy to do by accident and
invisible once done — three literal NULs sat in `src/lib/export/bundle.ts` through an
entire commit with prettier, eslint and tsc all reporting clean, git treated the file as
binary, and no diff was shown for anyone to review. It has since happened twice more,
once to this file, which is why the check is not limited to source.

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
table keyed by `user_id`. The one shared database is `control.db` — the OIDC `sub` →
user id mapping and server-side sessions — and it stays that way: nothing personal in
it, no names, no emails.

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

Phase 3 scaffolded SvelteKit at the repo root rather than beside it: SvelteKit's `$lib`
alias maps onto the existing `src/lib`, so the app imports the pure core unchanged. The
server layer (`src/lib/server/`) keeps the deterministic rule where it can — config
loading, `control.db`, the OIDC module and the cookie signing are injectable and
unit-tested without a live IdP, with real signed JWTs in the tests. The dev bypass
(`GAIN_DEV_USER`) exists so the UI can be built without Authentik, and a production
build refuses to start with it set.

### What the phase-3 review changed

Four of these are worth carrying forward as rules rather than as fixes.

**Every form gets `use:enhance`.** Without it a form action is a full navigation, the
component remounts, and component state is gone. The first-run paste box lost the user's
pasted plan on every failed import that way — the error was displayed above an empty
box, which is precisely the wall UI-DECISIONS §11 says a failed import must not be. The
server action echoes `source` back as well, so the no-JS path also refills.

**An unevaluable check is not a failed check.** The group gate is re-checked on every
token refresh (§4), and the first implementation treated "GAIN could not establish
membership" the same as "the IdP says no" — so an IdP that omits `id_token` from a
refresh response, plus one blip at the userinfo endpoint, evicted a legitimate user
mid-session. `fetchUserinfoGroups` now returns `null` for "could not tell", distinct
from `[]`, and the mid-session re-check keeps the session on `null` while a login still
denies. Same rule for the token endpoint: unreachable keeps the session, an explicit
rejection ends it. Expect this distinction anywhere a remote answer gates access.

**An expired session must not turn a POST into a GET.** The gate redirects navigations
to `/login` and answers everything else with 401 (`src/lib/server/gate.ts`). A 303 replays
a POST as a GET and discards the body — survivable for a form, fatal for the phase-5 sync
queue, which §4 requires to keep its data across a 401.

**CI builds the image on every change**, and smoke-tests that it boots, answers
`/healthz` and runs as non-root. It is only pushed on a tag. A Dockerfile that stopped
working should fail the PR that broke it, not the release that needed it.

## Non-goals

Do not build, and do not propose: in-app AI or chat; an exercise library with demo
videos; social or sharing features; nutrition tracking beyond plan-declared metrics;
wearable, Health/Fit or Strava integration; a native mobile app; or a calendar with
planned-schedule adherence.
