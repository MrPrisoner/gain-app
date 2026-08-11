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

| Field | Required | Meaning |
|---|---|---|
| `ref` | yes | Stable identifier referenced by `load`. Free-form; `heavy` / `moderate` / `light` / `bodyweight` are conventional |
| `label` | yes | Display name shown wherever the configuration is named |
| `default_kg` | no | Starting weight, **as a total** — see §4. Omit on a bodyweight configuration |
| `is_bodyweight` | no (default `false`) | Suppresses the weight field when logging |
| `note` | no | Guidance shown alongside the configuration |

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
        rest_sec: [45, 60]       # rounds blocks only — rest BETWEEN rounds
        tracking: full           # full (default) | checkoff
        note: "..."              # optional
        exercises: [ ... ]
```

`tracking: checkoff` marks a block as completion-only — no reps, weight, difficulty or
rest are recorded, and nothing feeds progression charts. Use it for warm-ups and mobility
work. A `rest_sec` reaching a checkoff block from the catalogue is **ignored, not
rejected**: it is a true property of the movement where the movement is trained, and a
warm-up is not that.

`type: rounds` makes the block a circuit — every exercise is performed once in order, and
the whole block repeats `rounds` times. **`sets` is invalid on an exercise inside a rounds
block.** `rounds` is the only multiplier there, and a block declaring both is rejected
rather than interpreted, because "3 sets" inside a 2-round circuit has two equally
defensible readings.

**Rest in a rounds block is between rounds, not between exercises.** Moving straight to
the next movement is what makes a circuit a circuit, so a `rest_sec` reaching a rounds
block from the catalogue is ignored, exactly as in a checkoff block. To prescribe a pause,
declare `rest_sec` on the block:

```yaml
- key: ab-finisher
  name: Abdominal finisher
  type: rounds
  rounds: 2
  rest_sec: [45, 60]         # once, after each round
  exercises: [ ... ]
```

Block-level `rest_sec` is valid **only** on a `type: rounds` block. Anywhere else it is
rejected: rest between straight sets is a property of the movement, and the catalogue is
where movements are described.

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

**`substitutes` entries are always bare slugs declared in the catalogue.** There is no
inline form — a movement the plan may ask for is a movement the plan declares.

```yaml
substitutes: [dead-bug, lying-triceps-extension]
```

Declare a substitute in the catalogue even when no session prescribes it directly. A
substitute that gets taken every week accumulates real history, and history needs a stable
slug exactly as much as a prescribed movement does.

**The same exercise may appear in several sessions or blocks** with different targets —
that is normal and expected. All occurrences share one `id`, and therefore one identity,
one name and one set of movement properties.

### `metrics`

The fixed core — reps, weight, duration, difficulty (Easy/Medium/Hard) — is always
recorded and must not be declared here. Declare anything additional the plan wants:

```yaml
metrics:
  set:                              # prompted per set, alongside the core fields
    - key: set_symptom
      label: Symptoms during this set
      type: scale
      min: 0
      max: 10
      optional: true
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

| Field | Required | Meaning |
|---|---|---|
| `key` | yes | STABLE identifier. Unique within its scope |
| `label` | yes | Prompt text shown to the user |
| `type` | yes | `number` \| `scale` \| `enum` \| `text` \| `bool` |
| `min`, `max` | for `number` and `scale` | Inclusive bounds |
| `options` | for `enum` | The allowed values, in display order |
| `optional` | no (default `false`) | May be left unanswered |
| `prompt_when` | `session` scope only | `start` \| `end` \| `next_morning` |

`prompt_when` applies to **session-scope metrics only**. A `set` metric is prompted with
each set and an `exercise` metric once per exercise, so there is nothing left to schedule;
`prompt_when` on either is rejected.

`prompt_when: next_morning` schedules a prompt on the next app open the following day.

**Set-scope metrics should almost always be `optional: true`.** A set is committed in a
single tap; a required per-set prompt turns every set into two interactions, and a log
that is tedious stops being an honest one. Use `exercise` or `session` scope unless the
value genuinely changes from set to set.

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
- **Weight is always the total kilograms moved in one set** — `default_kg` and every
  logged weight — summed across every implement in use at once, never per-implement.
  Two 6 kg dumbbells lifted together is `default_kg: 12`, not `6`; a single dumbbell's
  own weight is already the total. Get this wrong and the log, the charts and the
  export are all wrong by the same factor.
- **`per_side: true`** means the prescription is logged as two separate sets, one per
  side — for a movement where one side completes a full set before the other starts (a
  one-arm row, a side plank). `sets: 3, reps: [10,12], per_side: true` is "3 × 10–12 per
  side" and produces six logged entries. **A movement that alternates sides within one
  set is not `per_side`** — alternating dumbbell curls, alternating reverse lunges. Log
  those as a single set: total reps across both sides, total kg across both implements.
  "10 reps per arm with a pair of 6 kg dumbbells, alternating" is `reps: 20, load: <a
  ref with default_kg: 12>`, `per_side` omitted.
- **`type: time`** exercises use `duration_sec` and log elapsed time, not reps.
- **Bodyweight** is expressed as `load: <a ref with is_bodyweight: true>`, never as
  `weight: 0`.
- **Slugs** are lowercase, hyphenated, ASCII: `supported-one-arm-row`.

---

## 5. Round-trip rules — read this before revising a plan

GAIN joins all history on the exercise slug. These rules are what keep a user's training
history intact across a revision. Breaking them silently destroys data that cannot be
reconstructed.

Every slug is declared exactly once, in `exercises` — including movements that appear only
as substitutes. That catalogue is therefore the only place you need to look to check you
have preserved them all.

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
- A `substitutes` entry not defined in the `exercises` catalogue
- `sets` on an exercise inside a `type: rounds` block
- `rounds` missing on a `type: rounds` block, or `rounds` on any other block type
- Block-level `rest_sec` on a block that is not `type: rounds`
- Duplicate `id` in the catalogue, or a duplicate session `key`
- `version` not greater than the current stored version for that `plan.slug`
- `changelog` missing or empty when `version` is above 1

Warnings — surfaced in the diff review but not blocking:

- A slug in the previous version is absent from the new one (possible rename or removal)
- A new slug closely resembles an existing one (possible accidental rename)
- A catalogue entry referenced by no prescription and no `substitutes` list
- A metric key has disappeared, orphaning its history
