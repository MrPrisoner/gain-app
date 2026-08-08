# The GAIN plan contract — v1

This is the authoritative specification for the machine-readable block that GAIN reads
from a plan document. It is reproduced verbatim as **Section 4** of every export,
so the AI revising a plan always has the spec in front of it.

---

## 1. What this is for

A GAIN plan document has two parts:

- **Prose context** — rationale, goals, form cues, injury rules, progression philosophy,
  exclusions. GAIN stores this verbatim and never modifies it.
- **One fenced contract block** — the structured skeleton GAIN uses to render sessions
  and record logs.

Everything outside the block is context. The block is the only part GAIN parses.

## 2. Placement and fencing

The block appears **once** per document, fenced with the info string `gain-plan`,
and by convention lives in an appendix at the end so the prose reads as a normal
document:

````markdown
```gain-plan
schema_version: 1
...
```
````

The body is YAML. If the document contains no such block, or more than one, import
fails with an explicit error and nothing is written.

## 3. Top-level keys

| Key | Required | Purpose |
|---|---|---|
| `schema_version` | yes | Always `1` for this spec |
| `plan` | yes | Identity, version, changelog |
| `loads` | yes | Named load configurations referenced by exercises |
| `exercises` | yes | The catalogue — every movement declared once |
| `sessions` | yes | The trainable sessions, which reference the catalogue |
| `metrics` | no | Plan-declared fields to log beyond the fixed core |
| `scheduling` | no | Session ordering and selection rules |
| `progression` | no | Progression model and effort targets |
| `safety` | no | Symptom/stop framework surfaced in the session UI |

### `plan`

```yaml
plan:
  slug: home-dumbbell                    # STABLE. Identifies the plan across all versions
  name: 4-Week Home Dumbbell Plan
  version: 2                             # integer, increment on every revision
  based_on_version: 1                    # null for a first import
  block_length_weeks: 4                  # optional
  session_target_min: 45                 # optional
  changelog:                             # required from version 2 onward
    - "Goblet squat 3×8–12 → 3×10–15 (top of range reached in weeks 3–4)"
```

### `loads`

Named configurations so exercises say "heavy", not a number. This matches how plans
are actually written and means a load change is one edit, not fifty.

```yaml
loads:
  - ref: heavy
    label: Heavy configuration
    default_kg: 6
    note: "Adjust per exercise and form"       # optional
  - ref: bodyweight
    label: Bodyweight
    is_bodyweight: true                        # no weight field shown when logging
```

`ref` values are free-form; `heavy` / `moderate` / `light` / `bodyweight` are conventional.

### `exercises` — the catalogue

**Every movement is declared exactly once here**, and sessions refer to it by `id`. A
plan typically prescribes the same exercise in several sessions with different targets;
the catalogue is what stops those occurrences from disagreeing about what the exercise
*is*.

```yaml
exercises:
  - id: goblet-squat                        # STABLE SLUG — see §5. lowercase, hyphenated
  - id: db-floor-press
    name: Dumbbell floor press              # only when the derived name is wrong
  - id: side-plank
    type: time                              # reps (default) | time
    per_side: true
    load: bodyweight
  - id: reverse-crunch
    load: bodyweight
    conditional: true
    condition: "If it reproduces familiar back symptoms, replace it."
    substitutes: [dead-bug, front-plank]
```

`id` is the only required field. Everything else is optional and describes the movement
itself rather than any one prescription of it:

| Field | Default | Meaning |
|---|---|---|
| `name` | derived from `id` | Display name. `goblet-squat` → "Goblet squat" |
| `type` | `reps` | `reps` or `time` |
| `per_side` | `false` | Logs left and right separately |
| `load` | — | Default load `ref`, overridable per occurrence |
| `rest_sec` | — | Default rest, overridable per occurrence |
| `note` | — | Persistent guidance — form cues shown wherever it appears |
| `conditional`, `condition`, `substitutes` | — | Properties of the movement, not the occurrence |

**Name derivation.** With `name` omitted, GAIN replaces hyphens with spaces and
capitalises the first letter. Supply `name` only where that is wrong — `db-floor-press`
and `mcgill-curl-up` need it; `goblet-squat` does not.

Because `name` is declared once, **one `id` cannot carry two display names.** That
ambiguity is not resolvable by rule; it is unrepresentable.

### `sessions`

```yaml
sessions:
  - key: A                       # STABLE. Short identifier, used by `scheduling.sequence`
    name: Full Body Strength + Abs
    order: 1
    note: "Primary lower-body session. Avoid immediately before hard squash."   # optional
    blocks:
      - key: main
        name: Main work
        type: sequence           # sequence (default) | rounds
        rounds: 2                # required when type: rounds
        tracking: full           # full (default) | checkoff
        note: "..."              # optional
        exercises: [ ... ]
```

`tracking: checkoff` marks a block as completion-only — no reps, weight or difficulty are
recorded and nothing feeds progression charts. Use it for warm-ups and mobility work.

### Exercise entries — the prescription

Inside a block, an entry is a **reference to the catalogue plus the targets for this
occasion**. It carries only what varies; everything else comes from the catalogue entry.

```yaml
exercises:
  - {id: goblet-squat, sets: 3, reps: [8, 12], load: heavy, rest_sec: [75, 90]}
  - {id: bird-dog, reps: 6}                       # sets defaults to 1
  - {id: side-plank, sets: 2, duration_sec: [20, 40]}
```

| Field | Default | Meaning |
|---|---|---|
| `id` | required | Must exist in `exercises` |
| `sets` | `1` | Integer, or `[min, max]` for "2–3 sets" |
| `reps` | — | Integer or `[min, max]`. Required when `type: reps` |
| `duration_sec` | — | Integer or `[min, max]`. Required when `type: time` |
| `load` | catalogue | A `ref` from `loads` |
| `rest_sec` | catalogue | Integer or `[min, max]` |
| `note` | catalogue | Guidance for this prescription specifically |
| `conditional`, `condition`, `substitutes` | catalogue | Override for this occasion only |

Flow style (`- {id: ..., reps: 8}`) and block style are both valid YAML and both accepted.
Flow keeps a session readable as a table; use whichever is clearer.

`substitutes` entries are either a bare slug defined in the catalogue, or an external
movement given inline — which needs an explicit name, since it has no catalogue entry:

```yaml
substitutes:
  - dead-bug
  - {id: lying-triceps-extension, name: Lying dumbbell triceps extension}
```

**The same exercise may appear in several sessions or blocks** with different targets —
that is normal and expected. All occurrences share one `id`, and therefore one identity,
one name and one set of movement properties.

### `metrics`

The fixed core — reps, weight, duration, difficulty (Easy/Medium/Hard) — is always
recorded and must not be declared here. Declare anything additional the plan wants:

```yaml
metrics:
  set:                              # prompted per set
    - key: ...
  exercise:                         # prompted once per exercise
    - key: rir
      label: RIR (reps in reserve)
      type: number                  # number | scale | enum | text | bool
      min: 0
      max: 5
      optional: true
  session:
    - key: energy_before
      label: Energy before
      type: scale
      min: 1
      max: 10
      prompt_when: start            # start | end | next_morning
```

`prompt_when: next_morning` schedules a prompt on the next app open the following day.

Metric `key` values are **stable identifiers**. Renaming a key breaks that metric's
history exactly as renaming an exercise slug does.

### `scheduling`, `progression`, `safety`

All optional and largely free-text — GAIN surfaces them in the UI but does not act on
them automatically. `scheduling.sequence` is the exception: it drives the suggested
next session.

```yaml
scheduling:
  sequence: [A, B, C, D]
  drop_order: [D]                   # sessions to drop first when volume must be cut
  rules:
    - "Two squash sessions in the week: skip D."

progression:
  model: double_progression         # double_progression | linear | none
  effort_target: "Approximately 1–3 RIR"
  effort_by_week:
    - week: 1
      rir: [3, 3]
      focus: "Establish — learn technique, identify starting loads"
  increase_load_when:
    - "Top of rep range achieved across all sets"

safety:
  symptom_framework:
    - level: green | yellow | red
      label: "..."
      action: continue | modify | stop
      modifications: ["Reduce load", "..."]     # optional
  escalation: "..."
```

The `red` entry is rendered on the session UI's stop-exercise action, so the rule is in
front of you at the moment you need it.

---

## 4. Value conventions

- **Ranges** are `[min, max]`. Any field accepting a range also accepts a bare integer
  meaning "exactly this".
- **`per_side: true`** means the prescription is per side. `sets: 3, reps: [10,12],
  per_side: true` is "3 × 10–12 per side" and produces six logged entries.
- **`type: time`** exercises use `duration_sec` and log elapsed time, not reps.
- **Bodyweight** is expressed as `load: <a ref with is_bodyweight: true>`, never as
  `weight: 0`.
- **Slugs** are lowercase, hyphenated, ASCII: `supported-one-arm-row`.

---

## 5. Round-trip rules — read this before revising a plan

GAIN joins all history on the exercise slug. These rules are what keep a user's training
history intact across a revision. Breaking them silently destroys data that cannot be
reconstructed.

Every slug is declared exactly once, in `exercises`. That catalogue is the only place you
need to look to check you have preserved them all.

1. **Never change an existing `id`.** If `goblet-squat` was in the previous version and
   the exercise is still in the plan, it is still `goblet-squat`. Not
   `goblet_squat`, not `db-goblet-squat`, not `goblet-squat-v2`. Changing the `name` is
   fine; changing the `id` is not.
2. **Never reuse an `id` for a different movement.** A slug is bound to a movement
   permanently.
3. **Removing an exercise is done by omitting it**, not by renaming or repurposing it.
   Its history is retained and remains visible.
4. **New exercises get new slugs**, descriptive and in the same style.
5. **`plan.slug` never changes.** It is the same plan even after a total
   rewrite of every session.
6. **Increment `plan.version` by exactly one** and set `based_on_version` to the
   version you were given.
7. **Populate `changelog`** with one line per substantive change, in user-facing terms.
8. **Emit the entire plan**, not a patch or a diff. The block must stand alone.
9. **Session `key` values are also stable.** Reusing `C` for a different session
   misattributes past workouts.
10. **Metric `key` values are stable** for the same reason.

GAIN shows the user a diff before committing an import, and flags any slug present in
the previous version but absent from the new one as a possible rename. That safety net
exists because this failure mode is silent, not because these rules are optional.

---

## 6. Minimal valid block

```gain-plan
schema_version: 1

plan:
  slug: simple-plan
  name: Simple Plan
  version: 1
  based_on_version: null

loads:
  - ref: main
    label: Working weight
    default_kg: 20

exercises:
  - id: goblet-squat

sessions:
  - key: A
    name: Session A
    order: 1
    blocks:
      - key: main
        name: Main work
        exercises:
          - {id: goblet-squat, sets: 3, reps: [8, 12], load: main}
```

---

## 7. Validation behaviour

Import is all-or-nothing. On any of the following, GAIN reports the failing field and
writes nothing:

- Missing or duplicated `gain-plan` block
- YAML that does not parse
- Missing required keys, or a value of the wrong type
- `load` referencing an undeclared `ref`
- A session exercise `id` with no entry in the `exercises` catalogue
- `scheduling.sequence` referencing an undeclared session `key`
- A bare-slug `substitutes` entry not defined in the catalogue
- Duplicate `id` in the catalogue, or a duplicate session `key`
- `version` not greater than the current stored version for that `plan.slug`

Warnings — surfaced in the diff review but not blocking:

- A slug in the previous version is absent from the new one (possible rename or removal)
- A new slug closely resembles an existing one (possible accidental rename)
- A catalogue entry that no session references
- A metric key has disappeared, orphaning its history
- `changelog` is empty on a version above 1
