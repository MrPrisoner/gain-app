# GAIN — High-Level Architecture

A self-hosted web app for running and tracking AI-authored exercise plans.

**Status:** design agreed; phases 1–5 implemented (pure round-trip core, storage layer,
auth + container + first run, session runner, export UI).
**Audience:** the AI agents that will build this, and the human reviewing their work.

---

## 1. The core idea

The plan is authored by an AI in a chat somewhere else, arrives as a markdown
file, and must eventually go back to an AI with progress data attached so it can be
revised. GAIN sits in the middle of that loop:

```
   ┌──────────────────────── the loop ────────────────────────┐
   │                                                          │
   AI chat  ──md──►  GAIN import  ──►  train & log  ──►  GAIN export ──md──►  AI chat
   (external)         (structured)      (offline PWA)     (bundle)         (external)
```

GAIN never talks to an AI itself. It is the structured, offline-capable middle of a
copy-paste loop, and the quality of the whole system rests on one thing: **the
markdown that leaves GAIN must be able to come back in without losing identity.**

### The loop is the product

**This diagram is not a summary of the app. It is the app.** Everything else — the
session runner, the charts, the offline queue — exists to make one round of this loop
worth completing. If moving between GAIN and an AI is awkward, the loop stops turning,
and a plan that is never revised is just a note-taking app with extra steps.

So every crossing of that boundary is a first-class piece of design, not plumbing:

| Crossing | Must feel like |
|---|---|
| **GAIN → AI**, first plan | One button, one paste. GAIN produces the whole prompt; the user never assembles it |
| **AI → GAIN**, import | Paste, see a plain-language diff, commit. No file wrangling, no format knowledge |
| **GAIN → AI**, revision | One button, one paste. Everything the AI needs, in one document |
| **AI → GAIN**, re-import | The same paste-and-review as the first time |

Concrete obligations that follow, all of them testable:

- **Nothing the user must assemble by hand.** Every outbound artifact is complete and
  copy-ready in one action — including the contract spec, which the AI needs and the user
  should never have to think about.
- **No format knowledge required.** A user who has never read `CONTRACT.md` must be able
  to complete a full round. The spec travels inside the documents.
- **Errors are part of the loop, not a dead end.** When an AI emits an invalid plan, the
  error must be written so the *AI* can act on it — field path, expected, found — and be
  copy-pasteable in one tap. The user's recovery is to paste the error back into the chat,
  not to hand-edit YAML.
- **Paste is the primary transport.** File upload is a convenience. Assume a phone,
  a chat window in another tab, and no filesystem.
- **One document per crossing.** Never "copy this, then also copy that."

### The central tension

A plan document is two things at once:

| | Purpose | Consumer | Size |
|---|---|---|---|
| **Skeleton** | A catalogue of movements, then sessions → blocks → prescriptions, with stable IDs | The session-runner UI | ~350 lines |
| **Context** | Rationale, form cues, pain rules, progression philosophy, exclusions | The AI, on the next revision | ~500 lines |

The reference plan is ~900 lines. Almost none of the context is needed to render
"exercise 3 of 8 — log your reps". All of it is needed when you ask an AI to write
block 2.

The two never restate each other. Prescriptions live only in the skeleton, reasoning only
in the context — otherwise a revision has to update both and one of them will drift.

**Therefore both are first-class and both round-trip.** The skeleton is parsed into
SQLite and drives the app. The context is stored verbatim, byte-for-byte, and is
replayed into the export untouched. GAIN never paraphrases, summarises or regenerates
the context — anything it cannot parse, it preserves.

---

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Plan structuring | Contract block (fenced YAML) emitted by the AI + review/diff editor before commit |
| 2 | AI integration | None in-app. Export/import only |
| 3 | Authentication | OIDC client against Authentik |
| 4 | Access control | Gated on an Authentik group, auto-provision on first login, no admin role |
| 5 | Storage | One SQLite DB **per user**, plus a per-user file directory. DB is source of truth |
| 6 | Client | Installable PWA, offline-capable sessions with sync |
| 7 | Log schema | Fixed core (reps/weight/duration/difficulty) + plan-declared custom metrics |
| 8 | Scheduling | Suggested-next-session, no calendar; one-tap logging of activity outside the plan |
| 9 | Stack | TypeScript + SvelteKit, single Node container, `better-sqlite3` |
| 10 | Versioning | Immutable plan versions, diff review at import, logs bound to their version |
| 11 | Export | One self-contained `.md` bundle, windowed by default |
| 12 | Deviation | Skip / substitute / add sets mid-session, with structured reasons |

---

## 3. Deployment

One image, one container, one port, one volume. Deployed as a Portainer stack.

```yaml
services:
  gain:
    image: ghcr.io/<owner>/gain:latest
    restart: unless-stopped
    ports:
      - "${GAIN_PORT:-8420}:3000"        # reverse proxy terminates TLS and forwards here
    volumes:
      - gain-data:/data
    environment:
      ORIGIN: https://gain.example.com   # required by SvelteKit for CSRF + OIDC redirect
      OIDC_ISSUER: https://auth.example.com/application/o/gain/
      OIDC_CLIENT_ID: ${OIDC_CLIENT_ID}
      OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET}
      OIDC_REQUIRED_GROUP: gain-users
      SESSION_SECRET: ${SESSION_SECRET}
      DATA_DIR: /data
      TZ: Africa/Johannesburg
volumes:
  gain-data:
```

Notes:

- The container listens on a fixed internal `3000`; the host port is the knob. This
  keeps `ORIGIN` and the OIDC redirect URI stable regardless of the published port.
- `ORIGIN` must be the public HTTPS URL. Getting this wrong is the #1 cause of
  "login loops forever" behind a reverse proxy — SvelteKit rejects form POSTs whose
  `Origin` doesn't match.
- Trust `X-Forwarded-*` only from the proxy. Set `ADDRESS_HEADER=X-Forwarded-For`
  and `XFF_DEPTH` to match your proxy depth.
- Health endpoint at `/healthz` (no auth) for Portainer/uptime checks.
- Everything mutable lives under `/data`. A single volume snapshot is a complete backup.

### Data directory layout

```
/data/
  control.db                     # users, oidc subject → user id, sessions, nothing personal
  users/
    <user_id>/
      gain.db                    # ALL of this user's training data
      plans/
        <plan_slug>/             # plan.slug is stable across versions (§5 contract rule 5)
          v1.md                  # verbatim original import, never modified
          v2.md
      exports/
        2026-09-01-block-1.md    # generated bundles, retained for reference
```

Per-user physical isolation is the point: no cross-user query can exist because there
is no cross-user database. Deleting a user is `rm -rf users/<id>` plus one row.

---

## 4. Authentication & identity

Standard OIDC authorization-code flow with PKCE against an Authentik OAuth2/OpenID
provider.

- **Scopes:** `openid profile email groups`.
- **Gate:** the `groups` claim must contain `OIDC_REQUIRED_GROUP`, else 403 with a
  human explanation. Re-checked on every token refresh, not just first login.
- **Identity key:** the `sub` claim, never email. Emails change; `sub` doesn't.
- **Provisioning:** first successful login creates the user row, the DB file and the
  directory, then seeds the default AI-instruction template.
- **Session:** an httpOnly, `Secure`, `SameSite=Lax` cookie holding an opaque session
  ID; server-side session records live in `control.db`. No JWT in the cookie.
- **Logout:** clear the local session, then redirect to Authentik's end-session
  endpoint so it's a real logout, not a re-login-in-one-click.
- **Offline reality:** the PWA must work with an expired session. Requests that 401
  do not destroy queued local data — the sync queue holds, and the UI shows a
  "reconnect to sync" state. Losing a workout to a token expiry is unacceptable.

There is no admin role and no user-management UI. Access is administered entirely in
Authentik. No user can read another user's data through any code path.

---

## 5. Domain model

Per-user `gain.db`. IDs are ULIDs. The DDL in `src/lib/db/schema.ts` is the
specification (schema-first, §12); the tables below summarise it.

```
plan                 id, slug (UNIQUE), name, created_at, archived_at
plan_version         id, plan_id, version_no, based_on_version,
                          source_path, context_md, contract_json,
                          changelog_json, block_length_weeks, session_target_min,
                          scheduling_json, progression_json, safety_json,
                          imported_at, is_current
exercise_def         id, plan_id, slug (STABLE ACROSS VERSIONS), name,
                          first_seen_version, last_seen_version
version_exercise     plan_version_id, exercise_def_id, name, type, per_side,
                          load_ref, rest_min_s, rest_max_s, note,
                          conditional, condition_text, substitutes_json
version_session      plan_version_id, key, name, order_no, note
version_block        plan_version_id, session_key, key, name, type, rounds,
                          rest_min_s, rest_max_s, tracking, note, order_no
prescription         id, plan_version_id, session_key, block_key, exercise_def_id,
                          order_no, sets_min, sets_max, reps_min, reps_max,
                          duration_min_s, duration_max_s, load_ref,
                          rest_min_s, rest_max_s, note,
                          conditional, condition_text, substitutes_json
load_config          plan_version_id, ref, label, default_kg, is_bodyweight, note
metric_def           plan_version_id, scope (set|exercise|session),
                          key, label, type, min, max, options_json, prompt_when, optional

workout              id, plan_version_id, session_key, started_at,
                          completed_at, status, note, client_id (idempotency)
set_log              id, workout_id, exercise_def_id, set_no, side,
                          reps, weight_kg, duration_s, difficulty, client_id
metric_value         id, scope (set|exercise|session), set_log_id, workout_id,
                          exercise_def_id, metric_key, value_num, value_text
deviation            id, workout_id, exercise_def_id, kind (skip|substitute|
                          add_set|drop_set|stop_red_flag), reason_code, note,
                          substitute_exercise_slug, client_id
activity             id, kind (free-form slug, user's own vocabulary),
                          occurred_at, duration_min, intensity, note, client_id
ai_template          id, name, body_md, is_default, updated_at
```

The model is split along the same line as the contract: **identity is plan-scoped,
structure is version-scoped, and logs bind to the version they were recorded under.**

- **The catalogue split.** `exercise_def` carries what must survive a revision — one
  row per movement per plan, keyed by the slug that charts join on.
  `version_exercise` carries what a revision may change — the movement's properties
  as of that version. Three prescriptions of one movement can no longer disagree
  about what the movement is: they reference one catalogue row.
- **Sessions and blocks are tables.** Session `name`/`note`/`order` and block
  `name`/`note`/`tracking`/`type`/`rounds`/`rest_sec` all have homes.
- **Ranges are min/max column pairs** — including `sets`.
- **Notes exist at both levels.** A NULL `prescription.note` means the catalogue
  note applies; the same NULL-means-inherit convention covers prescription-level
  `conditional`/`condition_text`/`substitutes_json` overrides.
- **`source_md` lives on disk, not in the DB.** `plan_version.source_path` points at
  `plans/<plan.slug>/v<N>.md` (§3), written verbatim at import and copied from there
  as Section 1 of every export (§11). The DB keeps `context_md` and `contract_json`
  for diffing and never a second copy of the document.
- **`scheduling`/`progression`/`safety` are JSON columns on `plan_version`.** GAIN
  surfaces them but does not act on them, except `scheduling.sequence`, which drives
  the suggested next session.
- **`workout` has no "in progress" state.** `status` is `completed | partial | stopped`.
  A workout row is created the moment a session starts, as `partial` with a NULL
  `completed_at` — true until proven otherwise — and updated when the user finishes or
  red-flag-stops. In-progress is the absence of `completed_at`, not a fourth status, so a
  session abandoned mid-way is already recorded honestly without anything having to
  reconcile it later.
- **A log row records what was performed, not where in the session.** `set_log` and
  `deviation` key on `exercise_def_id` and carry no `block_key`. The runner, which must
  distinguish two occurrences of one movement in one session, keys its own state on
  `block:slug` — so resuming a workout means matching persisted rows back onto
  occurrences rather than reading the occurrence off the row (§9, "Resuming"). Adding a
  `block_key` column would remove the ambiguity, and is a schema-plus-CONTRACT change
  nobody has yet needed enough.

### Why `exercise_def.slug` is load-bearing

Progress charts, double-progression logic and the AI's own trend analysis all join on
`exercise_def_id`. That ID is resolved from the `slug` in the contract block. If a
revised plan comes back with `goblet-squat` renamed to `goblet_squat` or
`db-goblet-squat`, every chart silently splits in two.

Three defences, in order:

1. The export instructions tell the AI, emphatically, to preserve `id` values.
2. Import compares slugs against `exercise_def` and flags any unmatched slug as a
   **potential rename** in the diff review, offering to map it onto an existing
   exercise.
3. Slugs are never auto-created silently for an exercise whose name closely matches an
   existing one — that always surfaces for confirmation.

### Exercise types the model must handle on day one

Drawn directly from the reference plan, all of which appear in a single session:

- **Rep-based with load** — `3 × 8–12`, heavy config (goblet squat)
- **Rep-based, per side** — `3 × 10–12/side` (supported one-arm row)
- **Time-based, per side** — `2 × 20–40 sec/side` (side plank)
- **Bodyweight, progressing to loaded** — glute bridge
- **Conditional** — reverse crunch, "omit if it reproduces symptoms", with named
  substitutes
- **Rounds/circuit** — Session D's two-round abdominal finisher
- **Ranged rest** — `75–90 sec`

A model that only does `sets × reps × weight` will not survive first contact with this
plan. Build all seven now.

---

## 6. The plan contract

The single most important interface in the system. The AI emits one fenced block with
the info string `gain-plan`; everything outside it is context prose.

````markdown
```gain-plan
schema_version: 1

plan:
  slug: home-dumbbell
  name: 4-Week Home Dumbbell Training Plan
  version: 2
  based_on_version: 1
  block_length_weeks: 4
  changelog:
    - "Goblet squat 3×8–12 → 3×10–15 (top of range achieved wk3–4)"
    - "Introduced loaded glute bridge at 4 kg"

loads:
  - ref: heavy      
    label: Heavy configuration
    default_kg: 6
  - ref: light      
    label: Light configuration
    default_kg: 4
  - ref: bodyweight 
    is_bodyweight: true

metrics:
  exercise:
    - key: rir
      label: RIR
      type: number
      min: 0
      max: 5
      optional: true
    - key: technique
      label: Technique quality
      type: enum
      options: [Good, Acceptable, Poor]
  session:
    - key: energy_before
      label: Energy before
      type: scale
      min: 1
      max: 10
      prompt_when: start
    - key: squash_since_last
      label: Squash sessions since previous workout
      type: number
      prompt_when: start
    - key: symptoms_during
      label: Hip/back symptoms during
      type: scale
      min: 0
      max: 10
      prompt_when: end
    - key: symptoms_next_morning
      label: Next-morning symptoms
      type: scale
      min: 0
      max: 10
      prompt_when: next_morning

exercises:                                  # the catalogue — each movement declared once
  - {id: march-in-place, type: time, load: bodyweight}
  - {id: goblet-squat, load: heavy, rest_sec: [75, 90]}
  - {id: side-plank, type: time, per_side: true, load: bodyweight}
  - {id: dead-bug, per_side: true, load: bodyweight}      # declared, though only
  - {id: front-plank, type: time, load: bodyweight}       # ever used as substitutes
  - id: reverse-crunch
    load: bodyweight
    conditional: true
    condition: "If it reproduces familiar back symptoms, replace it."
    substitutes: [dead-bug, front-plank]

sessions:
  - key: A
    name: Full Body Strength + Abs
    order: 1
    blocks:
      - key: warmup
        name: Warm-up
        tracking: checkoff
        exercises:
          - {id: march-in-place, duration_sec: 60}
      - key: main
        name: Main work
        exercises:
          - {id: goblet-squat, sets: 3, reps: [10, 15]}
      - key: core
        name: Core
        exercises:
          - {id: side-plank, sets: 2, duration_sec: [20, 40]}
          - {id: reverse-crunch, sets: 2, reps: [8, 12]}   # conditional + substitutes
                                                           # come from the catalogue

  - key: D
    name: Full Body + Arms + Abdominal Development
    order: 4
    blocks:
      - key: ab-finisher
        name: Abdominal finisher
        type: rounds
        rounds: 2
        exercises: [...]

scheduling:
  sequence: [A, B, C, D]
  rules:
    - "Two squash sessions in a week → 3 resistance sessions, drop D"
    - "Avoid session C immediately before hard squash"

progression:
  model: double_progression
  effort_target: "1–3 RIR"
```
````

The block above is illustrative. **The authoritative specification is
[`docs/CONTRACT.md`](./CONTRACT.md)** — full field reference, value conventions,
round-trip ID rules and validation behaviour. It is reproduced verbatim as Section 4 of
every export, so the revising AI always has the spec in hand.

Validated with Zod (`src/lib/contract/schema.ts`) — the schema is the implementation of
that spec. Parse failures produce field-level errors in the import UI, never a silent
partial import.

**A reference plan is already written.**
[`fixtures/plans/home-dumbbell-v1.md`](../fixtures/plans/home-dumbbell-v1.md)
is a complete example: ~500 lines of prose context plus the contract block in Appendix
A, structuring 4 sessions and 23 distinct exercises. Its "Import notes" section records
the eight interpretations made when structuring it.

The plan is **fictional** — profile, training history and symptom context are
invented. It is written in the style a real AI-authored plan uses, because its job
is to behave like one. No real health data belongs in this repository.

It is also the phase-1 test fixture, chosen because it exercises every primitive in one
file: a rounds block, checkoff warm-ups, two conditional exercises, per-side reps and
per-side time, ranged sets and ranged rest, bodyweight-to-loaded progressions, catalogue
rest defaults overridden per occurrence, and a movement that exists only as a substitute.

Its 22 prescribed movements produce 60 prescriptions across the four sessions, so the
catalogue carries its weight: the same movement is prescribed on average 2.7 times.

---

## 7. First run — starting the loop

A new user has no plan, so nothing to export, so nothing to give an AI. **The loop cannot
start itself**, and closing that gap is what first run is for.

GAIN therefore ships **two** outbound templates, both user-editable, both carrying
`docs/CONTRACT.md` verbatim because no AI knows the `gain-plan` format otherwise:

| Template | Direction | Purpose |
|---|---|---|
| `templates/bootstrap-prompt.md` | GAIN → AI, no plan yet | Interview the user and author a first plan |
| `templates/default-ai-instructions.md` | GAIN → AI, plan + logs | Revise an existing plan against real data |

They are the same asset pointing in opposite directions, and both are Section 0 of the
document GAIN emits.

### The flow

```
sign in, no plan
      ↓
empty state: "GAIN doesn't write plans — an AI does"
      ↓
four optional questions   ← equipment, days/week + minutes, goals, anything to work around
      ↓
generate prompt = bootstrap template + answers + CONTRACT.md verbatim
      ↓  one tap: copy (download as fallback)
      ↓
[ user's own AI chat: it interviews them, then emits a plan document ]
      ↓  one paste
import → "4 sessions, 23 exercises, 60 prescriptions" → commit
      ↓
Today screen, session A
```

There is no diff to review on a first import — nothing exists to compare against — so it
confirms what was parsed and commits. Diff review belongs to the *second* import onward.

### Why questions in the app at all

Barely any. **An AI is a better interviewer than a form** — a form asks everyone the same
thing, an AI asks a follow-up. The questions exist to give the AI a running start and set
the frame, not to gather requirements. Four, all skippable, thirty seconds.

The bootstrap template tells the AI explicitly that Section 1 is thin and that anything
missing is something to ask about.

### Template variables

`templates/bootstrap-prompt.md` is filled with `{{equipment}}`, `{{sessions_per_week}}`,
`{{session_minutes}}`, `{{goals}}`, `{{constraints}}` and `{{contract}}`.

Every one except `{{contract}}` may be empty, and the template tells the AI so — a blank
field is a question to ask, not a gap to invent around. `{{contract}}` is
`docs/CONTRACT.md` verbatim and is never optional.

### The answers are not stored

They exist only to fill a template the user copies. Generate the prompt, discard the
inputs. Nothing is written to `gain.db` until a plan is actually imported.

This is not a shortcut, it is the point: "anything to work around" invites health
information, and none of it should become stored data belonging to someone who has not
yet imported a plan. Per-user isolation is meaningless if we collect before we commit.

### Invalid first plans are expected

An AI writing to an unfamiliar spec will sometimes get it wrong. That is a normal step in
the loop, not a failure state, and the recovery path is the user pasting the error back
into the chat.

So **validation errors are written for an AI to read**: field path, what was expected,
what was found, one per failure, copy-pasteable in a single tap. Never "import failed."
The user should not need to open the contract, and must never be asked to hand-edit YAML.

---

## 8. Import pipeline

```
paste / upload .md
      ↓
is this a GAIN export bundle?  → yes: explain, import nothing
      ↓  no
split: extract ```gain-plan block  →  contract
       everything else                →  context_md (verbatim)
      ↓
validate contract against Zod schema
      ↓  errors → field-level errors, copy-pasteable back to the AI, nothing written
resolve exercise slugs vs existing exercise_def
      ↓
   ┌──┴── first import? ── summary only: sessions, exercises, prescriptions
   │
DIFF REVIEW  ── changed targets, added/removed exercises,
                unmatched slugs flagged as possible renames,
                metric definitions added/removed
      ↓  user confirms (or maps renames, or cancels)
write plan_version (immutable) + source_md to disk
mark is_current, previous version retained read-only
```

Both paths share everything except the review step, so the first import is not a special
case in the pipeline — it is the same pipeline with nothing to compare against. That is
why it can ship in phase 3 while diff review waits for phase 8.

Old versions stay browsable. Workouts remain attached to the version they were logged
under, so "what did the plan actually say in week 3" is always answerable —
context a future AI may well want.

---

## 9. The session runner

The screen you actually stare at, sweating, between sets. It gets the most design care.

Built in phase 4 at `src/routes/plan/[slug]/session/[key]/`, with the pure logic in
`src/lib/session/` (resolution, pre-fill, rest timer, resume reconstruction). **How it
behaves is settled in [`docs/UI-DECISIONS.md`](./UI-DECISIONS.md)**, not here; this
section is the architectural half. The Home screen below is the one part still unbuilt —
it belongs to phase 7, and sessions are reached from the plan overview meanwhile.

- **Home:** suggested next session per `scheduling.sequence` and rules, with any
  session selectable as an override. One-tap buttons to log activity that is not part of
  the plan. `activity.kind` is a free-form slug in the user's own vocabulary — the
  buttons are their previously-used kinds, plus rest, plus a field for a new one. GAIN
  ships no list of sports, because the plan's own `scheduling.rules` already reference
  whatever the user actually does, and hardcoding one fixture's sport into the schema
  would make every other user's activity an "other".
- **Pre-session:** prompts only for metrics with `prompt_when: start`.
- **Running:** vertical list of exercises; the current one expanded and prominent,
  completed ones collapsed with a summary, upcoming ones dimmed. Target reps/weight
  pre-filled from the last time you did this exercise, so the common case is one tap.
  Large touch targets — assume sweaty hands and a phone propped on the floor.
- **Set entry:** reps (stepper, pre-filled), weight (stepper, 1 kg, total kilograms —
  UI-DECISIONS §3), difficulty (Easy / Medium / Hard). Per-side exercises log left and
  right separately. Time-based exercises get a countdown. Pre-fill falls back down a
  chain: the last matching performance, else the load configuration's `default_kg`, else
  blank — so a user's *first* session is still one tap, which is the only reason
  `load_config.default_kg` exists.
- **Rest timer:** auto-starts on set completion using `rest_sec`, with a wake lock so
  the screen doesn't sleep mid-session.
- **Deviation:** every exercise has skip / substitute / add set / drop set. Skips prompt
  for a reason (pain / time / equipment / felt easy / other). A **red-flag stop** is a
  distinct, prominent action that ends the exercise and marks the workout — matching the
  plan's own Green/Yellow/Red framework. These become structured export data:
  "skipped reverse-crunch 3× for pain" is precisely the evidence the plan's
  Section 20 asks a reviewing AI to weigh.

  **A deviation changes what the runner does, not only what it writes.** A skip collapses
  and advances past the exercise; a substitution re-renders the slot as the substitute and
  logs every subsequent set against *its* `exercise_def_id`; add/drop set changes the
  ledger. A deviation that writes a row and leaves the screen alone produces an export
  claiming the user performed the movement the plan told them to avoid — the failure is
  silent and lands in the next revision.

  A substitute therefore accumulates real history under its own slug, which is why
  pre-fill is loaded for every declared substitute of every prescribed exercise, not only
  for the prescribed ones.
- **Conditional exercises** render with their condition text visible before you start.
- **Post-session:** `prompt_when: end` metrics. A `next_morning` metric schedules a
  prompt on next app open the following day — the reference plan explicitly wants
  next-morning symptom data, and it is worthless if collected three days later.

### Resuming a workout

A phone locks, a browser tab is discarded, a user pulls to refresh mid-set. Phase 4 is
online-only, so the guarantee is narrower than phase 6's, but it is not nothing: the
runner keeps the workout's `client_id` in `sessionStorage`, and `?/start` replayed with
that same ID resolves the existing row instead of creating a second one — the ordinary
idempotency every write already has, used as a lookup.

**Resuming the workout row is the easy half. Resuming the screen is the real one.** A
reload that restores the row but not the ledger re-arms every set with a fresh ULID, and
the user re-logs sets that are already recorded. So the server reads the workout's
`set_log`, `deviation` and `metric_value` rows back and reconstructs the runner's state
from them (`src/lib/session/resume.ts`, pure and unit-tested): the ledger, the strip's
next-unlogged-set cursor, skipped and substituted slots, set-count deltas, the round in
progress, and which wrap-up metrics are already answered.

Reconstruction is inference, because a log row names a movement and not a slot (§5).
Deviations are replayed in ULID order so the substitution map is rebuilt as it stood at
the time, and each row is attributed to the occurrence currently performing its slug
before one that has since been substituted away. Where a slug could belong to two
loggable occurrences of one session, the earlier wins. That last rule can put a set in
the wrong slot of the right session; it can never invent, drop or misattribute a row
across workouts. Making it exact needs the `block_key` column §5 describes.

Surviving a full browser kill — where `sessionStorage` is gone too — is a phase-6
guarantee, and IndexedDB is what delivers it.

### Offline model

- The client owns workout state. Everything is written to IndexedDB first, then queued
  for sync.
- All writes carry a client-generated ULID and are **idempotent** on the server —
  replaying the queue can never duplicate a set.
- Sync is append-only per workout; there is no multi-device concurrent-edit case worth
  solving here. Last-write-wins on the workout record, union on set logs.
- A workout survives: connection loss, phone lock, browser kill, container restart.
  This is a hard requirement, and it gets an explicit test.

---

## 10. Progress & history

- **Per exercise:** load × reps over time, estimated volume, double-progression state
  ("12/11/11 — one session from a load increase"), and difficulty distribution.
- **Per session type:** duration, completion rate, deviation count.
- **Metric trends:** any numeric plan-declared metric is chartable, so symptom and
  energy tracking come free from the metric definitions rather than from hardcoding.
- **History:** reverse-chronological workout list, each drilling into full set detail
  and the plan version it ran under.
- Charts stay simple and read well on a phone. No dashboard sprawl.

---

## 11. Export

One `.md` file, self-contained, ready to paste or upload into any chat.

```markdown
# GAIN Export — <Plan> — <window>

## 0. Your task                       ← user-editable template, verbatim
## 1. The current plan                ← source_md of the current version, verbatim:
                                        the prose context AND the gain-plan block,
                                        exactly as the user pasted it in
## 2. Progress summary                ← generated tables: per-exercise progression,
                                        adherence, metric trends, deviations
## 3. Raw logs                        ← ```csv sets / ```csv sessions / ```csv activities
## 4. How to return an updated plan
                                      ← the contract spec + ID-preservation rules
```

- **Section 1 is `source_md`, byte-for-byte** — not `context_md` with the contract block
  spliced back in. The plan document already sits on disk exactly as it arrived, so
  emitting it is a copy rather than a reconstruction, and there is no block-position
  bookkeeping to get wrong. `context_md` exists for diffing and for the
  never-paraphrase guarantee; it is not what the export replays.
- **The bundle is not a plan document and is not re-importable.** An AI reads a bundle and
  returns a plan document; import only ever sees plan documents. When a user pastes a whole
  bundle — and they will — GAIN recognises its own generated sections and says so: *"that
  is a GAIN export, not a plan. Paste what your AI gave you."* Teaching the parser to strip
  GAIN's own headings instead would couple it to the export generator and to a Section 0
  the user is free to retitle.
- **Windowed by default** (current block / last N weeks) with a full-history option.
  A year of raw sets will otherwise blow past a usable context window and bury the
  recent signal in old noise.
- **Section 2 is pre-computed** so the reviewing AI does arithmetic it cannot get
  wrong — it reads "goblet squat: 6 kg, 12/12/12, RIR 2, no symptoms" rather than
  deriving it from 400 CSV rows.
- **Section 4 is generated by GAIN, not user-editable**, and states the round-trip
  rules in imperative terms: preserve every `id`; bump `version`; set
  `based_on_version`; populate `changelog`; never reuse an id for a different movement;
  emit the whole plan, not a patch.
- **Section 0 is the user-editable template** — per user, versioned. The seeded default
  is [`templates/default-ai-instructions.md`](../templates/default-ai-instructions.md).
  It is deliberately plan-agnostic: it tells the AI to read and honour the
  principles in Section 1 rather than restating them, so it still works when the
  plan is replaced. Multiple named templates are supported (e.g. "routine 4-week
  review" vs "I'm injured, be cautious").

  Templates support a small fixed set of substitutions, left as literal text if unknown:
  `{{plan_name}}`, `{{plan_version}}`, `{{export_window}}`, `{{today}}`,
  `{{workouts_logged}}`, `{{weeks_elapsed}}`.

---

## 12. Being built entirely by AI

This constrains the design, and the constraints are already baked into the above.

- **Schema-first, not convention-first.** The Zod contract schema, the SQLite DDL and
  the API types are the specification. Agents implement against types, not prose.
- **Golden-file tests on the real document.**
  [`fixtures/plans/home-dumbbell-v1.md`](../fixtures/plans/home-dumbbell-v1.md)
  is committed as a fixture. The round-trip test is the project's spine:
  `import → log synthetic workouts → export → extract Section 1 → re-import` must
  preserve every exercise ID, every set, and `context_md` byte-for-byte. Write this test
  in phase 1, before the UI exists.

  Note what it does **not** assert: that a real revision comes back unchanged. The AI is
  supposed to rewrite the prose when the reasoning changes. The invariant is that GAIN's
  own storage and replay are lossless — not that the loop is a no-op.
- **Deterministic core.** Parsing, diffing, progression logic and export generation are
  pure functions over plain data — trivially unit-testable, no I/O, no time
  dependency (inject the clock).
- **Small modules with checkable acceptance criteria.** Each phase below is scoped so
  one agent owns it and "done" is a passing test, not a judgement call.
- **Property tests on the sync layer**, where AI-written code most reliably goes wrong:
  replay any subset of the queue in any order, assert no duplicate sets and no data loss.

### Toolchain, settled

Phase 1 scaffolds these. They are recorded here so an agent implements them rather than
choosing them, and so two agents do not choose differently.

| | Choice | Why |
|---|---|---|
| Runtime | **Node 24 LTS**, pinned in `.nvmrc`, `package.json` `engines`, and the Dockerfile base image | One version everywhere. A container on a different major than the dev machine is a class of bug nobody enjoys finding |
| Package manager | **npm** | Ships with Node, one lockfile, no corepack step in the image build. This is a single-package repo; a workspace-aware manager would earn nothing |
| Language | **TypeScript, `strict: true`** | The Zod schema and the SQLite DDL are the specification (above). Loose types would defeat the point |
| Tests | **Vitest** | Already decision 9's stack. The golden round-trip test is plain Vitest, no harness |
| Browser tests | **Playwright**, Chromium only, `npm run test:e2e`, added in phase 4 | The session runner's worst failures are layout ones — they exist only at a real viewport width, and no amount of unit testing sees them. Kept deliberately *outside* `npm run verify` so CI's few-second check never downloads a browser |
| Lint / format | **ESLint + Prettier**, plus `svelte-check` | What `sv create` scaffolds. Formatting arguments are not a good use of anyone's attention |
| CI | **GitHub Actions**: typecheck, lint and test on push and PR; build and push the image on a tag | Minimal. The round-trip test failing must be loud |

**No per-file licence headers.** The AGPL does not require them, they are noise, and agents
apply them inconsistently. `LICENSE` at the root plus the README note is the whole of it.

**AGPL §13 needs one thing from the UI**, though: a running instance must offer its source
to its users. That is a link to the repository in the app shell — cheap, but it has to
actually be built. It belongs to phase 3, when a shell exists to put it in.

### Build order

| Phase | Deliverable | Done when |
|---|---|---|
| 1 | Contract schema, parser, diff engine, export generator, **both prompt templates** — pure functions, no UI | Round-trip golden test passes on the real plan doc; both templates embed CONTRACT.md byte-for-byte |
| 2 | SQLite layer, per-user DB provisioning, migrations — **reconcile §5 with the catalogue first** | Import writes a version; second import produces a correct diff |
| 3 | OIDC auth, group gate, session handling, container + compose, AGPL §13 source link, **first run: empty state → prompt out → paste a plan in** | Deploys to Portainer; unauthorised user gets a clean 403; a user with an empty account copies the bootstrap prompt and pastes a plan back into a working app |
| 4 | Session runner UI, online only | A full session of the real plan can be logged on a phone |
| 5 | **Export UI** — route, window picker, copy with download fallback | A logged block leaves GAIN as one pasteable document, in one tap |
| 6 | Offline PWA: IndexedDB, sync queue, idempotency | Airplane-mode session syncs cleanly on reconnect; property tests pass; a workout survives a full browser kill |
| 7 | Progress, history, charts, **and the Home screen** — suggested next session, activity logging, the next-morning prompt | Double-progression state matches hand-calculated expectations; Home suggests the right next session |
| 8 | Revision diff review, template editor | A logged block exports, comes back revised, and the diff is reviewed and committed — the loop closes |

The item-by-item decomposition of phases 5–8, with acceptance criteria, is
[`docs/ROADMAP.md`](./ROADMAP.md). This table is the map; that file is the itinerary.

**Why the templates land in phase 1.** They are pure content, they need no code, and they
must embed `docs/CONTRACT.md` verbatim — the same mechanism the export generator already
implements, so it is one assertion in the golden test rather than a new capability.

The stronger reason is that **writing them tests the contract**. If clear instructions for
producing a valid `gain-plan` block cannot be written, the contract is not clear enough,
and that is far cheaper to discover before a parser hardens the current wording.

**Why first run lands in phase 3, not at the end.** Importing a plan is the front door,
not a refinement. Every user arrives with an empty account — including the first one — and
until a plan is in, there is nothing to run, nothing to log and nothing to export. An app
that can only be populated by running a script against its database is not usable by
anybody, and seeding one by hand is a development workaround, not a product.

It needs nothing that phases 1 and 2 do not already provide: parse, validate, write a
version. The screen is a paste box, a validation result and a confirmation.

**Why export is its own phase, ahead of offline and charts.** It began as the tail of the
revision phase and was pulled forward once the runner shipped, because the two halves of
that phase turned out to have nothing in common. Reviewing a revision needs a diff UI and
weeks of logs to have something to revise; *emitting* the bundle needs a route, a window
picker and a copy button, on top of a generator phase 1 already finished and tested.

Leaving them together meant a user could import a plan, log an entire block, and have no
way to get any of it out — the loop open at its return crossing, with the code to close it
sitting complete and unreachable. That is the one gap that makes everything logged so far
worth less, and it is the cheapest phase in the list to close.

**Why the Home screen belongs with progress.** Three obligations from §9 — the suggested
next session, one-tap activity logging, and the next-morning metric prompt — were attached
to no phase at all, which is how they stayed unbuilt while everything around them shipped.
They are one screen, they need nothing from offline, and each is a promise the app
currently does not keep: the `activity` table exists with no way to write to it, and a plan
declaring a `next_morning` metric collects nothing. Progress and history land on the same
screen, so they land in the same phase.

**The two imports are not the same job**, which is what makes the split clean:

| | First import | Revision import |
|---|---|---|
| Diff against | Nothing — everything is new | The previous version |
| Needs | Parse, validate, confirm | Rename detection, per-field diff, mapping UI |
| Available | Phase 3 | Phase 8 |

The first import has nothing to compare against, so it needs no diff review — a summary of
what was parsed is enough. The revision import is where the real work lives, and it cannot
happen until there are weeks of logs to export in the first place. Deferring it costs
nothing.

Phase 1 before anything else. If the round-trip is not provably lossless, everything
built on top of it is built on sand.

---

## 13. Non-goals

Explicitly out of scope, to stop agents inventing work:

- No in-app AI, API keys, or chat.
- No exercise library, demo videos, or GIFs — form cues live in the plan context.
- No social, sharing, or multi-user anything. Users never interact.
- No nutrition or body-composition tracking beyond plan-declared metrics.
- No wearable, Health/Google Fit, or Strava integration.
- No native mobile app. The PWA is the mobile app.
- No calendar or planned-schedule adherence.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| AI returns a malformed or missing contract block | Strict validation, clear field-level errors, nothing written on failure; contract spec restated in every export |
| AI renames exercise IDs, splitting history | Rename detection in the diff review; explicit ID-preservation instructions; slugs never silently auto-created for near-matching names |
| Export outgrows the chat context window | Windowed by default; pre-computed summary carries the signal |
| Offline sync loses or duplicates a workout | Client-generated IDs, idempotent server writes, property-tested replay |
| `ORIGIN` / proxy misconfiguration breaks login | Documented in compose; startup logs the effective origin and redirect URI |
| Context prose mangled on round-trip | `context_md` stored and replayed verbatim; byte-equality asserted in the golden test |
| A resumed workout attributes a set to the wrong slot of the same session | Accepted and bounded (§9, "Resuming"): log rows carry no `block_key`, so reconstruction infers. It can never cross workouts, invent a row or drop one. The exact fix is a schema column, deferred until a real plan needs it |
