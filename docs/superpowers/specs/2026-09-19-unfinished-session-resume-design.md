# Unfinished sessions: resume, or discard

Design, 2026-09-19. Tracking document — delete it when the work lands, folding the
durable half into ARCHITECTURE §9, UI, and CLAUDE.md's Invariants (see "Folding back in"
at the end).

## The problem

Start a session, log a few sets, close the app. Come back and GAIN suggests the *next*
session, as though the one just abandoned had been completed. Nothing anywhere indicates
an unfinished session exists. Tapping back into that session does silently resume it, but
only by accident of a `localStorage` pointer nobody is told about — and there is no way to
throw an unfinished session away.

## What the code actually does today

Worth writing down, because most of the machinery is already right and the defect is
narrow.

**The rotation cursor ignores completion.** `recentWorkoutsForPlan`
(`src/lib/db/home.ts`) selects every `workout` row for the plan regardless of
`completed_at`, and `suggestNextSession` (`src/lib/home/next-session.ts`) takes the most
recent of them as the cursor. Its comment reasons carefully about *status* — "a red-flag
stop was still an attempt" — but a workout that was never finished at all was never
distinguished, because the query does not read the column that would distinguish it. The
same source feeds the card's "Last session: A, today" line and each row's `lastDoneDate`,
so Home actively asserts a session happened.

**GAIN already has the concept, and Home is the only module not using it.**
`consistency.ts` and `session-stats.ts` both define "finished" as
`completed_at !== undefined`, and ARCHITECTURE §5 settles that in-progress is the absence
of `completed_at` rather than a fourth status.

**A `workout` row already means real effort.** Opening the runner persists nothing —
`$lib/sync/deferred-start.ts` arms the `start` op and the first write drags it in. So
there is no false-positive case to design around: if a row exists with a NULL
`completed_at`, the user logged something.

**The resume pointer is per-device and unannounced.** The runner keeps the workout's
`client_id` at `gain:workout:<planSlug>:<sessionKey>`
(`$lib/session/workout-storage.ts`). Resume works, but the ledger simply appears
pre-filled with no acknowledgement, and the pre-session metric gate is skipped without
explanation.

**Two failure modes not in the original report:**

- *Resume forks across devices.* On a second device the `localStorage` key is absent, so
  the runner mints a fresh `client_id` and the server ends up with a **second `workout`
  row for the same session** — one session's effort split across two rows in the export.
- *An abandoned session already reaches the reviewing AI.* Its sets are in the raw CSV and
  it counts as a Partial in the export's Adherence table with a blank duration
  (`summary.ts`, `bundle.ts`). That is honest and correct — the runner's own comment notes
  "the reviewing AI reads a Partial as a session the user abandoned." It means discard is
  not tidying up junk; it is destroying data the loop currently uses, which is why it needs
  a real confirmation.

**History lists it, ambiguously.** The list renders the bare `status` string, so a
workout abandoned mid-way and one finished with status `partial` both read "partial".

**Nothing deletes logged data anywhere**, except the admin account reset, which is nuclear
and bumps `data_generation`. Discard is the app's first surgical destructive operation.

## Decisions

Settled in discussion, 2026-09-19:

1. **Two actions, not three.** Resume and Discard. No "finish it late", no auto-close, no
   fourth `workout.status`. `completed_at` stays NULL on an abandoned workout forever,
   which is already what every consumer expects.
2. **Resume is time-limited; discard is not.** Within 12 hours of `started_at`, both
   actions. After that, discard only. If a session is not finished, the chance to finish
   it is lost, and that is by design.
3. **Discard is a hard delete.** The workout row and its `set_log`, `metric_value` and
   `deviation` children, plus every outbox op for that workout. Irreversible, confirmed
   before it runs. Chosen over a soft "discarded" status because a soft-deleted row that
   any one query forgets to filter feeds discarded data to the reviewing AI silently,
   and there is no filter to forget when the rows are gone.
4. **Inside the window, the unfinished session replaces the next-session suggestion.**
   Outside it, the two coexist. The asymmetry is deliberate — see §2.
5. **The card persists until discarded.** No fade, no expiry. Cleaning up is the user's
   call.

## Design

### 1. The rotation cursor reads finished workouts only

`suggestNextSession`'s cursor becomes **the most recent finished workout** — one with a
non-NULL `completed_at`, whatever its status. A red-flag stop still advances it, because
`finishWorkout` stamps `completed_at` on a stop. An unfinished workout never advances it,
at any age: there is no time branching here, only in the two places §2 and §3 need it.

This aligns Home with `consistency.ts` and `session-stats.ts`, which already apply exactly
this predicate, and it is the whole of the reported bug.

The user cannot be stranded by it. Abandon A and Home keeps suggesting A; finishing A at
any later point — by resuming it, or by starting it fresh once the window has passed —
produces a finished workout that advances the cursor normally.

`lastSession` and each row's `lastDoneDate` switch to the same predicate, so Home stops
claiming a session was done when it was abandoned.

**Changes:** one added column in `recentWorkoutsForPlan`'s SELECT
(`src/lib/db/home.ts`); `RecentWorkoutRef` gains `completedAt: string | undefined`; one
predicate in `src/lib/home/next-session.ts`, applied in three places (cursor, `lastSession`,
`overrides`).

### 2. Home: the unfinished-session card

One card per open workout, rendered per plan.

More than one is possible and must not be treated as impossible: once the window has
passed, starting session A again mints a fresh workout (§3), so a user who abandons A
twice has two open workouts for one session. At most one of them can be inside the
window, and that is the one that replaces the next-session card; every other open workout
renders as an aged-out notice above it, newest first. Nothing needs to reconcile them —
they are two honest attempts, and discarding is per workout.

**Within 12 hours of `started_at`** it replaces that plan's `NextSessionCard` entirely and
inherits its `SessionOverrideList`:

```
+----------------------------------+
| Home Training Plan               |
| A - Push - in progress           |
| 3 sets logged - started 14:02    |
|                                  |
| [      Resume A      ]  Discard  |
|                                  |
| > choose a different session     |
+----------------------------------+
```

Replacing rather than stacking costs almost nothing, because §1 means the next-session
card would be suggesting A anyway — both cards would be about the same session. What
replacement buys is that the user resolves the unfinished session before being offered
anything else.

Carrying the override picker over is the part that makes this safe. "I abandoned A this
morning, I will do B tonight" must not be a dead end, and hiding the only picker on the
screen would make it one.

**After 12 hours** it degrades to a slim notice and the normal card returns below it:

```
+----------------------------------+
| A - Push left unfinished         |
| 3 sets - Mon 14:02      Discard  |
+----------------------------------+
+----------------------------------+
| Home Training Plan               |
| ... normal next-session card ... |
+----------------------------------+
```

The asymmetry is load-bearing rather than cosmetic. If an unfinished session hid the
next-session card at *any* age, then — given decision 5, that the card persists until
discarded — an irreversible delete would become the only way to train again. Someone
standing in a garage with three-week-old debris would have to destroy data before GAIN
would let them start anything. A destructive action must never be the price of admission.

**Why the age is measured from `started_at`** and not from the last write: it is a column
the server already has, and the client can decode the identical number from the workout's
`client_id`, which is a ULID minted when the runner mounted. Both sides therefore agree
on the answer with no extra plumbing and no clock skew between them. A session that
legitimately runs more than twelve hours from its start does not exist.

**Colour.** This is outside the session runner, so UI §5's accent-only rule does not
apply and `--amber` is available in its ordinary "warning" sense. Keep it muted — a
border or a label, not an alarm. `--red` belongs on the discard confirmation, not on the
card.

Practically this is a prop shuffle rather than a rewrite: the new card takes over
`NextSessionCard`'s plan-name heading, and `SessionOverrideList` is rendered from either
parent.

### 3. Resume must stop forking, and must not resume a stale workout

Two fixes Resume cannot ship without.

**Carry the id.** The Resume link is `?resume=<clientId>`, and the runner adopts that id
into `localStorage` rather than minting a new one. Without it, Resume on a device that
never held the pointer mints a second `workout` row for the same session — the existing
cross-device fork, now reachable by a button that promises the opposite.

**Age-gate the pointer.** On mount, the runner decodes the stored `client_id`'s ULID
timestamp; if it is more than twelve hours old, it ignores the key and starts a fresh
workout. Without this, "Start A" past the window silently appends today's sets to a
days-old workout, and the export reports a multi-day session duration — a wrong number
reaching the reviewing AI, which is the failure the summary invariant exists to prevent.

The decoding and the comparison are a pure function taking an injected `now`, in its own
module beside `workout-storage.ts`, unit-tested at both sides of the boundary. The runner
also stops treating an aged-out pointer as a resume for the purposes of the pre-session
metric gate: a genuinely new workout asks its `prompt_when: start` metrics.

### 4. Discard

**Server.** One `IMMEDIATE` transaction in `$lib/db/workout.ts`: delete `metric_value`,
`set_log` and `deviation` by `workout_id`, then the `workout` row. Resolution is by
`client_id`, matching every other write path in that module.

**Client.** Purge every outbox record carrying that `workoutClientId` — pending and
quarantined alike, so discarding a workout whose ops were quarantined also clears the
quarantine banner — enqueue the discard op, and remove the `localStorage` key.
`OutboxStore` gains one method, `dropForWorkout(workoutClientId)`. It composes what
`forWorkout` and the delete-by-id path already do, but it gets its own name rather than
reusing `ack`, which means "the server confirmed this" and would be a lie here.

**The sync op.** A sixth kind in `$lib/sync/ops.ts`, carrying only `id` and
`workoutClientId`, so discard works offline like every other write.

Its replay (`$lib/sync/replay.ts`) is the one place this design deviates from an existing
rule, and deliberately: **a discard for a workout the server has never heard of is
success, not `NotYetError`.** Every other workout-scoped op calls `requireWorkout` and
throws `NotYetError` when the workout is missing, because the start op is still behind it
in the queue. A discard has no start op behind it — the purge above removed it — so
throwing would retry an unsatisfiable op forever and end in quarantine, which is exactly
the permanent-failure trap CLAUDE.md's offline section describes. "Nothing to delete"
means the job is done.

For the same reason the discard op must never drag an armed start into the outbox. In
practice it cannot: discard is reachable only from Home, and a start is armed only while
the runner is mounted. The constraint is worth stating anyway, because a future "discard
from inside the runner" would violate it.

**Confirmation.** A sheet, not `window.confirm`. The app already has the pattern three
times over (`DeviationSheet`, `WrapUpSheet`, `SymptomGuideSheet`): scrolls, takes focus on
open and returns it on close, traps focus while open, closes on Escape, honours
`env(safe-area-inset-bottom)`. It names what is being destroyed — "3 sets" — and says it
cannot be undone.

### 5. The offline-only path

Home is server-rendered, so a session logged in a garage and not yet synced is invisible
to a card derived from the database. That is precisely this app's core scenario, so the
server query is the source of truth and `localStorage` is the fallback.

On mount, Home reads every `gain:workout:*` key, derives `(planSlug, sessionKey,
clientId)` from the key and its value, decodes the start time from the `client_id` ULID,
and renders a card for any workout the server did not report. The set count comes from
the outbox via the existing `forWorkout`.

The key parsing and the merge are pure and unit-tested; the component reads their output.

## What this deliberately does not build

- **No "finish it late".** Considered and dropped: it needs an honest `completed_at`,
  and stamping `now` on a days-old workout puts a multi-day duration in the export.
- **No auto-close and no fourth status.** ARCHITECTURE §5's three statuses stand.
- **No discard from the history screen.** Home's card is the only entry point.
- **No change to how an abandoned workout appears downstream.** It stays a Partial with a
  blank duration in the export's Adherence table, and stays excluded from consistency and
  session-stats. That is already the honest record.

## Testing

| Level | What it proves |
| --- | --- |
| Pure (`tests/home/next-session.test.ts`) | The cursor skips an unfinished workout and still advances on a `stopped` one; `lastSession` and `lastDoneDate` ignore unfinished workouts |
| Pure (new, beside `workout-storage`) | The staleness gate, either side of the twelve-hour boundary, against an injected `now` |
| Pure (new) | `gain:workout:*` key parsing and the server/local merge |
| DB (`tests/db/`) | Discard clears all four tables in one transaction; an unknown `client_id` is a no-op; a partially-written workout leaves nothing behind |
| Sync (`tests/sync/`) | Replay of a discard for an absent workout returns `applied`, never `pending`; `dropForWorkout` removes quarantined records as well as pending ones |
| e2e (new `unfinished-session.spec.ts`) | Log two sets, go home, assert the card is shown and the suggestion is still A; resume and assert the ledger came back; discard and assert both the card and the rows are gone. A second case asserts the aged-out rendering with a seeded old workout |
| e2e (`offline` project) | Discard while offline purges locally and replays cleanly on reconnect |

The e2e assertions must key on content that only exists with data — a set count, a named
button — not on the card's container, per CLAUDE.md's rule about chart and summary shells
rendering unconditionally.

## Folding back in

When this lands, in the same commit: delete this document, and move the durable half into
the standing documents.

- **ARCHITECTURE §9** — the rotation cursor reads finished workouts only, and why an
  unfinished one never advances it.
- **ARCHITECTURE §9, "Resuming a workout"** — the twelve-hour gate on the `localStorage`
  pointer, and the reason (a stale resume puts a multi-day duration in the export).
- **UI** — the unfinished-session card: that it replaces the next-session card inside the
  window and coexists with it outside, and why a destructive action must never be the only
  way forward.
- **CLAUDE.md, Invariants** — the discard op's tolerance of a missing workout, which is the
  one deviation from `requireWorkout`/`NotYetError` and the one that breaks quietly if a
  later refactor "fixes" it for consistency.
- **Module doc comments** — `workout-storage.ts` for the staleness gate; `replay.ts` for the
  discard case.
