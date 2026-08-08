# GAIN — High-Level Architecture

A self-hosted web app for running and tracking AI-authored exercise plans.

**Status:** design agreed, not yet implemented.
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
| 8 | Scheduling | Suggested-next-session, no calendar; one-tap logging of squash/walks/rest |
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
        <plan_id>/
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

Per-user `gain.db`. IDs are ULIDs unless noted.

```
plan                 id, slug, name, created_at, archived_at
plan_version         id, plan_id, version_no, based_on_version,
                          source_md (verbatim), context_md, contract_json,
                          imported_at, changelog, is_current
exercise_def              id, plan_id, slug (STABLE ACROSS VERSIONS),
                          name, first_seen_version, last_seen_version
version_exercise          plan_version_id, session_key, block_key, exercise_def_id,
                          order_no, type, sets, reps_min, reps_max, duration_min_s,
                          duration_max_s, per_side, load_ref, rest_min_s, rest_max_s,
                          conditional, condition_text, substitutes_json
load_config               plan_version_id, ref, label, default_kg, is_bodyweight
metric_def                plan_version_id, scope (set|exercise|session),
                          key, label, type, min, max, options_json, prompt_when, optional

workout                   id, plan_version_id, session_key, started_at,
                          completed_at, status, client_id (idempotency), notes
set_log                   id, workout_id, exercise_def_id, set_no, side,
                          reps, weight_kg, duration_s, difficulty, client_id
metric_value              id, scope_ref (set_log|workout|exercise-in-workout),
                          metric_key, value_num, value_text
deviation                 id, workout_id, exercise_def_id, kind (skip|substitute|
                          add_set|drop_set|stop_red_flag), reason_code, note,
                          substitute_exercise_slug
activity                  id, kind (squash|walk|rest|other), occurred_at,
                          duration_min, intensity, note
ai_template               id, name, body_md, is_default, updated_at
```

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
  set:
    - key: rir
      label: RIR
      type: number
      min: 0
      max: 5
      prompt_when: per_exercise
      optional: true
  exercise:
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
          - {id: reverse-crunch, sets: 2, reps: [8, 12]}
            condition: "Omit if it reproduces familiar back symptoms"
            substitutes: [dead-bug, front-plank]

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
is a complete example: ~1300 lines of prose context plus the contract block in Appendix
A, structuring 4 sessions and 22 distinct exercises. Its "Import notes" section records
the five interpretations made when structuring it.

The plan is **fictional** — profile, training history and symptom context are
invented. It is written in the style a real AI-authored plan uses, because its job
is to behave like one. No real health data belongs in this repository.

It is also the phase-1 test fixture, chosen because it exercises every primitive in one
file: a rounds block, checkoff warm-ups, two conditional exercises, per-side reps and
per-side time, ranged sets and ranged rest, bodyweight-to-loaded progressions, and both
substitute forms — bare slugs resolved in the catalogue, and an inline external movement.

22 exercises produce 60 prescriptions across the four sessions, so the catalogue carries
its weight: the same movement is prescribed on average 2.7 times.

---

## 7. Import pipeline

```
paste / upload .md
      ↓
split: extract ```gain-plan block  →  contract
       everything else                →  context_md (verbatim)
      ↓
validate contract against Zod schema
      ↓  errors → field-level error UI, nothing written
resolve exercise slugs vs existing exercise_def
      ↓
DIFF REVIEW  ── changed targets, added/removed exercises,
                unmatched slugs flagged as possible renames,
                metric definitions added/removed
      ↓  user confirms (or maps renames, or cancels)
write plan_version (immutable) + source_md to disk
mark is_current, previous version retained read-only
```

Old versions stay browsable. Workouts remain attached to the version they were logged
under, so "what did the plan actually say in week 3" is always answerable —
context a future AI may well want.

---

## 8. The session runner

The screen you actually stare at, sweating, between sets. It gets the most design care.

- **Home:** suggested next session per `scheduling.sequence` and rules, with any
  session selectable as an override. One-tap buttons to log squash / walk / rest.
- **Pre-session:** prompts only for metrics with `prompt_when: start`.
- **Running:** vertical list of exercises; the current one expanded and prominent,
  completed ones collapsed with a summary, upcoming ones dimmed. Target reps/weight
  pre-filled from the last time you did this exercise, so the common case is one tap.
  Large touch targets — assume sweaty hands and a phone propped on the floor.
- **Set entry:** reps (stepper, pre-filled), weight (stepper stepping by your smallest
  available plate increment), difficulty (Easy / Medium / Hard). Per-side exercises log
  left and right separately. Time-based exercises get a countdown.
- **Rest timer:** auto-starts on set completion using `rest_sec`, with a wake lock so
  the screen doesn't sleep mid-session.
- **Deviation:** every exercise has skip / substitute / add set / drop set. Skips prompt
  for a reason (pain / time / equipment / felt easy / other). A **red-flag stop** is a
  distinct, prominent action that ends the exercise and marks the workout — matching the
  plan's own Green/Yellow/Red framework. These become structured export data:
  "skipped reverse-crunch 3× for pain" is precisely the evidence the plan's
  Section 20 asks a reviewing AI to weigh.
- **Conditional exercises** render with their condition text visible before you start.
- **Post-session:** `prompt_when: end` metrics. A `next_morning` metric schedules a
  prompt on next app open the following day — the reference plan explicitly wants
  next-morning symptom data, and it is worthless if collected three days later.

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

## 9. Progress & history

- **Per exercise:** load × reps over time, estimated volume, double-progression state
  ("12/11/11 — one session from a load increase"), and difficulty distribution.
- **Per session type:** duration, completion rate, deviation count.
- **Metric trends:** any numeric plan-declared metric is chartable, so symptom and
  energy tracking come free from the metric definitions rather than from hardcoding.
- **History:** reverse-chronological workout list, each drilling into full set detail
  and the plan version it ran under.
- Charts stay simple and read well on a phone. No dashboard sprawl.

---

## 10. Export

One `.md` file, self-contained, ready to paste or upload into any chat.

```markdown
# GAIN Export — <Plan> — <window>

## 0. Your task                       ← user-editable template, verbatim
## 1. Plan context               ← context_md of current version, verbatim
## 2. Progress summary                ← generated tables: per-exercise progression,
                                        adherence, metric trends, deviations
## 3. Raw logs                        ← ```csv sets / ```csv sessions / ```csv activities
## 4. How to return an updated plan
                                      ← the contract spec + ID-preservation rules
```

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

## 11. Being built entirely by AI

This constrains the design, and the constraints are already baked into the above.

- **Schema-first, not convention-first.** The Zod contract schema, the SQLite DDL and
  the API types are the specification. Agents implement against types, not prose.
- **Golden-file tests on the real document.** `4_week_home_dumbbell_training_program_ai_context.md`
  is committed as a fixture. The round-trip test is the project's spine:
  `import → log synthetic workouts → export → re-import` must preserve every exercise
  ID, every set, and `context_md` byte-for-byte. Write this test in phase 1, before the
  UI exists.
- **Deterministic core.** Parsing, diffing, progression logic and export generation are
  pure functions over plain data — trivially unit-testable, no I/O, no time
  dependency (inject the clock).
- **Small modules with checkable acceptance criteria.** Each phase below is scoped so
  one agent owns it and "done" is a passing test, not a judgement call.
- **Property tests on the sync layer**, where AI-written code most reliably goes wrong:
  replay any subset of the queue in any order, assert no duplicate sets and no data loss.

### Build order

| Phase | Deliverable | Done when |
|---|---|---|
| 1 | Contract schema, parser, diff engine, export generator — pure functions, no UI | Round-trip golden test passes on the real plan doc |
| 2 | SQLite layer, per-user DB provisioning, migrations | Import writes a version; second import produces a correct diff |
| 3 | OIDC auth, group gate, session handling, container + compose | Deploys to Portainer; unauthorised user gets a clean 403 |
| 4 | Session runner UI, online only | A full session of the real plan can be logged on a phone |
| 5 | Offline PWA: IndexedDB, sync queue, idempotency | Airplane-mode session syncs cleanly on reconnect; property tests pass |
| 6 | Progress, history, charts | Double-progression state matches hand-calculated expectations |
| 7 | Import review/diff UI, template editor, export UI | Full loop runs end-to-end without touching a database |

Phase 1 before anything else. If the round-trip is not provably lossless, everything
built on top of it is built on sand.

---

## 12. Non-goals

Explicitly out of scope, to stop agents inventing work:

- No in-app AI, API keys, or chat.
- No exercise library, demo videos, or GIFs — form cues live in the plan context.
- No social, sharing, or multi-user anything. Users never interact.
- No nutrition or body-composition tracking beyond plan-declared metrics.
- No wearable, Health/Google Fit, or Strava integration.
- No native mobile app. The PWA is the mobile app.
- No calendar or planned-schedule adherence.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| AI returns a malformed or missing contract block | Strict validation, clear field-level errors, nothing written on failure; contract spec restated in every export |
| AI renames exercise IDs, splitting history | Rename detection in the diff review; explicit ID-preservation instructions; slugs never silently auto-created for near-matching names |
| Export outgrows the chat context window | Windowed by default; pre-computed summary carries the signal |
| Offline sync loses or duplicates a workout | Client-generated IDs, idempotent server writes, property-tested replay |
| `ORIGIN` / proxy misconfiguration breaks login | Documented in compose; startup logs the effective origin and redirect URI |
| Context prose mangled on round-trip | `context_md` stored and replayed verbatim; byte-equality asserted in the golden test |
