# Phase 6 — Offline PWA: design

**Status:** approved design, not yet planned or built.
**Date:** 2026-08-12.
**Contract:** ARCHITECTURE §4 ("Offline reality"), §9 ("Offline model", "Resuming a
workout"), §12 phase 6; `docs/ROADMAP.md` phase 6; AGENTS.md, "Offline is a hard
requirement, not a nicety".

**Done when:** an airplane-mode session syncs cleanly on reconnect, the property tests
pass, and a workout survives a full browser kill.

---

## 1. The gap this phase actually closes

The roadmap's phrasing — "IndexedDB as the workout store" — reads as though a client-side
store exists and needs persistence added underneath it. It does not. **Every write in the
session runner is a SvelteKit form action.** All six components under
`src/routes/plan/[slug]/session/[key]/` post to `?/logSet`, `?/logMetric`,
`?/logDeviation`, `?/start` or `?/finish` through `use:enhance`, and read the result back
through `applyAction`. The runner's local store *is* the server round-trip.

So phase 6 is not "add persistence". It is "introduce a client write layer, and make the
server a replay target for it". The server half of that is largely done — every
client-written table carries `client_id TEXT UNIQUE`, `src/lib/db/workout.ts` returns the
existing row rather than inserting a second one, and `src/lib/server/gate.ts` answers a
non-navigation request with 401 rather than a body-discarding 303. This phase is the
client, plus the endpoint that lets the client speak to the existing write layer in
batches.

### What already exists and must not be rebuilt

- `src/lib/db/workout.ts` — `startWorkout`, `finishWorkout`, `logSet`, `logMetric`,
  `logDeviation`, each idempotent on `client_id`. These are the replay primitives.
- `src/lib/session/resume.ts` — `hydrateSession`, pure, unit-tested, reconstructs the
  full runner ledger (cursor, skips, swaps, set-count deltas, round in progress, answered
  wrap-up metrics) from plain rows.
- `src/lib/db/workout-history.ts` — `workoutHistoryFor`, whose rows are already keyed by
  **exercise slug** and ordered by **ULID**, not by server id and not by timestamp. This
  is the hinge the whole design turns on; see §5.
- `src/lib/server/gate.ts` — `isNavigationRequest`, already written for this phase.
- `static/site.webmanifest`, linked from `src/app.html`.

---

## 2. Decisions settled before design

| # | Decision | Rejected alternative |
|---|---|---|
| 1 | A client sync module writing to IndexedDB, flushed to a batch endpoint | A service worker intercepting the form POSTs and synthesising SvelteKit `ActionResult` responses |
| 2 | A session can be chosen, started, run and completed entirely offline | Offline only continues a session started online |
| 3 | `fast-check` as a devDependency for the replay property tests | Hand-rolled generators |
| 4 | Offline e2e on a built server with a persistent context; container restart automated only if the offline project self-manages its server | Extending the existing dev-server harness |
| 5 | Prefill may be stale during an offline streak; accept and document | Merge the unsynced outbox into prefill |
| 6 | Delete the runner's form actions in the same phase | Leave them beside the new path |
| 7 | Precache the routes' `__data.json`, version-keyed | Move the runner's `load` to a universal `+page.ts` with an IndexedDB fallback |

On (1): the rejected option needs no component changes, but it puts the hardest logic —
fabricating a framework's private wire format — in the least testable place in the stack.
The chosen option keeps the logic in `$lib` where the rest of this repository's logic
lives, unit-tested and property-tested without a browser.

On (5): prefill is a *suggestion*, and the ledger stores what was submitted rather than
what was offered (AGENTS.md, "What the phase-4 review changed"). A stale prefill can
therefore never reach the export or the reviewing AI — it is a visible, one-tap-correctable
annoyance, not the silent-wrong-number class of failure. It also stays cheap to add later:
`pickPrefill` is pure over plain rows, so merging the outbox is a longer input array rather
than a second implementation.

On (7): a shape change in `__data.json` is a loud failure — typecheck and the offline e2e
break at once — **provided the data cache is version-keyed like the shell cache.** Without
that, a stale precached payload can outlive the build that understands it, which is the one
variant of this risk that fails quietly.

---

## 3. Architecture

```
component --> logWrite(op) --> IndexedDB outbox --> flush --> POST /api/sync
                                                                  |
                                                             replay(ops)
                                                                  |
                                                          src/lib/db/workout.ts
                                                                  |
                                                              gain.db
```

| Module | Responsibility | Tested by |
|---|---|---|
| `src/lib/sync/ops.ts` | Op types and their Zod schema. Pure | Unit |
| `src/lib/sync/queue.ts` | Enqueue, batch, ack, quarantine — over an injected store interface, no IndexedDB import | Unit |
| `src/lib/sync/idb.ts` | The IndexedDB implementation of that interface | e2e |
| `src/lib/sync/client.ts` | Flush loop, `online`/`offline` events, backoff, 401 state, reactive status for the banner | e2e |
| `src/lib/sync/history.ts` | Outbox ops to `WorkoutHistory` — the adapter of §5 | Unit |
| `src/lib/sync/replay.ts` | Server: an ordered op list to `workout.ts` calls | Property + unit |
| `src/routes/api/sync/+server.ts` | Auth, parse, one `IMMEDIATE` transaction, per-op ack | Unit |

The six runner components lose their `<form action="?/...">` wrappers and call `logWrite`.
The corresponding actions in `+page.server.ts` are deleted in the same phase — two write
paths, one of them dead, is how the next agent picks the wrong one. `?/start` is the
exception and is discussed in §5.

---

## 4. The op format

Every op carries **slugs and client-generated ULIDs, never a server id.** The server
resolves `exerciseSlug` to `exercise_def_id` and `workoutClientId` to `workout.id` at
replay. This is the property that makes an op composable on a device that has never spoken
to the server about this workout.

```
StartOp     { kind: "start",     id, workoutClientId, planVersionId, sessionKey, startedAt }
SetOp       { kind: "set",       id, workoutClientId, exerciseSlug, setNo, side?, reps?,
                                 weightKg?, durationS?, difficulty? }
MetricOp    { kind: "metric",    id, workoutClientId, scope, exerciseSlug?, setClientId?,
                                 metricKey, valueNum?, valueText? }
DeviationOp { kind: "deviation", id, workoutClientId, exerciseSlug, deviationKind,
                                 reasonCode?, note?, substituteExerciseSlug? }
FinishOp    { kind: "finish",    id, workoutClientId, status, note?, finishedAt }
```

`id` is the op's own ULID and becomes the row's `client_id`. `workoutClientId` is the
`StartOp`'s `id`.

Two fields exist because of two bugs this design found in the current server actions, both
of which are latent today and fatal once writes can be deferred:

**`startedAt` and `finishedAt` are the client's clock.** `startWorkout` and `finishWorkout`
currently take `now: new Date()` and stamp server time. A session logged on Tuesday and
synced on Friday would be dated Friday. The export's progress summary requires that "first"
and "latest" are chronological (AGENTS.md, Invariants), and a summary built on sync time
rather than training time reports a plausible wrong number to the reviewing AI. The client
clock is untrusted in general but entirely trusted here: physical per-user isolation means
there is no other user's data for a skewed clock to corrupt.

**`planVersionId` travels with the start op.** The `?/start` action resolves the plan's
*current* version at write time. If a revision is imported while a workout sits queued,
that workout silently rebinds to a plan version it never ran under — which breaks §8's
guarantee that a workout is bound to the version it was logged under, and quietly
misattributes history. The runner's `load` payload must therefore expose the version id it
resolved; it currently returns the resolved session but not the version's identity.

`setClientId` on `MetricOp` covers `scope: "set"`, which **no component logs today** —
`MetricRow` is used only by the pre-session gate and the wrap-up sheet, both session scope.
It is specified now anyway, because the alternative is a server-id dependency
(`?/logSet` returns `setLogId`, which a set-scope metric would then post back) that cannot
survive offline and would force this format to change the day the feature lands.

---

## 5. Who owns the in-progress workout

**IndexedDB is authoritative.** On mount, the runner reads its local ops for this workout
and rebuilds the ledger locally. The `?/start` server hydration path survives, demoted to a
fallback for a device with no local record — a different browser, or cleared storage.

The rebuild reuses `hydrateSession` rather than reimplementing it. `WorkoutHistory`'s rows
already carry `exerciseSlug` and are ordered by a ULID `id`, which is exactly what the
outbox holds: `src/lib/sync/history.ts` is a projection from ops to those three arrays, and
nothing in `resume.ts` changes. The local path and the server path then produce the same
ledger by construction rather than by agreement, which is the same reasoning that puts
double-progression state in one module in phase 7.

**The ops are the only persisted truth. The ledger is derived and never stored beside
them.** Persisting both would be faster to mount and would eventually diverge.

`sessionStorage` and the `gain:workout:<slug>:<key>` key it holds are removed — IndexedDB
subsumes them, and surviving a browser kill is precisely what `sessionStorage` cannot do.

---

## 6. Replay semantics

- Ops are ULIDs, so they are monotonic per client and sort lexicographically. The outbox is
  append-only and **replayed in order**. That ordering is the guarantee `logMetric`'s
  existing comment says the queue owes it: two corrections to the same metric delivered out
  of order would otherwise land on the earlier answer.
- A batch is replayed inside one `IMMEDIATE` transaction and acked per op.
- Replaying an already-applied batch is a no-op on every `client_id`, so a lost ack costs
  nothing and the client may retry freely.
- Last-write-wins on the workout record, union on set logs (§9) — both fall out of the
  above rather than needing their own mechanism.

**The poison-op rule.** An op that can never succeed — an `exerciseSlug` a plan revision
removed, a payload that fails its schema — is **quarantined**: retained, marked failed, and
surfaced in the UI. It is not retried forever and it is *never* discarded. A single
undeliverable op must not block every op behind it, and dropping it is the same loss §4
forbids on a 401. This is the one place where "hold everything" and "never lose anything"
conflict, and it is resolved in favour of keeping the data and telling the user.

---

## 7. Offline reads

`src/service-worker.ts`, on SvelteKit's built-in `$service-worker` module. **No new runtime
dependency**; the caching policy here is specific enough that a Workbox recipe would not
help.

- Cache-first for `build` and `files` — content-hashed, so staleness is impossible.
- Network-first with cache fallback for navigations.
- **Route data:** when online, precache `/plan/<slug>/session/<key>/__data.json` for every
  session of the current plan. Four URLs for the fixture; a `cache.addAll`. This is what
  makes decision (2) real — a session can be chosen and started with no connection — and it
  requires no change to `+page.server.ts`.
- Every cache, data included, is keyed on `$service-worker`'s `version`, and stale caches
  are deleted on activate. See §2 (7) for why this is the load-bearing part.
- Any other navigation that misses the cache falls back to an `/offline` page stating
  plainly that GAIN needs a connection for this screen and that logged sessions are saved
  and will sync.

---

## 8. The 401 state

`/api/sync` answers 401 through the existing gate. The client then marks the queue as
needing auth, stops flushing, and the banner in `src/routes/+layout.svelte` reads
*"Signed out — your workout is saved. Reconnect to sync"*, with a control that navigates to
`/login`. Navigating away mid-session is safe precisely because IndexedDB is authoritative.

**The outbox is never cleared on a 401, on any error, or on sign-out.**

The banner lives in the layout rather than the runner because a queue can be pending on any
screen, and a sync state visible only where it was created is a sync state nobody sees.

---

## 9. Testing

**Unit.** `queue.ts` against a fake store; `ops.ts` schemas; `history.ts` against
`hydrateSession`'s existing fixtures; the `/api/sync` endpoint's auth and 400 paths.

**Property (`fast-check`)** over `replay()` against an in-memory SQLite. For any
permutation, subset or duplication of a valid op log:

- no duplicate `set_log` rows;
- no op silently lost, given the complete log;
- ordered replay's final state reproduced for order-independent ops.

**End-to-end.** A new `offline` Playwright project against a *built* server (`node build`
with `ORIGIN` set — the existing harness runs `vite dev`, where `$service-worker`'s `build`
manifest is empty), using `launchPersistentContext` so IndexedDB survives a context close.

- Airplane mode: seed a plan, go offline, choose a session, log it end to end, reconnect,
  and assert it appears in the export.
- Browser kill: log part of a session, close the persistent context, reopen, and assert the
  ledger, cursor, skips and swaps are intact.
- Token expiry: expire the session mid-workout, assert the banner appears and nothing is
  lost, re-authenticate, assert the queue drains.
- Phone lock is approximated by `visibilitychange`; container restart is automated only if
  the offline project self-manages its server, and is otherwise a documented manual check.

---

## 10. Manifest

`start_url`, `scope`, `id` and a maskable icon `purpose` are added. GAIN currently looks
installable and is not offline-capable, which is the worst of both.

---

## 11. Out of scope

- Merging the outbox into prefill (§2, decision 5).
- Multi-device concurrent editing. §9 settles that there is no such case worth solving.
- Background Sync API registration. The flush loop runs on `online` events and app open;
  Background Sync is a progressive enhancement that can be added without changing the queue.
- Offline export, import or home. Those need the server, and get the `/offline` page.
- The `block_key` column `resume.ts` documents as the fix for its one known imprecision.
  It is a CONTRACT plus schema plus fixture change, and it is not this phase's business.
