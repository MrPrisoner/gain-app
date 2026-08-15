# Phase 7a — Home, the today screen: design

**Status:** approved design, not yet planned or built.
**Date:** 2026-08-15.
**Contract:** ARCHITECTURE §9 ("Home", "Post-session"), §12 phase 7; `docs/ROADMAP.md`
phase 7, items 6–8; CLAUDE.md, "Offline is a hard requirement".

**Done when:** the Home screen suggests the right next session for the fixture plan's
`scheduling.sequence`, an activity row can be created from the app and reaches the
export's activities CSV, and a plan declaring a `next_morning` metric collects one.

---

## 1. Why phase 7 splits, and why this half goes first

ROADMAP's phase 7 is two subsystems sharing a route. One is read-side analytics — the
double-progression module, per-exercise and per-session charts, metric trends, workout
history. The other is the front door: the suggested next session, one-tap activity
logging, and the `next_morning` prompt. They share no code beyond the screen that links
to them, and the second is where three of §9's promises currently go unkept.

Home goes first because the analytics screens need somewhere to be reached from. Built in
the other order they are orphan routes, reachable only by typing a URL, and the phase
would end with a front door that still lists four sessions in plan order and calls that a
day.

### What already exists and must not be rebuilt

- `src/lib/db/read.ts` — `listPlans`, `getCurrentVersion`, `contractOfVersion`. The
  contract is stored as JSON on the version row, so a workout's own plan version yields
  its metric definitions without a second table read.
- `src/lib/sync/` — the outbox, the flush loop, `planBatch`/`applyAck`, and
  `POST /api/sync`. This phase adds one op kind to a working pipeline; it builds no new
  transport.
- `src/lib/sync/idb.ts` — the object store is keyed on `op.id` with a secondary index on
  `op.workoutClientId`. An op lacking that field is simply absent from the index, which
  is exactly the behaviour an activity op needs.
- `src/lib/db/workout.ts` — the idempotent-on-`client_id` write primitives. `logActivity`
  joins them and follows their shape.
- `src/lib/export/csv.ts` — already emits an `activities` CSV. The export format has been
  writing a cheque no UI could cash since phase 1; this phase cashes it.
- The parser already validates that every key in `scheduling.sequence` and
  `scheduling.drop_order` resolves to a declared session (`src/lib/contract/schema.ts`,
  `checkSessionRefs`). The suggestion logic may treat sequence entries as real sessions
  without re-checking.

---

## 2. Decisions settled before design

| # | Decision | Rejected alternative |
|---|---|---|
| 1 | Phase 7 splits; Home ships first | One spec covering all eight roadmap items |
| 2 | `/` is reworked into a today screen | A card bolted on top of the plan overview; a separate `/today` route |
| 3 | Activity logging goes through the sync outbox as a sixth op kind | A server form action, online-only |
| 4 | Tapping a kind opens a detail sheet; the op is written on submit | One tap writes immediately, details edited afterwards |
| 5 | Any workout advances the sequence cursor, including a red-flag stop | A stop re-suggests the same session; a stop suppresses the suggestion |
| 6 | The `next_morning` prompt covers the previous calendar day only, and is dismissible | A multi-day window; a non-dismissible card |
| 7 | `scheduling.rules` and `drop_order` render verbatim as advisory text | Automating them |

On (4): the first instinct was a literal one-tap write with the details editable
afterwards, which forces an awkward rule — an activity is editable only while its op is
still in the outbox, because amending a synced row needs an update op nothing else in the
app has. A sheet before submit dissolves the problem rather than managing it. The op
carries its full payload at write time, there is no edit window to explain, and the sheet
doubles as the confirmation that the tap registered.

On (7): the fixture's rules are judgements GAIN cannot make — "if a second squash session
lands in a week, drop D" requires knowing how much squash the week held, which is
precisely the information the app does not have. Rendering them as text puts the decision
where it belongs. Automating half of them would be worse than automating none, because
the user could no longer tell which half.

---

## 3. Architecture

Pure logic in `$lib`, one read module, a thin route — phases 4 and 6's shape.

```
src/lib/home/next-session.ts    suggestNextSession()   pure
src/lib/home/activity-kinds.ts  suggestActivityKinds() pure, owns a slugify
src/lib/home/next-morning.ts    dueNextMorningPrompts() pure, browser clock
src/lib/db/home.ts              homeSnapshot()          one read per plan
src/lib/db/workout.ts           logActivity()           the activity table's first writer
src/lib/sync/ops.ts             activityOpSchema        the sixth op kind
src/lib/sync/replay.ts          case "activity"
src/routes/+page.*              the today screen
```

### The screen

Top to bottom: a due `next_morning` prompt, the suggested next session as the primary
action, the activity strip, the override list, then plan administration. `first_run` is
untouched.

The per-session block detail the current overview renders above the fold moves inside the
override list, collapsed. That listing is what makes the front door a catalogue: four
sessions, each spelling out its blocks and every exercise in them, is a reference
document on the screen whose job is to answer "what now". Nothing is removed — the paste
box and the export link stay reachable below the fold, which is also how phase 8's
revision import will be reached.

---

## 4. The suggested next session

`suggestNextSession({ contract, recentWorkouts })` returns the suggested session key, a
factual reason line, and the full override list. Pure, no clock.

The sequence is `contract.scheduling?.sequence`; a plan that declares none falls back to
session `order`. The cursor is **the most recent workout whose `session_key` appears in
the sequence**, and the suggestion is that entry's successor, wrapping at the end. With
no history at all, it is the first entry.

Two consequences worth stating, because both are deliberate:

**Any status advances the cursor.** A session that was stopped for a red flag was still
attempted, and GAIN has no basis for deciding whether repeating it is wise. The user who
wants to redo it picks it from the override list, which is what the override list is for.

**A workout on an unsequenced session is ignored for cursor purposes.** A plan may declare
sessions the sequence omits, and an override to one of those must not derail the rotation
— it is an extra, not a step. It still appears in the override list and still shows as the
last thing done.

The reason line claims only what GAIN knows: "Last session: B, Tuesday 12 August". Not
"you're due for C" and nothing inferred about readiness — the same restraint UI-DECISIONS
§8 settled for the celebration message.

`scheduling.rules` and `drop_order` render verbatim beneath, collapsed, under a heading
that marks them as the plan's words rather than the app's.

---

## 5. Activity logging

`activity.kind` is a free-form slug in the user's own vocabulary. GAIN ships no list of
sports (§9): hardcoding one would make every user whose sport is missing an "other", and
the plan's own `scheduling.rules` already name whatever the user actually does.

`suggestActivityKinds({ activities })` returns the kinds already used, most-recent-first,
deduplicated and capped at six, with `rest` always present — six chips plus a field fit a
360 px screen without wrapping into a grid that has to be scanned. A new kind is typed into a field and
slugified — no such helper exists in `$lib` today, so this module owns one, and it must be
the boring kind: lowercase, non-alphanumerics to hyphens, collapsed and trimmed. It mints
identifiers the export carries to an AI, so a surprising one is a surprising CSV column
value forever.

Tapping a kind opens a sheet: duration in minutes, intensity, note — all optional — and
**when**, defaulting to now with "earlier today" and "yesterday" alongside. The when
control is a small addition beyond what ROADMAP asks for and it earns its place: the
common case is logging last night's squash the following morning, and without it that row
reaches the export dated wrong. A wrong date in the activities CSV is a wrong input to
the next revision, silently.

Submit writes one `activity` op. Cancel writes nothing.

### The op

```ts
{ kind: "activity", id, activityKind, occurredAt, durationMin?, intensity?, note? }
```

No `workoutClientId`: an activity hangs off no workout, the `activity` table has no
workout foreign key, and the outbox's index on that field correctly skips the record so
`forWorkout` never returns one. Replay resolves nothing and depends on no prior op, so
unlike a `set` op it can never be `NotYet` — it either writes or it fails permanently.
`client_id` is the op id, as everywhere else, which is what makes a replayed queue write
one row rather than two.

The `never` exhaustiveness guard in `applyOp` turns a missing replay branch into a compile
error rather than an op reported as applied with no write behind it. That is the guard
doing the job it was added for.

### Deleting an activity is out of scope

Nothing in the app can delete or amend a logged activity, and this phase does not change
that. The sheet-before-submit design makes it far less surprising than the alternative
would have: the user confirms before anything is written. A delete path needs an op kind
with semantics — tombstone, replay ordering, what a delete for an unseen row means — that
no phase of the roadmap has asked for yet.

---

## 6. The next-morning prompt

A `next_morning` metric is worthless collected three days later, and wrap-up deliberately
does not ask for it (UI-DECISIONS §8). Nothing has ever picked it up, so the fixture plan —
which declares `symptoms_next_morning` — collects nothing.

**The server returns candidates; the browser decides what is due.** `homeSnapshot` returns
workouts finished within the last 48 hours together with their plan version's
`prompt_when: next_morning` session metrics and the `(scope, key)` pairs already answered
for them. `dueNextMorningPrompts` then filters to the previous calendar day using the
browser's clock.

The split is not fussiness. The container's timezone is not the user's, and "yesterday"
computed server-side is wrong for anyone who is not in it. It also makes the behaviour
testable: Playwright advances `page.clock` overnight and the prompt appears, with no dated
row to seed.

Answered metrics are matched on `(scope, key)`, never the bare key — a plan may legally
declare one key at both set and session scope, and the fixture declares `symptoms_during`
at both. Matching on the key alone would treat a set-scope answer as satisfying the
session-scope prompt.

Answering writes an ordinary session-scope `metric` op against the workout's `client_id`,
which the load hands down. **No new op kind is needed.** A workout whose `client_id` is
null — possible for a row created before phase 6 — is not offered, because there is no way
to address it offline.

Dismissal is local and permanent for that workout: the window is one day, so the state
cannot accumulate.

---

## 7. Reads

`homeSnapshot(userDb, { now })` does one pass per non-archived plan and returns the
current version's contract, the last ~10 workouts (the cursor, plus the "last done"
labels), the last ~20 activities (kind suggestions and today's list), and the
next-morning candidates described above. Read-only, scoped to the user's own database —
isolation is physical, so there is no cross-user row to leak (ARCHITECTURE decision 4).

---

## 8. Testing

**Unit, against plain data:**

- `tests/home/next-session.test.ts` — sequence walk, wrap at the end, no-sequence
  fallback to `order`, a stopped workout advancing the cursor, an unsequenced override
  ignored by the cursor but present in the list, empty history.
- `tests/home/activity-kinds.test.ts` — recency ordering, deduplication, the cap, `rest`
  always present, and slugification including the awkward inputs.
- `tests/home/next-morning.test.ts` — the previous-day boundary either side of midnight,
  `(scope, key)` matching with a key declared at two scopes, an already-answered metric,
  a dismissed workout, a null `client_id`.

**Sync:** an activity op replayed twice writes one row; a batch mixing activity and
workout ops applies in ULID order. Extend `tests/sync/replay.property.test.ts` rather
than writing a parallel property test.

**e2e — `e2e/home-walkthrough.spec.ts`:** log session A through the existing helpers,
return home, assert the suggestion is B; open an activity sheet, submit with a duration,
assert the row survives a reload and appears in the export bundle; advance `page.clock`
overnight, assert the prompt appears, answer it, assert it does not return.
`assertNoHorizontalOverflow` at all three viewports in both themes (UI-DECISIONS §12).

---

## 9. Documentation on close

7a is half a phase, so the phase-level status stays as it is. ROADMAP ticks three items
with their SHAs. README's banner, CLAUDE.md's "Current state" paragraph and ARCHITECTURE
§12's "Done when" column all move when 7b lands and phase 7 actually closes.

---

## 10. Out of scope

Charts, the double-progression module, per-exercise and per-session progress, metric
trend rendering, and the workout history list — all phase 7b. Editing or deleting a
logged activity. Automating `scheduling.rules`. Browsing old plan versions and plan
archiving remain ROADMAP loose ends, owned by no phase.
