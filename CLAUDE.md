# CLAUDE.md

Guidance for AI agents working in this repository. It is the single source of truth —
there is no separate `AGENTS.md`; this file used to be a symlink to one, but the project
now only supports Claude Code, so the indirection was dropped.

## What exists

**GAIN is built, and the loop closes.** An AI writes a plan, GAIN imports it, a session
runs and logs offline on a phone, an export bundle goes back out, and the revision that
comes back is diff-reviewed and committed — with renamed exercises mapped onto their
history rather than silently split.

Where each part lives:

| Area                                                                                                 | Code                                                                                                                    |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Pure round-trip core — contract schema, parser, diff engine, export generator, both prompt templates | `src/lib/contract/`, `parse/`, `diff/`, `export/`, `templates/`                                                         |
| Storage — per-user provisioning, migrations, the import writer, reads                                | `src/lib/db/`                                                                                                           |
| Server — config, `control.db`, OIDC, the auth gate, admin stats and reset, logging                   | `src/lib/server/`                                                                                                       |
| Session runner — resolution, pre-fill, rest timer, resume, symptom guide                             | `src/lib/session/`; route at `src/routes/plan/[slug]/session/[key]/`                                                    |
| Offline write layer — IndexedDB outbox, flush loop, replay, precache                                 | `src/lib/sync/`, `src/service-worker.ts`                                                                                |
| Progress, charts & history                                                                           | `src/lib/progress/`, `src/lib/db/history.ts`                                                                            |
| Home screen — next session, last done, activity strip, morning prompt                                | `src/lib/home/`; route at `src/routes/+page.svelte` and its sibling components                                          |
| Import & revision diff review                                                                        | `src/lib/diff/present.ts`, `src/lib/import/`; route at `src/routes/import/`                                             |
| Operator view                                                                                        | `src/lib/server/admin-stats.ts`, `admin-reset.ts`; route at `src/routes/admin/`                                         |
| Shared components & actions                                                                          | `src/lib/components/` (`Sparkline.svelte`, `BarChart.svelte`, `MetricRow`, `BackLink`), `src/lib/actions/focus-trap.ts` |

The Playwright suite is the durable proof of each surface, and reading the relevant spec
is the fastest way to learn how one actually behaves:
`e2e/session-runner-walkthrough-a.spec.ts` and `-d.spec.ts` walk two full fixture
sessions; `e2e/offline-*.spec.ts` run against a real production build (see
`test:e2e` below); and `export-`,
`progress-`, `history-`, `revision-`, `admin-`, `archive-`, `versions-`,
`account-reset-`, `import-failures`, `symptom-guide`, `security-headers` and `quarantine`
each walk their own end to end.

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
verify` — a half-minute local check must never turn into a browser download. CI runs the suite in
  its own `e2e` job instead, on the same triggers as `check`, with the browser cached on
  the resolved Playwright version. `e2e/` is still
  typechecked, linted and formatted by `verify`; it is only never _executed_ by it.
  Narrow a run with `npx playwright test --project=offline e2e/offline-session.spec.ts`
  rather than paying for the production build four times over. The three viewport
  projects are named `small-android`, `iphone` and `tablet-portrait` (see
  `playwright.config.ts`) — not `phone` or `mobile`. A killed run leaves its server
  holding port 4319 or 4320, and the next run then dies with "port already in use"
  rather than a test failure; `ss -ltnp | grep -E '4319|4320'` names the pid
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
  which ones are allowed there. `GAIN_DEV_HOSTS=my-phone.home.arpa` also binds the dev
  server beyond localhost, which is how a session gets driven on a real phone
- `npm run lint` — ESLint
- `npm run format` / `npm run format:check` — Prettier. `docs/`, `fixtures/`,
  `templates/` and `design/` are byte-sensitive and excluded from formatting; never
  remove them from `.prettierignore`
- `npm run check:chars` — rejects literal control characters in tracked text files
- `npm run verify` — all of the above in CI's order, then `npm run build`. Around half a
  minute; `typecheck` and `svelte-check` are most of it.
  Run this before saying work is done rather than reasoning about whether it would pass.
  It short-circuits, so a lint failure means the tests never ran. The build is in there
  because typecheck and `svelte-check` do not exercise the adapter, the `?raw` asset
  imports or the Vite config — code that passes both and still cannot ship is a real
  failure mode, not a hypothetical one

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first, then
[`docs/CONTRACT.md`](docs/CONTRACT.md), before doing anything substantive. The twelve
design decisions in ARCHITECTURE §2 are settled, and each carries the reason it exists —
implement against them rather than relitigating them, and if you think one should change,
argue with its reason rather than around it. The same applies to
[`docs/UI-DECISIONS.md`](docs/UI-DECISIONS.md), which settles how the session runner
behaves; read it before touching anything user-facing.

Those three, plus this file and `README.md`, are the whole of the standing documentation.
There is no roadmap and no to-do list: see "Tracking work" below for why, and for what to
do when you create one.

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
contract validation, Vitest for tests. One image, one port, one volume. The core —
contract, parse, diff, export, storage — is plain TypeScript with no framework, and
doubles as the SvelteKit app's `$lib`: the app imports it directly, and its tests still
run without the framework.

Node version, package manager, lint/format and CI are settled in ARCHITECTURE §12,
"Toolchain, settled". Implement those choices; do not make them again.

**The dependencies here are on newer majors than you probably remember.** Zod 4, Svelte
5, TypeScript 6, ESLint 10, Vitest 4, Node 24 and better-sqlite3 13. Check `package.json`
rather than trusting either recall or this list — there is no update bot (ARCHITECTURE
§12), so the tree drifts between the day someone bumps it and the day you read this, and
this paragraph is a warning about the _shape_ of the trap rather than a version manifest.
Two of them bite. Zod: this repo uses `z.strictObject`,
`z.looseObject` and `error:`, and a model reaching for Zod 3 from memory writes
`z.object().strict()` and `message:` — then "fixes" correct code into broken code.
Svelte: every component is runes mode (`$state`, `$derived`, `$props`, `$effect`), and
there is not one `export let` or `createEventDispatcher` anywhere in `src/` — so a new
component written from memory is the likeliest place this bites. Check `package.json` and
the real API before changing schema or component code, rather than trusting recall. If a
docs lookup is available, use it.

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
so their prose is deliberate and should not be flattened into bullets when you edit them.
A working document you write to track a job in progress is a checklist and should read
like one. Match the document you are in.

### Tracking work, and folding it back in

**Write docs to track work in progress. When the work is done, fold what is durable into
the standing documents and delete the tracking doc.**

A plan, a design spec, a review, a to-do list — each is useful while work is open and
becomes drag the moment it closes, because the next reader cannot tell a live intention
from a finished one. This repository has already paid that cost once: a document that
confidently described four shipped screens as "still open" cost more than it ever saved.
Git history is the record of how something got built; the standing documents are the
record of what is true now. Those two jobs do not belong in one file.

While work is open, track it however helps — a scratch file under `docs/`, a plan, a
checklist. It is expected, not discouraged. Name it so it is obviously temporary.

When the work closes, in the same commit:

- **Fold the durable half in.** A reason that will govern the next change belongs beside
  the code it governs — a module doc comment is usually the best home, because it is the
  one place nobody can miss. Otherwise: ARCHITECTURE for a design decision or an accepted
  risk, UI-DECISIONS for runner behaviour, CONTRACT for the plan format, this file's
  Invariants for something that breaks quietly, README for what the app does or how it is
  run. Most findings have no durable half and need no home at all.
- **Delete the tracking doc.** No strikethrough, no "done" section, no archive directory.
  `git log` and `git show <sha>:<path>` recover anything that mattered.
- **Check the standing docs still describe the app**, not the app you started with.

The test for whether something belongs in a standing document: **would a reader who never
saw this work still need it?** "The `access()` check is the load-bearing half, because
SQLite reads through a file descriptor opened at startup and a `SELECT 1` therefore
survives a revoked directory" passes — it will stop someone weakening that check in a
year. "Item 3 is ticked, SHA `abc1234`" does not.

A finding that is _accepted rather than fixed_ is durable and does need a home, or the
next reader re-finds it and re-argues it. ARCHITECTURE §14 is where those go, with the
reason and the condition that would reopen them.

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

`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` closes the message when Claude
authored the commit — the model's name, then one angle-bracket group, which is the
address. That is a standard git/GitHub trailer, not part of Conventional Commits itself,
and git parses whatever is inside the _first_ `<…>` as the email: a second group, as in
`Claude <claude-opus-5> <noreply@anthropic.com>`, makes `claude-opus-5` the address and
the trailer silently stops registering a co-author at all. Substitute the model
(`Claude Sonnet 5`, …), never the brackets.

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

A plan document is a **skeleton** (a catalogue of every movement, then sessions → blocks
→ prescriptions, inside one fenced ` ```gain-plan ` YAML block) wrapped in **prose
context** (rationale, form cues, injury rules, progression philosophy). The fixture runs
~460 lines of block to ~320 of prose; the ratio is not a rule.

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

The one sanctioned way a slug changes is an accepted rename at the import review:
`importPlan`'s `renames` input (`src/lib/db/import-plan.ts`) updates the matching
`exercise_def` row in place — same id, new slug — so its history carries forward instead
of a second def being minted. `deviation.substitute_exercise_slug` is the one
denormalised copy of a slug in the schema, stored as loose text rather than reached
through `exercise_def_id`, so it is rewritten alongside the def in the same transaction
or it would go stale on its own.

Metric keys are the exception to "unique identifier": they are unique **within a scope**,
not across scopes, so a plan may legally declare `rpe` at both set and session scope.
Anything that indexes metric values — summaries, charts, CSV columns — must key on
`(scope, key)`. Keying on the bare key merges two unrelated series and reports a plausible
wrong number rather than failing.

### Isolation is physical, not a WHERE clause

Each user gets their own `gain.db` and their own directory under `/data/users/<id>/`.
There is no cross-user query because there is no cross-user database. Do not introduce a
shared table keyed by `user_id`. There is exactly one optional operator role
(`OIDC_ADMIN_GROUP`) and exactly one module it may read another user's database
from — `src/lib/server/admin-stats.ts`, which returns counts, dates and byte totals and
never a content row. Outside that module there is no code path by which one user reads
another's training data.

The one shared database is `control.db` — the OIDC `sub` → user id mapping and
server-side sessions — and it holds **no training data**, which is the line that actually
matters. It is not, however, free of personal data, and reasoning that assumes otherwise
is wrong: `control_user.display_label` holds whatever the IdP supplied
(`preferred_username`, else the **email address**, else `name` — `extractDisplayLabel`,
`src/lib/server/oidc.ts`), and every `session` row holds the IdP's access, refresh and ID
tokens in plain text. A refresh token is a live credential, so `control.db` is a
secret-bearing file: it is what the operator screen identifies accounts by, and it is
what the README's backup recipe copies onto the host.

### Offline is a hard requirement, not a nicety

Workout state lives client-side in IndexedDB and syncs when it can. All writes carry a
client-generated ULID and are idempotent server-side, so replaying the sync queue can
never duplicate a set. A workout must survive connection loss, phone lock, browser kill,
container restart, and an expired session — a 401 must never discard queued local data.

That idempotency is physical: every table the client writes to — `workout`, `set_log`,
`metric_value`, `deviation`, `activity` — carries a `client_id TEXT UNIQUE`, and any new
log table needs one. A log table without that column looks fine until the day a queue is
replayed, and then it silently doubles someone's history. `tests/db/log-tables.test.ts`
asserts this off `PRAGMA index_list` on a freshly-migrated database rather than off the
DDL text, so a table-level `UNIQUE(...)` or a separate unique index counts too — it is
the property being asserted, not the spelling. It also scans `src/lib/db/workout.ts` for
`INSERT INTO` targets, because that is the module every sync op is written through: a
sixth log table cannot join the replay without failing that test. Idempotency itself is
achieved in application code (`selectByClientId`-then-insert), so without those
assertions the constraint was documentation — every idempotency test still passed with
it dropped.

**A quarantined op is held, never dropped, and never retried forever.** An op that can
never succeed — an `exerciseSlug` a plan revision removed, a payload that fails its schema
— is retained, marked failed, and surfaced in the UI rather than discarded or retried
indefinitely against the ops behind it. This is the one place "hold everything" and "never
lose anything" conflict, and it resolves in favour of keeping the data and telling the
user. An invisible quarantined op — one the banner does not surface — is
exactly the data loss the offline write layer exists to prevent, just moved one step
later.

The hard case is a rejection that names **no** op — a 413, which the server answers before
reading the body, or a 400 from a batch that fails `syncBatchSchema` whole. Neither can
carry a `failed[]` entry, so neither reaches `applyAck`, and retrying rebuilds an
identical batch to be refused identically forever. `resolvePermanentFailure`
(`$lib/sync/queue.ts`) halves the batch instead, and quarantines the single op left once
halving has converged on it — which op is at fault is knowable only to the server, and in
both these cases the server refused before it could say. Any new status the flush loop
learns to receive has to be classified as retryable or permanent; routing a permanent one
into `scheduleRetry` is the failure this rule exists to prevent.

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
  There is one window this does not close, and it is accepted rather than fixed: if the
  `renameSync` itself fails after the commit — a full disk, a permissions change — the
  `plan_version` row is already written and names a `source_path` that does not exist.
  That direction is deliberately survivable rather than prevented: `readSourceMd` is a
  bare `readFileSync` whose failure renders an explanation naming the path rather than a
  500, so the version browses as "the document is missing" instead of crashing, and no
  logged history is lost. The transaction-throws direction is the one that is genuinely
  all-or-nothing, and `tests/db/import.test.ts` proves it with an `ABORT` trigger.
- **`docs/CONTRACT.md` is shipped output, not internal documentation.** It is reproduced
  verbatim in **both** outbound templates — Section 4 of every export and Section 2 of the
  bootstrap prompt — so editing it changes the instructions every AI receives, whether it
  is authoring a first plan or revising one. `templates/bootstrap-prompt.md` and
  `templates/default-ai-instructions.md` are shipped output on the same terms: editing
  either changes the instructions every AI receives, they are versioned with the app
  rather than per user, and nothing may reintroduce a per-user copy of either.
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
  number in the offline write path it can never reach the export or the reviewing AI.
- **`weight_kg` is always the total kilograms being lifted**, everywhere — the log, the
  charts, the export. Settled 2026-08-10: the contract has no field meaning "this movement
  is paired", `per_side` is not that field, and adding one was rejected because
  `docs/CONTRACT.md` ships verbatim in every export and bootstrap prompt. So UI-DECISIONS
  §3's `2 × N` sub-line is the one clause of that document _deliberately_ left unbuilt —
  §5's symptom triad, once also unbuilt through drift rather than decision, is now built
  (see below).
  Do not implement it, do not add a `paired` field, and do not infer pairing from a slug
  or a load label. The full reasoning, including the one honest consequence it leaves
  behind, is in UI-DECISIONS §3.
- **There is one completion mark in the runner, and it is not a colour.** A tick in the
  accent hue beside a finished exercise, a checked-off warm-up pill and a completed block
  heading — the same mark in all three, because a screen that says "done" two different
  ways makes the user learn two vocabularies for one idea. Settled 2026-08-15; the
  reasoning, including why the pills do not reserve space and why a rounds block asks its
  round counter rather than its exercises, is in UI-DECISIONS §1. **Inside the ordinary
  flow of the runner — logging sets, resting, the ledger — there is no colour but the
  accent** — do not add a green success state there, and do not traffic-light progress;
  the runner is read one-handed at arm's length, and every extra hue competes with
  whatever matters most. Outside the runner, `--red` and `--amber` carry their ordinary
  meanings (a blocking error, a destructive action, a warning) in the admin screen, the
  export screen, the sync banner, `/account` and the import review, and using them there
  is correct rather than an exception. Settled 2026-08-28: the plan's own pain-response
  framework (`safety.symptom_framework`) is now rendered —
  `$lib/session/symptom-guide.ts` plus a header-reachable sheet
  (`session/[key]/SymptomGuideSheet.svelte`) and an inline quote on the deviation sheet's
  `stop_red_flag` choice — and it is the one exception to the accent-only rule, because it
  _is_ the framework the rule was reserving colour for, not a second system competing with
  it. `--green` has its first call sites there. UI-DECISIONS §5 has the full account.
- **The post-session celebration is a moment, never a step, and is the one full-screen
  exception to the runner's accent-only rule.** It renders after the finish op is already written and the
  workout's local key already cleared, so dismissing it — or never dismissing it — cannot
  change what reaches the export; a red-flag stop skips it entirely. Its confetti is
  accent/gold/silver, a deliberate, narrow exception to §5's green/amber/red symptom
  triad, confined to this one full-screen moment. Both endings leave through one
  `goto(resolve("/", {}), { replaceState: true })`, never a location assignment:
  replacing takes the finished session off the history stack, so Back cannot restore the
  page from bfcache with the celebration still showing, and a client-side navigation
  keeps `$lib/sync/client.svelte.ts`'s in-flight flush alive across the trip rather than
  tearing it down at the one moment the queue is fullest. Full reasoning in
  UI-DECISIONS §8, "Settled 2026-08-15".
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
- **The sync banner is gated on time, and nothing else may report sync state in flow.**
  It renders above `<main>`, so mounting one reflows the page — and a healthy online write
  goes idle → pending → syncing → idle in about a tenth of a second, which used to raise
  and drop two banners under the user's thumb mid-set. `$lib/sync/banner-gate.ts` holds
  the rule — say nothing until a message has held long enough to be worth saying, and once
  said leave it up long enough to be read — while the durations themselves are the gate's
  options, set once at its only call site in `src/routes/+layout.svelte` (700ms to appear,
  1.5s minimum visible). The consequence is deliberate — a healthy sync is now _silent_,
  because there is nothing the user can do about it, and "Syncing…" only ever appears when
  syncing is genuinely slow. A component that reads `syncStatus.state` directly to render its own
  spinner or badge reintroduces the flicker one screen at a time; route sync feedback
  through the banner, or through the gate.
- **The operator sees counts, never content — and the reset's order is load-bearing.**
  `OIDC_ADMIN_GROUP` grants a `/admin` screen (ARCHITECTURE §4) whose every cross-user
  read goes through `src/lib/server/admin-stats.ts`, which returns only `COUNT(*)`,
  `MAX(...)` and byte totals. Nothing else in the app may open another user's `gain.db`;
  putting a second such reader anywhere else dissolves the guarantee, because it is the
  single module boundary — not a rule — that keeps it true. That boundary is now
  enforced rather than described: `eslint.config.js` restricts the _value_ import of
  `better-sqlite3` to the only three files that may construct one — `control-db.ts`,
  `user-db.ts` and `admin-stats.ts` — with `allowTypeImports`, so `Database.Statement`
  as a type stays free. Reach a user's database through `getUserDbFor()`; if you find
  yourself adding a fourth entry to that ignore list, that is the guarantee dissolving
  and the reason to stop, not a lint rule to widen. The reset in
  `src/lib/server/admin-reset.ts` closes and evicts the cached handle **before** the
  unlink: `better-sqlite3` holds the file open, so unlinking first leaves the process
  writing to a deleted inode and the reset silently does nothing. It also bumps
  `control_user.data_generation`, which is what stops the wiped user's offline outbox
  flushing back in and quarantining forever — the one place GAIN deliberately discards
  local data, and narrow by construction: only on the server's explicit 409.
- **The Content-Security-Policy comes from `kit.csp`, and the other headers from
  `hooks.server.ts` — never both from one place.** Settled 2026-08-28 (ARCHITECTURE §3,
  "Security headers"). SvelteKit alone knows the nonce it stamped into the page's own
  hydration script, and a browser _intersects_ two CSP headers, so a second static policy
  set in the hook would block exactly the scripts the app needs. The hook sets the four
  static headers plus a `default-src 'none'` CSP for the responses SvelteKit renders no
  page for. The consequence for anything user-facing: **no inline `<script>` and no
  inline `<style>` element** — the policy is `script-src 'self' 'nonce-…'` and
  `style-src 'self'`. `style-src-attr 'unsafe-inline'` is allowed and load-bearing, since
  Svelte's `style:` directives compile to inline style attributes; do not widen it to
  `style-src`. Static assets carry no headers at all, because adapter-node serves them
  ahead of any hook — accepted, documented, and not worth a custom server to fix. And
  settled 2026-08-28: **`handle` must return its refusals, never throw them.** SvelteKit
  builds the response for an `HttpError` or a `Redirect` thrown out of `handle` itself,
  outside the hook, so a thrown 401/403/303 ships with none of these headers —
  `$lib/server/gate.ts`'s `refusal` and `seeOther` exist so the gate's own responses go
  out through `withSecurityHeaders` like every other one.
- **Archiving a plan closes the session runner and leaves every read route open.**
  Settled 2026-08-23. `export`, `history` and `progress` all 404'd on `archived_at` before
  the feature landed, so a button shipped against those guards would have made archiving a
  silent, unrecoverable loss of the user's own logged history. The asymmetry is the
  feature: the plan leaves the active list into a collapsed Archived group, its history
  still opens from there, unarchiving restores it in place, and only the runner refuses.
  `tests/db/archive.test.ts` and `e2e/archive-walkthrough.spec.ts` hold both halves. A new
  per-plan route has to decide which half it is on, and a read route defaults to open.
- **There is no export archive.** `users/<id>/exports/` existed briefly (settled
  2026-08-28, capped at 20 files per plan) and was removed 2026-08-30 (review
  2026-08-27, A6/C2): nothing ever listed, read or deleted an archived file — the only
  reader was `admin-stats.ts`'s `directorySize`, counting its bytes into the operator's
  disk total — and the export screen never told the user the copy existed. It was
  write-only storage against a promise nobody made. `buildExportBundle`
  (`src/routes/plan/[slug]/export/bundle-for-plan.ts`) now only assembles the bundle and
  returns it; the clipboard and the download fallback are the user's only two copies, and
  a lost paste is regenerable from the same plan and window rather than recoverable from
  disk.

## The fixture

[`fixtures/plans/home-training-v1.md`](fixtures/plans/home-training-v1.md) is
the spine of the test suite — a fictionalised, current-generation plan (authored
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

## How this is built

**The pure core came first, and everything else is layered on it.** Parsing, diffing,
progression logic and export generation are pure functions over plain data — no I/O, and
the clock is injected so they stay deterministic. The database layer keeps the same rule
where it can: provisioning and import take an injected `now`. The golden round-trip test
predates the UI and is still the first thing to run when anything near parse, storage or
export changes: if the round-trip is not provably lossless, everything on top of it is
built on sand.

**SvelteKit is scaffolded at the repo root, not beside it.** `$lib` maps onto the existing
`src/lib`, so the app imports the pure core unchanged and the core's tests still run
without the framework. `source_md` lives on disk at `plans/<plan.slug>/v<N>.md`; the
database stores the path, never a second copy of the document.

**Routes are thin; the logic they need is a tested `$lib` module.** The session runner is
the clearest case — resolution, pre-fill, the rest timer and resume reconstruction all
live in `src/lib/session/` and are unit-tested without SvelteKit. `src/lib/server/` holds
the same line: config loading, `control.db`, the OIDC module and the cookie signing are
injectable and unit-tested without a live IdP, with real signed JWTs in the tests. The
dev bypass (`GAIN_DEV_USER`) exists so the UI can be driven without an Authentik to point
at, and a deployed instance refuses to start with it set.

There are no component tests and no DOM tooling; `vitest.config.ts` sets
`environment: "node"`. That is a deliberate consequence of the rule above rather than a
gap — logic worth testing gets moved into `$lib` instead, which is cheaper than
introducing jsdom and keeps the pressure on components to stay thin. `focus-trap.ts` is
the pattern: the pure `nextTrapFocusTarget` is split out and unit-tested, and the action
around it is the part Playwright covers.

## Rules learned the hard way

Each of these cost real debugging once. They are here so they cost it once.

### Framework and UI

**Every form gets `use:enhance`.** Without it a form action is a full navigation, the
component remounts, and component state is gone. The first-run paste box lost the user's
pasted plan on every failed import that way — the error was displayed above an empty box,
which is precisely the wall UI-DECISIONS §11 says a failed import must not be. Server
actions echo `source` back as well, so the no-JS path also refills.

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
belong next to the control that failed, legible at arm's length.

**A `$state` initializer at the page level runs once, ever — a component-level one reruns
every time the component remounts.** `+page.svelte` never remounts across a same-route
`use:enhance` response; SvelteKit's `applyAction` only updates its `form` prop
(`$set({form: null})` then `$set({form: result.data})`), so a page-level
`$state(seedFromForm(form))` initializer only ever sees the `form` that was live on first
render and silently ignores every response after that. Derive per-response UI state inside
the component that owns the conditional rendering — one that lives inside an `{#if}`
genuinely does remount, and its initializer genuinely does rerun.

**A contract range is a tuple, so it must be formatted, not interpolated.** `[8, 12]`
stringifies to `8,12`. It escaped review once because it is not an exception — it is
nearly every prescription in the fixture rendering as a typo.

**Everything in the runner keys on `block:slug`**, because one movement can be prescribed
in two blocks of one session. A lookup that searches `blocks.flatMap(b => b.exercises)`
finds the wrong block's overrides. Note the consequence in ARCHITECTURE §5 and §9: log
rows carry no `block_key`, so resuming a workout has to match rows back onto occurrences.

**Client state is what was submitted, never what was pre-filled.** The ledger once
rendered from the pre-fill map, so it showed the numbers the user was offered rather than
the ones they logged.

**Recording an intent is not honouring it.** A skip that writes a `deviation` row and
leaves the exercise loggable, or a swap that keeps posting the original slug, produces an
export stating the user did the movement the plan told them to avoid. Nothing errors, and
the wrong claim reaches the next revision. Every state-changing action must change the
state it names.

### Server, auth and sync

**An unevaluable check is not a failed check.** The group gate is re-checked on every
token refresh (ARCHITECTURE §4), and the first implementation treated "GAIN could not
establish membership" the same as "the IdP says no" — so an IdP that omits `id_token` from
a refresh response, plus one blip at the userinfo endpoint, evicted a legitimate user
mid-session. `fetchUserinfoGroups` returns `null` for "could not tell", distinct from
`[]`, and the mid-session re-check keeps the session on `null` while a login still denies.
Same rule at the token endpoint: unreachable keeps the session, an explicit rejection ends
it. Expect this distinction anywhere a remote answer gates access.

**An expired session must not turn a POST into a GET.** The gate redirects navigations to
`/login` and answers everything else with 401 (`src/lib/server/gate.ts`). A 303 replays a
POST as a GET and discards the body — survivable for a form, fatal for the sync queue,
which §4 requires to keep its data across a 401.

**`ORIGIN` is the signal that an instance is deployed — never `NODE_ENV`.** `node build`
does not set `NODE_ENV` and neither does adapter-node, so a guard keyed on it fires only
inside the container and a production bundle served directly ran with the auth bypass
active _while logging that production builds refuse it_. `ORIGIN` is the one variable a
published instance cannot avoid setting correctly, since SvelteKit checks form posts
against it and it forms the OIDC redirect URI. An unparseable `ORIGIN` counts as
non-loopback: guessing permissively is how an unauthenticated server ships. Note that "is
OIDC configured" cannot be the signal either — the bypass is only ever _selected_ when
OIDC is absent, so keying on it would be vacuous.

**A health check must exercise the dependency, and the obvious query does not.** A static
`ok` exercises nothing: `isPublicPath` short-circuits before any database access, so a
container whose storage had failed answered 200 while every new user's page 500'd. The
non-obvious half is that `SELECT 1` against `control.db` does not catch it either —
SQLite reads through a file descriptor opened at startup, so revoking the data
directory's permissions leaves the query succeeding. `access(R_OK | W_OK)` on the
directory is the load-bearing check; the query is the second line, for a corrupted or
closed handle. See `src/routes/healthz/+server.ts`.

**Module-level reactive state needs an explicit way back out of every state it can
enter.** `client.svelte.ts`'s flush loop set a `needs-auth` state on a 401 and nothing
ever cleared it — re-authentication is a same-origin SPA navigation, which does not reset
module state, so a queue that hit one 401 stayed stuck forever even after the user signed
back in. The fix folded `needs-auth` into the same retry/backoff path as every other
failure (`scheduleRetry`, guarded on whether a retry is pending rather than on the state
value) instead of giving it a terminal branch of its own.

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

**A precache lookup must match how the app actually requests the resource, not how it was
stored.** `precacheSessions` stores a route's `__data.json` at its bare URL; SvelteKit's
own client router appends `?x-sveltekit-invalidated=...` to every data fetch, so an exact
`cache.match` never hit — and the miss looked like the whole precache had failed rather
than like a query-string mismatch. Scope `ignoreSearch` narrowly (here, to `__data.json`
paths) rather than globally, or an unrelated cached route starts serving stale content on
any query string at all.

**A public-path allowlist must include every asset the install step touches, or the first
load loops.** `/offline` was left off `isPublicPath`, and `cache.addAll` is all-or-nothing
— a single 401 from a gated `/offline` fetch failed the entire service-worker install,
silently, on the very first page load, since installation happens before the user has
authenticated at all.

### Data and identity

**A rename must be applied before the upsert it precedes, never after.** `importPlan`'s
transaction runs `applyRenames` immediately before `upsertExerciseDefs`, and that ordering
is load-bearing rather than incidental: `upsertExerciseDefs` inserts a fresh
`exercise_def` row for every slug the new contract declares, including the renamed-to
slug, so running it first would mint that row before `applyRenames` had a matching old row
left to repoint — the rename would find nothing to update, and the history would split
exactly the way the feature exists to prevent. Any future write path that both mutates
`exercise_def` identity and inserts new rows for the same contract needs to reason about
this ordering explicitly: atomicity guarantees the two happen together, not that either
order is safe.

**A presented diff should be rebuilt from the engine's structured fields, not filtered
from its warning strings.** `presentDiff` (`src/lib/diff/present.ts`) derives the review
screen's warnings from `diff.exercises.unreferenced`, `diff.metrics.removed` and a
recomputed `based_on_version` check, and deliberately does not pass `diff.warnings`
through and strip the ones the dispositions already cover by matching a prefix.
`diff.warnings` is prose meant for a changelog, not a stable API — a future reword would
silently break a prefix filter with no type error and no failing test, until a warning
either duplicated a disposition or vanished from the screen.

**`exerciseOccurrences` only enumerates directly-prescribed pairs, and a mid-session swap
is invisible to it.** `src/lib/progress/exercise-series.ts`'s `exerciseOccurrences` walks
`contract.sessions` and each session's resolved blocks looking for a `(session, exercise)`
pairing the plan itself prescribes; it never looks at `logs.set_logs`, so an exercise a
user swapped in mid-session — never prescribed, only logged — has no occurrence to attach
its sets to. Its sets stay visible in the raw CSV export and the Deviations row, but not
on the Progress exercises list or the export's per-exercise summary table. This is a real,
accepted gap rather than a defect. Fixing it needs its own design decision (what resolved
prescription or range does a substitute-only occurrence carry? nothing today specifies
one) and its own tests; anyone extending per-exercise progress or summary views on
`exerciseOccurrences` should know it exists before building on it.

### Tests and tooling

**An assertion on a chart or summary component must prove the data path fired, not that
the shell rendered.** `Sparkline.svelte` renders its `<svg aria-label>` in both the
populated and the empty branch — only the inner content swaps — so a progress assertion
passed even though the workout it logged was never finished and the duration series never
got a point to plot. Every chart in the app renders its container unconditionally, so
assert on `.dot`, `rect`, or whatever only exists with data. The same trap has a wider
form: `.log-strip` and `.exercise-status` also render unconditionally, and
`expect(page.locator(".log-strip")).toBeVisible()` is used as the "runner is ready" signal
in several specs — it would pass on a fully-logged, un-loggable strip.

**Layout is verified in a browser at 360 px.** The runner's worst bug was a grid that
could not shrink, and nothing in `verify` could ever have seen it. `npm run test:e2e`
asserts no horizontal overflow at three viewports; see UI-DECISIONS §12, which states
precisely what is and is not covered rather than claiming the whole surface.

**A whole-file regex is how a space-significant string gets broken silently.** A tidy-up
pass that collapsed whitespace before punctuation across whole files turned CSS
descendant selectors into compound ones (`.log-strip .strip-set` →
`.log-strip.strip-set`), rewrote Playwright locators the same way, and relabelled a
button `Download.md`. `npm run verify` passed clean — typecheck, `svelte-check`, ESLint,
every unit test and the build all read those as identical — and only `test:e2e` failed.
Scope a bulk edit to the lines it is meant to change rather than to the file, and when
one has run wide anyway, diff for lost whitespace before trusting a green `verify`.

**A generated tsconfig's exclusions are silent.** SvelteKit's own generated
`.svelte-kit/tsconfig.json` excludes `src/service-worker.ts` (it needs the WebWorker lib,
which conflicts with the app's DOM lib), so the file passed `npm run typecheck` while
never actually being typechecked — confirmed by deliberately injecting a type error and
watching `tsc` stay green. A file excluded from the project it appears to belong to needs
its own project (`tsconfig.worker.json`) or it is unverified, not verified-and-clean.

**CI builds the image on every change**, smoke-tests that it boots, answers `/healthz` and
runs as non-root, and only pushes it on a tag. A Dockerfile that stopped working should
fail the PR that broke it, not the release that needed it. The smoke test has to pass the
same environment a real deployment would — an `http://` `ORIGIN` or a short
`SESSION_SECRET` is refused by the app's own startup checks, so a smoke test using either
tests nothing and fails at the worst moment.

## Non-goals

Do not build, and do not propose: in-app AI or chat; an exercise library with demo
videos; social or sharing features; nutrition tracking beyond plan-declared metrics;
wearable, Health/Fit or Strava integration; a native mobile app; or a calendar with
planned-schedule adherence.
