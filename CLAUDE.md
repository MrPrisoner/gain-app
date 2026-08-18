# CLAUDE.md

Guidance for AI agents working in this repository. It is the single source of truth —
there is no separate `AGENTS.md`; this file used to be a symlink to one, but the project
now only supports Claude Code, so the indirection was dropped.

## Current state

**Phases 1–7 and 9 are done.** Phase 1 is the pure round-trip core: contract schema
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
durable proof of that. Phase 5 is the export UI
(`src/routes/plan/[slug]/export/`): `src/lib/db/logs.ts` reads the plain-data `Logs`
shape the phase-1 generator has always consumed out of `gain.db`, keyed on `(scope, key)`
and spanning every version of the plan; `src/lib/export/windows.ts` derives the window
picker's options from the plan's own `block_length_weeks` rather than a constant, dropping
the middle option entirely when a plan declares none; and the route assembles, previews and
archives the bundle, copy-with-download-fallback exactly as the bootstrap prompt does.
`e2e/export-walkthrough.spec.ts` logs a session and exports it as the durable proof that
Section 1 comes back byte-identical to the imported document. Phase 6 is the offline PWA:
a client write layer (`src/lib/sync/`) appends ops to an IndexedDB outbox and flushes them
as ordered batches to `POST /api/sync`, which replays them idempotently through
`src/lib/db/workout.ts`; the session runner (`src/routes/plan/[slug]/session/[key]/`) was
rewired to write through that layer instead of SvelteKit form actions, so a session can be
started, logged and finished with no connection at all, including across a full browser
kill — proven by `e2e/offline-*.spec.ts` on a real production build, since
`$service-worker`'s precache manifest is empty under `vite dev`. `src/service-worker.ts`
precaches the app shell and each visited plan's session data. Phase 7 is progress, history
& the Home screen: `src/lib/progress/double-progression.ts` is the one pure module double
progression's "one session from a load increase" state is computed in, consumed by both
`src/lib/export/summary.ts`'s per-exercise table and the exercises list/detail routes
rather than reimplemented twice; `src/lib/progress/exercise-series.ts`,
`session-stats.ts` and `metric-series.ts` back the per-exercise, per-session-type and
metric-trend charts under `src/routes/plan/[slug]/progress/`; and
`src/lib/db/history.ts` backs the reverse-chronological workout list and detail
drill-down under `src/routes/plan/[slug]/history/`, both reachable from the Home plan
card. `e2e/progress-walkthrough.spec.ts` and `e2e/history-walkthrough.spec.ts` walk both
end to end as the durable proof. Phase 9, Operations, was built out of order ahead of
phase 8: `OIDC_ADMIN_GROUP` gates an optional operator role, re-derived from the OIDC
groups on every session refresh rather than stored on the user
(`src/lib/server/auth.ts`); `src/lib/server/admin-stats.ts` is the one module allowed to
open another user's `gain.db`, returning only counts, dates and byte totals; the `/admin`
screen (`src/routes/admin/`) reads each user's aggregates back as one interpretive
sentence rather than a grid, and its per-user reset (`src/lib/server/admin-reset.ts`)
bumps `control_user.data_generation` so the wiped user's offline outbox is rejected
wholesale on reconnect rather than quarantining piecemeal. `e2e/admin-walkthrough.spec.ts`
is the durable proof. Phase 8 has not started. **Phase 8 (revision diff review,
template editor) is next.**

Two files hold the plan: the build-order table in ARCHITECTURE §12 is the map, and
[`docs/ROADMAP.md`](docs/ROADMAP.md) is the itinerary — the remaining work item by item,
with acceptance criteria and notes on what groundwork already exists. Read the roadmap
before picking up work; it will save you rebuilding something phase 1 already wrote.

Commands (Node 24 LTS — see `.nvmrc` and the `engines` field):

- `npm install` — dependencies
- `npm test` — Vitest; includes the golden round-trip test, the project's spine.
  `npx vitest run tests/parse.test.ts` runs a single file
- `npm run test:e2e` — Playwright: the session runner at three viewports against
  `vite dev`, plus a fourth `offline` project that builds and runs a real `node build`
  server on its own port — `$service-worker`'s precache manifest is empty under `vite
dev`, so no offline spec can pass there. The build step means this project alone can
  take noticeably longer than the other three. Needs `npx playwright install chromium`
  once first (~150MB), which is exactly why it is deliberately kept out of `npm run
verify` — CI's few-seconds check never downloads a browser. `e2e/` is still
  typechecked, linted and formatted by `verify`; it is only never _executed_ by it.
  Narrow a run with `npx playwright test --project=offline e2e/offline-session.spec.ts`
  rather than paying for the production build four times over. The three viewport
  projects are named `small-android`, `iphone` and `tablet-portrait` (see
  `playwright.config.ts`) — not `phone` or `mobile`
- **To see a UI change without a display**, write a throwaway spec under `e2e/` (reuse
  `e2e/helpers.ts`'s gestures rather than re-deriving them), run it against a real
  project — `npx playwright test --project=iphone e2e/tmp-*.spec.ts` — and
  `page.screenshot()` to a file the Read tool can open. Delete the spec before
  committing; it is scaffolding, not coverage
- `npm run typecheck` — strict TypeScript, `tsc --noEmit`, plus a second `tsc --noEmit -p
tsconfig.worker.json` pass for `src/service-worker.ts` — SvelteKit's generated tsconfig
  deliberately excludes that file (WebWorker lib vs. DOM lib conflict), so it needs its own
  project or it silently never typechecks at all; `tsc` never sees `.svelte`
- `npm run check` — `svelte-check` covers the `.svelte` files typecheck cannot
- `npm run dev` / `npm run build` — Vite dev server / adapter-node production build
  (`node build` serves it; `ORIGIN` required outside dev). `GAIN_DEV_USER=you npm run dev`
  bypasses OIDC so the UI can be driven without an Authentik to point at; per-developer
  variables belong in the git-ignored `.env.local`, and the bottom of `.env.example` says
  which ones are allowed there
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

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first, then
[`docs/CONTRACT.md`](docs/CONTRACT.md), before doing anything substantive. The twelve
design decisions in ARCHITECTURE §2 are settled — implement against them rather than
relitigating them. The same applies to
[`docs/UI-DECISIONS.md`](docs/UI-DECISIONS.md), which settles how the session runner
behaves; read it before touching anything user-facing.

### Releasing

`git tag vX.Y.Z && git push origin vX.Y.Z` on `main`, after merging — nothing else. CI
(ARCHITECTURE §12) runs the full check-and-build on every PR and does nothing on a plain
push to `main`, since the commit was already vetted there; a `v*` tag is the one event
that re-validates and pushes the image, so it is also the one event that means "this is a
release." Picking `X.Y.Z` is a human judgement call (breaking / feature / fix), not
something to automate from commit history. Never create the tag yourself without being
asked — pushing one triggers a public image push to GHCR.

### Stack

TypeScript + SvelteKit, single Node container, SQLite via `better-sqlite3`, Zod for
contract validation, Vitest for tests. One image, one port, one volume. The phase-1/2
core is plain TypeScript with no framework, and since phase 3 it doubles as the
SvelteKit app's `$lib` — the app imports the core directly, and the core's tests still
run without the framework.

Node version, package manager, lint/format and CI are settled in ARCHITECTURE §12,
"Toolchain, settled". Implement those choices; do not make them again.

**Every dependency here is on a current major, and probably a newer one than you
remember.** Zod 4, Svelte 5, TypeScript 6, ESLint 10, Vitest 4, Node 24 and
better-sqlite3 13. Two of them bite. Zod: this repo uses `z.strictObject`,
`z.looseObject` and `error:`, and a model reaching for Zod 3 from memory writes
`z.object().strict()` and `message:` — then "fixes" correct code into broken code.
Svelte: every component is runes mode (`$state`, `$derived`, `$props`, `$effect`), and
there is not one `export let` or `createEventDispatcher` anywhere in `src/` — phase 7 is
mostly new components, so it is the trap with the most surface area still ahead of it.
Check `package.json` and the real API before changing schema or component code, rather
than trusting recall. If a docs lookup is available, use it.

**Icons come from `~icons/lucide/*` and are inlined at build time.** `unplugin-icons`
plus `@iconify-json/lucide`, both devDependencies, wired up in `vite.config.ts` — the
import resolves to a Svelte component compiled into the bundle, so an icon costs one
inline `<svg>` and no runtime anything. Reach for `@iconify/svelte` instead and it will
look identical in development and render blank squares on a phone in a garage: that
integration fetches each icon from `api.iconify.design` on first use, which is a network
call, and offline is a hard requirement here rather than a nicety. Icons carry no colour
or size of their own — Lucide ships them 1em square in `currentColor`, and one rule in
`src/app.css` sizes every `<svg>` in the app relative to the text beside it. Do not add a
`width`/`height` to a call site; change the font-size of what it sits in. And note that a
class passed to an icon needs `:global()` to style, since Svelte never applies its scoping
hash to another component's markup.

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

**Do not use git worktrees in this repo, including to resume a session that hit a token
limit.** A session's history lives with the workspace that was open when it ran; move
that session into a worktree and it drops out of the VS Code extension's history tab,
making an incomplete session unrecoverable there. Work directly in the main checkout
instead.

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

**That is about chat replies, not about files.** `docs/` is a collection of documents with
different jobs and different shapes: ARCHITECTURE, CONTRACT and UI-DECISIONS argue a case,
so their prose is deliberate and should not be flattened into bullets when you edit them;
ROADMAP is a checklist and should read like one. Match the document you are in.

### Keep the status current

Four files state where the build has got to, and a stale one costs the next agent a
wasted rebuild of something that already exists. When work closes, update them in the same
commit:

- **`README.md`** — the status banner. It is the first thing a human reads, and it is the
  one that drifts: it still announced phase 3 with phase 4 shipped and walked-through by
  two e2e specs.
- **`docs/ROADMAP.md`** — tick the item, append the commit SHA. Finishing a phase also
  means moving the "next" marker and the phase table's state column.
- **`CLAUDE.md`** — the "Current state" paragraph above, when a whole phase closes, and
  a "What the phase-N review changed" subsection under Build order if the build
  surfaced rules worth carrying forward rather than one-off fixes.
- **`docs/ARCHITECTURE.md` §12** — the build-order table's "Done when" column, kept in
  sync with what ROADMAP says the phase actually shipped.

A closing phase can also surface a survival or acceptance scenario the automated suite
structurally cannot cover — phase 6's e2e harness can kill a browser but not the server
process independently of the client, so a container-restart-while-queued check went into
`todo.md` as a manual step with exact commands, rather than left implied by a ticked
roadmap item. `todo.md` is otherwise the inbox for findings from manual testing, not a
plan. Anything in it bigger than a single commit gets moved into the roadmap under the
phase it belongs to; anything smaller gets done and deleted rather than struck through. A
design decision that falls out of a to-do item belongs in the Invariants section below —
that is where the `weight_kg` ruling went, and it is why it survived.

### Commit messages, settled

`type(scope): imperative summary` — e.g.
`feat(export): add the export screen and reach it from the plan card`. This is
Conventional Commits (the Angular type list); it is also just what most of this repo's
history already converged on before it was written down here.

- Types: `feat`, `fix`, `refactor`, `style`, `test`, `docs`, `chore`.
- Scope is required — the module or area touched (`session`, `export`, `home`, `db`,
  `plan`, `e2e`...) — except for changes that are genuinely repo-wide, which drop it.
- The summary is lowercase, imperative ("add", not "adds" or "added"), no trailing
  period, and reads as a complete sentence on its own. It is the changelog entry,
  verbatim — a release note gets built by pulling summaries forward, not by rewriting
  them, so it has to hold up alone without the body for context.
- A breaking change gets `!` after the scope (`feat(db)!: ...`) and a `BREAKING CHANGE:`
  footer explaining the migration. Nothing has needed this yet; it is settled anyway so
  the first commit that does need it does not also have to invent the convention.

The body is prose paragraphs, not bullets — the same split "How to report back" draws
between chat replies and files applies here: a commit message is a file. State what
changed and why; call out a decision or a gotcha if the commit had one.

`Co-Authored-By: Claude <model> <noreply@anthropic.com>` closes the message when Claude
authored the commit. That is a standard git/GitHub trailer, not part of Conventional
Commits itself.

The ~35 commits before this was written down (`Add icon svg`, `Phase 1: pure round-trip
core`, ...) predate the convention and are not worth rewriting.

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

**A quarantined op is held, never dropped, and never retried forever.** An op that can
never succeed — an `exerciseSlug` a plan revision removed, a payload that fails its schema
— is retained, marked failed, and surfaced in the UI rather than discarded or retried
indefinitely against the ops behind it. This is the one place "hold everything" and "never
lose anything" conflict, and it resolves in favour of keeping the data and telling the
user (design spec §6). An invisible quarantined op — one the banner does not surface — is
exactly the data loss this whole phase exists to prevent, just moved one step later.

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
- **Prefill can be stale during an offline streak, and that is accepted rather than
  solved.** Pre-fill reads from the server's `set_log` rows, so a second session logged
  offline before the first has synced is pre-filled from the last _synced_ performance,
  not the still-queued one. It self-corrects on any reconnect. This is fine specifically
  because prefill is a suggestion and the ledger stores what was submitted, not what was
  offered — a stale prefill is a one-tap-correctable annoyance, and unlike every other
  number in this phase it can never reach the export or the reviewing AI (design spec §2,
  decision 5).
- **`weight_kg` is always the total kilograms being lifted**, everywhere — the log, the
  charts, the export. Settled 2026-08-10: the contract has no field meaning "this movement
  is paired", `per_side` is not that field, and adding one was rejected because
  `docs/CONTRACT.md` ships verbatim in every export and bootstrap prompt. So UI-DECISIONS
  §3's `2 × N` sub-line is the single clause of that document deliberately left unbuilt.
  Do not implement it, do not add a `paired` field, and do not infer pairing from a slug
  or a load label. The full reasoning, including the one honest consequence it leaves
  behind, is in UI-DECISIONS §3.
- **There is one completion mark in the runner, and it is not a colour.** A tick in the
  accent hue beside a finished exercise, a checked-off warm-up pill and a completed block
  heading — the same mark in all three, because a screen that says "done" two different
  ways makes the user learn two vocabularies for one idea. Settled 2026-08-15; the
  reasoning, including why the pills do not reserve space and why a rounds block asks its
  round counter rather than its exercises, is in UI-DECISIONS §1. Do not add a green
  success state here: §5's symptom triad is the only place green, amber and red mean
  anything, and a list that traffic-lights progress competes with the one scale that has
  to stay readable.
- **The post-session celebration is a moment, never a step, and carries no colour §5
  otherwise reserves.** It renders after the finish op is already written and the
  workout's local key already cleared, so dismissing it — or never dismissing it — cannot
  change what reaches the export; a red-flag stop skips it entirely. Its confetti is
  accent/gold/silver, a deliberate, narrow exception to §5's green/amber/red symptom
  triad, confined to this one full-screen moment. Full reasoning in UI-DECISIONS §8,
  "Settled 2026-08-15".
- **The contract key is `plan`, and synonyms are not accepted.** `plan.slug`,
  `plan_version`, `plan_id`. The word was chosen partly because it is spelled
  identically in every variety of English, unlike `programme`/`program` — but a revising
  AI will still reach for `program`, `routine` or `workout`. The parser must reject those
  loudly rather than coercing them, and nothing may reintroduce them as aliases.
- **A `set_log` reference match may never overwrite a row on its own — only an explicit
  `isCorrection` from the caller may.** `(workout_id, exercise_def_id, set_no, side)` is
  not a unique slot identity, because `set_log` has no `block_key` column (deliberately —
  see `$lib/session/resume.ts`'s module comment): a block that prescribes an exercise
  directly and also offers it as another exercise's substitute produces two genuinely
  distinct sets sharing that exact reference the moment the substitute is swapped in.
  `logSet` (`$lib/db/workout.ts`) upserts by that reference to let a mis-tapped set be
  corrected in place, but trusting a reference match alone — regardless of intent — silently
  merged the second slot's first log into the first slot's row, dropping a set rather than
  logging one (`e2e/session-runner-walkthrough-d.spec.ts`'s dead-bug/reverse-crunch
  regression, 2026-08-17). The runner sets `isCorrection` only when re-showing an
  already-logged row (`editingSlot`); a fresh log of a new slot never does, no matter what
  it collides with. The ULID-ordering "an older write must never win" guard still runs
  unconditionally, since it only ever returns an existing row without writing — it is the
  _overwrite_ that needs the caller's explicit say-so, not the lookup itself.
- **The operator sees counts, never content — and the reset's order is load-bearing.**
  `OIDC_ADMIN_GROUP` grants a `/admin` screen (ARCHITECTURE §4) whose every cross-user
  read goes through `src/lib/server/admin-stats.ts`, which returns only `COUNT(*)`,
  `MAX(...)` and byte totals. Nothing else in the app may open another user's `gain.db`;
  putting a second such reader anywhere else dissolves the guarantee, because it is the
  single module boundary — not a rule — that keeps it true. The reset in
  `src/lib/server/admin-reset.ts` closes and evicts the cached handle **before** the
  unlink: `better-sqlite3` holds the file open, so unlinking first leaves the process
  writing to a deleted inode and the reset silently does nothing. It also bumps
  `control_user.data_generation`, which is what stops the wiped user's offline outbox
  flushing back in and quarantining forever — the one place GAIN deliberately discards
  local data, and narrow by construction: only on the server's explicit 409.

## The fixture

[`fixtures/plans/home-training-v1.md`](fixtures/plans/home-training-v1.md) is
the spine of the phase-1 test suite — a fictionalised, current-generation plan (authored
against this shipped `docs/CONTRACT.md`, the way the loop actually produces one) rather
than a hand-written spec fixture.

- **It is fictional, and must stay that way.** The profile, training history and symptom
  context are invented. It is modelled closely on a real AI-authored plan so it
  behaves like one, but this repository is public — never commit real health data to it,
  in fixtures, tests or examples.
- It exercises every primitive in one file: a rounds block, checkoff warm-ups,
  conditional exercises both with and without substitutes, per-side reps and per-side
  time and a per-side movement carrying an external load, ranged sets, scalar and ranged
  reps/duration/rest, catalogue rest defaults overridden per occurrence, a
  prescription-level load and substitute override, movements that exist only as
  substitutes, and metrics at all three scopes — including one key, `symptoms_during`,
  declared at **both** set and session scope, which is what makes the `(scope, key)`
  invariant below testable at all. `tests/fixture-coverage.test.ts` asserts this coverage
  directly, so a future edit that drops a primitive fails loudly rather than silently.
- Its oddities are **deliberate test cases, not defects.** The documented
  interpretations in "What I have estimated, and what to correct after week one" should
  not be tidied away.
- 26 exercises, 49 prescriptions, 4 sessions. The catalogue declares each movement once,
  so an exercise appearing in three sessions has one entry and three prescriptions — and
  three entries — `seated-floor-shoulder-press`, `overhead-triceps-extension`,
  `side-plank-knees` — have none, because each is only ever a substitute.

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
a POST as a GET and discards the body — survivable for a form, fatal for the phase-6 sync
queue, which §4 requires to keep its data across a 401.

**CI builds the image on every change**, and smoke-tests that it boots, answers
`/healthz` and runs as non-root. It is only pushed on a tag. A Dockerfile that stopped
working should fail the PR that broke it, not the release that needed it.

Phase 4 kept the same shape: the session runner's logic is pure and lives in
`src/lib/session/` (resolution, pre-fill, rest timer, resume reconstruction), unit-tested
without SvelteKit; the route is thin. ARCHITECTURE §9 holds the architecture,
[`docs/UI-DECISIONS.md`](docs/UI-DECISIONS.md) holds the behaviour, and the build was made
to conform to the latter rather than the reverse.

### What the phase-4 review changed

Phase 4 shipped, was reviewed against UI-DECISIONS, and was substantially rebuilt. These
are the rules worth carrying forward rather than the fixes.

**A form action must never throw.** In SvelteKit a thrown `Error` inside an action is a
500, `applyAction` renders `+error.svelte`, and the entire in-progress session — open
exercise, rest timer, unsaved state — is destroyed. One malformed form field cost a
workout. Every failure path returns `fail(400, { actionError })`; nothing in `actions`
throws except `redirect`. The same reasoning covers unchecked casts: a value headed for a
schema `CHECK` constraint gets validated in the action, or a bad one arrives as a
SQLITE_CONSTRAINT 500 instead of a 400.

**A control that can post before its precondition exists must be disabled.** The runner
rendered every logging control while the `?/start` round-trip was still in flight, so a
fast tap posted `workout_id=""` and hit the 500 above. Disable and show the pending state;
do not rely on the user being slower than the network.

**An error the user cannot see is worse than a crash.** A failed set log rendered at the
bottom of the document in `var(--muted)` looks exactly like success from mid-set. Errors
belong next to the control that failed, legible at arm's length — and never in
`var(--red)`, which belongs to the plan's symptom framework (UI-DECISIONS §5).

**Recording an intent is not honouring it.** A skip that writes a `deviation` row and
leaves the exercise loggable, or a swap that keeps posting the original slug, produces an
export stating the user did the movement the plan told them to avoid. Nothing errors, and
the wrong claim reaches the next revision. Every state-changing action must change the
state it names.

**Client state is what was submitted, never what was pre-filled.** The ledger once
rendered from the pre-fill map, so it showed the numbers the user was offered rather than
the ones they logged.

**Everything in the runner keys on `block:slug`**, because one movement can be prescribed
in two blocks of one session. A lookup that searches `blocks.flatMap(b => b.exercises)`
finds the wrong block's overrides. Note the consequence in ARCHITECTURE §5 and §9: log
rows carry no `block_key`, so resuming a workout has to match rows back onto occurrences.

**A contract range is a tuple, so it must be formatted, not interpolated.** `[8, 12]`
stringifies to `8,12`. It escaped review because it is not an exception — it is nearly
every prescription in the fixture rendering as a typo.

**Layout is verified in a browser at 360 px.** The runner's worst bug was a grid that
could not shrink, and nothing in `verify` could ever have seen it. `npm run test:e2e`
asserts no horizontal overflow on every screen at three viewports in both themes; see
UI-DECISIONS §12.

Phase 6 rewired the runner from form actions onto the client write layer described above.
It kept phase 4's shape — pure logic in `$lib`, a thin route — and reused
`hydrateSession`/`resume.ts` unchanged, projecting the outbox into the same row shape
rather than writing a second reconstruction path.

### What the phase-6 review changed

**Module-level reactive state needs an explicit way back out of every state it can enter.**
`client.svelte.ts`'s flush loop set a `needs-auth` state on a 401 and nothing ever cleared
it — re-authentication is a same-origin SPA navigation, which does not reset module state,
so a queue that hit one 401 stayed stuck forever even after the user signed back in. The
fix folded `needs-auth` into the same retry/backoff path as every other failure
(`scheduleRetry`, guarded on whether a retry is pending rather than on the state value)
instead of giving it its own terminal branch. Any state a module can enter on its own
needs a way back out that does not depend on the page reloading.

**A precache lookup must match how the app actually requests the resource, not how it was
stored.** `precacheSessions` stores a route's `__data.json` at its bare URL; SvelteKit's
own client router appends `?x-sveltekit-invalidated=...` to every data fetch. An exact
`cache.match` therefore never hit, and the miss looked like the whole precache had failed
rather than like a query-string mismatch. Scope `ignoreSearch` narrowly (here, to
`__data.json` paths) rather than globally, or an unrelated cached route starts serving
stale content on any query string at all.

**A public-path allowlist must include every asset the install step touches, or the first
load loops.** `/offline` was left off `isPublicPath`, and `cache.addAll` is all-or-nothing
— a single 401 from a gated `/offline` fetch failed the entire service-worker install,
silently, on the very first page load, since installation happens before the user has
authenticated at all.

**A read path and a write path must not both be able to create the same row.** `?/start`
originally called `startWorkout` unconditionally, so a client that had already created the
workout offline (with its own client-stamped `startedAt`) could race the server into
creating a second, server-timestamped one on the next online load. Making `start` strictly
read-only — resolve by `client_id`, never create — removed the race instead of arbitrating
it.

**Local state alone is not sufficient to resume from, once anything can have synced.**
`ack()` deletes an op from the outbox the moment the server confirms it, so a reload that
rebuilt the ledger from IndexedDB alone would silently drop everything already synced.
Resume merges server hydration with whatever local ops remain, rather than trusting either
source alone.

**A generated tsconfig's exclusions are silent.** SvelteKit's own generated
`.svelte-kit/tsconfig.json` excludes `src/service-worker.ts` (it needs the WebWorker lib,
which conflicts with the app's DOM lib), so the file passed `npm run typecheck` while never
actually being typechecked — confirmed by deliberately injecting a type error and watching
`tsc` stay green. A file excluded from the project it appears to belong to needs its own
project (`tsconfig.worker.json`) or it is unverified, not verified-and-clean.

### What the phase-7 review changed

**A component that always renders its wrapper regardless of data makes an assertion
against that wrapper pass vacuously.** `Sparkline.svelte` renders its `<svg
aria-label>` in both the populated and empty-state branches — only the inner content
swaps — so `e2e/progress-walkthrough.spec.ts`'s original duration-chart assertion passed
even though the workout it logged was never finished, and `sessionTypeStats`'s
`completed_at`-gated duration series never got a point to plot. The fix
(`e2e/progress-walkthrough.spec.ts` now finishes the workout before asserting, `c4a0f4c`)
is smaller than the rule it surfaces: an e2e assertion on a chart or summary component has
to prove the underlying data path fired, not just that the component's shell rendered.
Check what state actually populates the component before asserting on it — every chart in
this phase renders its container unconditionally, so this is not a one-off.

**`exerciseOccurrences` only enumerates directly-prescribed pairs, and a mid-session
swap is invisible to it.** `src/lib/progress/exercise-series.ts`'s `exerciseOccurrences`
walks `contract.sessions` and each session's resolved blocks looking for a
`(session, exercise)` pairing the plan itself prescribes; it never looks at
`logs.set_logs`, so an exercise a user swapped in mid-session — never prescribed, only
logged — has no occurrence to attach its sets to. Its sets stay visible in the raw CSV
export and the Deviations row, but not on the Progress exercises list or the export's
per-exercise summary table. This surfaced during the `summary.ts` per-exercise refactor
and was carried forward, deliberately unfixed, into the exercises list built on top of it
— it is a real, accepted gap rather than a defect in either diff. Fixing it needs its own
design decision (what resolved prescription or range does a substitute-only occurrence
carry? nothing today specifies one) and its own tests; anyone extending per-exercise
progress or summary views on `exerciseOccurrences` should know the gap exists before
building on it.

## Non-goals

Do not build, and do not propose: in-app AI or chat; an exercise library with demo
videos; social or sharing features; nutrition tracking beyond plan-declared metrics;
wearable, Health/Fit or Strava integration; a native mobile app; or a calendar with
planned-schedule adherence.
