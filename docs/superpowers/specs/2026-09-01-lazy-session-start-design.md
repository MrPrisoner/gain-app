# Lazy session start

Temporary design doc. Delete it when the work lands, folding the durable half into
`docs/UI.md` §2 and `docs/ARCHITECTURE.md` §9 as described in "Folding back in" below.
Supersedes `docs/todo-discard-session.md`, which framed this as a discard feature; that
doc is deleted by the same commit.

## The problem

Opening the session runner writes a `start` op immediately, in a `$effect` that runs on
mount before the user has touched anything
(`src/routes/plan/[slug]/session/[key]/+page.svelte`). Replay turns that into a `workout`
row with `status = 'partial'`, because the schema has no in-progress state
(`startWorkout`, `src/lib/db/workout.ts`). So a session someone opened to look at — to
check what is in it, to show it to somebody — is indistinguishable from a session they
started and abandoned.

That is not only a tidiness problem in History. It is load-bearing in two places that
change what the user sees and what the next AI is told:

- **`suggestNextSession` advances its rotation cursor.** It deliberately ignores status
  (`src/lib/home/next-session.ts`), because a red-flag stop was still an attempt. Peek at
  session B and Home now suggests C.
- **The export's Adherence table counts it as a Partial** for that session
  (`src/lib/export/summary.ts`). The reviewing AI reads a partial as an abandoned session
  and may deload against it. Nothing in the loop catches that; it is the same class of
  failure as UI §7's "a deviation that writes its row and leaves the runner untouched" —
  a wrong claim reaching the next revision, silently.

The codebase is already inconsistent about whether an unfinished workout counts:
`last-done` (`src/lib/db/home.ts`) and `session-stats` (`src/lib/progress/session-stats.ts`)
both filter on `completed_at IS NOT NULL`; `next-session` and the export summary do not.

## The decision

**Nothing about a workout is persisted until the first workout-scoped write.**

Opening the runner mints three things in memory and persists none of them: the workout's
`client_id`, a fully-built `start` op, and `startedAt`. The first op the user actually
causes — a set, a metric, a deviation, a finish — drags the `start` op into the outbox
ahead of itself and writes the `localStorage` resume key.

This is UI §2 extended one level up. Effort is already the commit action for a *set*;
it becomes the commit action for the *workout*. There is no new destructive control, no
server-side delete path, and no need to teach the outbox how to cancel a queued op —
which matters, because ops leaving the outbox by any route other than an ack or a
generation reset is exactly what `src/lib/sync/idb.ts` documents as impossible on purpose.

**Rejected: an explicit discard control** (the framing `docs/todo-discard-session.md`
carried). It treats the symptom. It also has to answer a question with no good answer —
what discard means once a set is logged — and it has to cancel a queued `start` op
offline, which means adding a third way for an op to leave the outbox. Lazy start makes
all of that unnecessary for the case that actually happens.

**Rejected: an in-progress workout status.** It fixes the reporting without fixing the
cause, needs every reader to opt in one at a time, and leaves a row behind for a session
that never happened.

## 1. The gate lives inside `logWrite`

Six components call `logWrite` (`+page.svelte`, `LogStrip`, `ExerciseCard`,
`DeviationSheet`, `WrapUpSheet`, and `MetricRow` in `$lib/components/`). The runner arms a
deferred start at mount; `logWrite` sees an op whose `workoutClientId` matches an armed
start, appends the start first, and disarms. **No call site changes.**

Rejected: threading a wrapper prop down through three levels of six components, and
ensuring the start at each call site separately. The second is six places to get right
and six places for the next feature to forget — this rule has to hold for ops that do not
exist yet.

The rule itself is a pure module, `src/lib/sync/deferred-start.ts`, unit-tested without a
browser; `client.svelte.ts` holds only the register and the call into it. That follows the
repo's standing split — `queue.ts` holds the outbox's rules as pure functions and `idb.ts`
implements the store — and it is the same reason there are no component tests here.

**The disarm needs an explicit way out of every state it can enter.** It disarms on the
first write, and on the runner's effect cleanup when the page is left. A leaked armed
start is harmless in itself — a `client_id` nothing will ever write against — but leaving
module-level state with no exit is precisely how `client.svelte.ts`'s `needs-auth` got
stuck forever (CLAUDE.md, "Rules learned the hard way").

## 2. The start op is minted whole at mount, not at commit

Its `id` must sort below every op it precedes. `planBatch` sorts a batch by ULID
(`src/lib/sync/queue.ts`) and that ordering is load-bearing; if the start op were minted
at commit time it would sort *after* the set that triggered it, replay would throw
`NotYetError`, and every session would cost a wasted round trip before its first set
landed.

Minting the op whole at mount makes the ordering free, because ULIDs are monotonic: every
op created later is automatically higher. It also settles `startedAt` with no extra state.

**`startedAt` is screen-open time.** Warm-up and setup are genuinely part of a session,
and this keeps the export's duration figures comparable with every workout already logged;
stamping at first write would silently narrow duration to first-set→finish for all future
sessions and make the series discontinuous. The hazard that reading suggests — peek at
9am, train at 6pm, log a nine-hour workout — cannot happen, because a peeked session
persists nothing, so the 6pm visit is a fresh mount that re-mints all three values.

## 3. Every workout-scoped op ensures the start, with no exceptions

Including `finish`. A user who opens a session and taps End session → Finish without
logging anything must still produce a workout: today they do, and more importantly a
finish op that reached the server with no workout would throw `NotYetError` forever with
no start op left in the outbox to rescue it — a permanently-pending op, which
ARCHITECTURE §4 forbids.

So the rule takes no argument about which ops are "real effort". Any op carrying a
`workoutClientId` ensures the start first. One rule, no special cases, no list for a
future op kind to be left off.

## 4. What this removes

`+page.svelte`'s `{#if !workoutClientId}` "Starting your session…" placeholder exists
because the mount effect awaits an IndexedDB write before the id is safe to render
against. A fresh session now has its id synchronously, so that branch is only reachable on
the resume path, which still awaits server hydration. The placeholder narrows to the case
it was actually for.

## 5. The cleanup migration

`MIGRATION_003` deletes `workout` rows that are provably peeks: no `set_log`, no
`deviation`, no `metric_value`, `completed_at IS NULL`, **and `started_at` older than 24
hours.** Those are the only three tables with a foreign key onto `workout`
(`src/lib/db/schema.ts`), so a row passing that test is referenced by nothing.

**The age floor is load-bearing, not caution.** Migrations run lazily per user on that
user's next request (ARCHITECTURE §5, "Migration policy"), and `POST /api/sync` is one of
those requests. Without the floor: a user starts a session under the old code, the start
op syncs and is acked out of the outbox, the container restarts, and their first set
arrives — the sync request migrates first, deletes their live empty workout, then replays
the set, which resolves no workout and throws `NotYetError`. Transient, so never
quarantined; retried forever, with the start op already gone. A 24-hour floor closes that
window completely, since no live session is a day old, and every genuine peek is in the
past by the time anyone's database is migrated.

Comparison is against `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')` so the string
matches `started_at`'s `toISOString()` format. A bare `datetime('now')` yields
`YYYY-MM-DD HH:MM:SS`, which sorts wrong against an ISO string and would silently delete
either everything or nothing.

The migration is one-shot per user and does not need to be repeatable: lazy start means no
new peek rows are ever created after it runs.

**This is the first migration in the project to delete user data**, and it is worth
naming as such. It is narrow by construction — the emptiness test is what makes the
deletion provably lossless, since a row with no set, no deviation and no metric recorded
nothing that could be lost. It is not a precedent for deleting rows that hold anything.

## 6. Testing

- **Unit, `tests/sync/deferred-start.test.ts`** — arm, then the first op emits
  start-then-op in ULID order; a second op emits only itself; disarm is idempotent; an op
  whose `workoutClientId` does not match an armed start passes through untouched.
- **DB, `tests/db/`** — the migration deletes an old empty workout; spares one with a
  single `set_log`; spares one with only a `metric_value`; spares one with only a
  `deviation`; spares a fresh empty one inside the 24-hour floor.
- **E2E** — open a session, log nothing, return home: assert no workout appears in
  History **and** that Home still suggests the same session. The rotation-cursor half is
  the one no unit test can see, and it is half the user-visible harm.
- **E2E, export** — a peeked session leaves the Adherence table's Partial count for that
  session unchanged. This is the harm that reaches the reviewing AI, so it gets its own
  assertion rather than being inferred from the History one.
- **E2E, offline project** — peek offline, reconnect, assert nothing syncs.

Assertions follow the standing rule about charts and summaries: assert on something that
only exists with data, never on a container that renders either way.

## Folding back in, on landing

- **`docs/UI.md` §2** gains the clause that effort commits the workout, not only the set,
  with the reason: a session that was only looked at must not be able to claim it happened.
- **`docs/ARCHITECTURE.md` §9, "Offline model"** gains the deferred-start rule, the
  ULID-ordering reason it is minted at mount, and the no-exceptions rule from §3 above.
- **`CLAUDE.md`** — the Invariants entry, if the ULID-ordering constraint proves to be the
  kind of thing that breaks quietly. Decide when the code exists, not now.
- **Delete** `docs/todo-discard-session.md` and this file, in the landing commit.
