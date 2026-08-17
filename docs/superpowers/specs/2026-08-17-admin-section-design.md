# Admin section — operator view and per-user reset: design

**Status:** approved design, not yet planned or built.
**Date:** 2026-08-17.
**Contract:** ARCHITECTURE §2 decision 4, §3 ("Deployment", data directory layout), §4
("Authentication & identity"); `todo.md`'s "Admin section" item, which this spec replaces;
CLAUDE.md's "Isolation is physical, not a WHERE clause"; UI-DECISIONS §5 ("Colour is
reserved for meaning").

**Done when:** an operator signed in as a member of `OIDC_ADMIN_GROUP` can see every
registered user with a human-readable label and per-user counts, reset any one of them to
a clean slate, and that reset survives the wiped user reconnecting with a full offline
outbox — while no code path in the app can read another user's training content.

---

## 1. What this is, and what it overturns

GAIN is self-hosted. The person who runs the container is accountable for the data on
their volume, and today has no way to see who is using the instance or to give an alpha
tester a clean slate short of `docker exec` and `rm -rf`. This adds the smallest operator
surface that closes that: a list, some counts, and a reset.

It is the first feature in GAIN that reads across users, so it is also the first that has
to argue with a settled decision rather than implement one.

| Settled today | After this |
|---|---|
| §2 decision 4: "no admin role" | An optional operator role, gated on a second Authentik group |
| §4: "There is no admin role and no user-management UI" | There is one, and it can see counts and reset data |
| §4: "No user can read another user's data through any code path" | Still true. No path returns another user's training *content* — only counts, dates and bytes |
| §3/§4: `control.db` holds "nothing personal: no names, no emails" | Narrowed: `control.db` holds no *training* data. It gains one display label per user |
| CLAUDE.md: "There is no cross-user query because there is no cross-user database" | Still true of the domain model. One module opens each `gain.db` read-only and runs aggregates |

The isolation promise that survives, and that this spec exists to keep structurally
enforceable, is: **the operator sees that a user exists and how much they have logged, and
can destroy it; the operator can never read what it says.** No plan names, no exercise
names, no set logs, no metrics, no notes.

### The `control.db` narrowing, honestly stated

"Nothing personal in `control.db`" was already softer than it read: the `session` table
stores the raw `id_token`, which carries `name`, `preferred_username` and `email`. What
the rule has always actually protected is durable, queryable personal data outside the
user's own database. Adding `display_label` narrows that rule rather than breaching a
clean one, but it is a real change and §3 and §4 both get reworded rather than quietly
left to drift.

It earns the change because the alternative is worse. An operator looking at a list of
`01JAV...` ULIDs and opaque OIDC subjects cannot tell whose data a reset button is aimed
at, and would have to cross-reference Authentik by hand before every destructive action —
performing the risky identification step outside the app, with no confirmation to check
it against.

---

## 2. Decisions settled before design

1. **Admin identity is an Authentik group**, `OIDC_ADMIN_GROUP`, mirroring
   `OIDC_REQUIRED_GROUP`. It reuses the whole existing group pipeline — resolution at
   login, re-check on refresh, and the hard-won rule that an *unevaluable* answer is not a
   denial — and keeps §4's "access is administered entirely in Authentik" true. The
   rejected alternatives were an email in an env var (reintroduces email as an identity
   key, the exact thing §4 rejected because emails change) and a raw `sub` in an env var
   (correct, but requires digging an opaque UUID out of Authentik to configure).
2. **The user list shows a stored display label.** See §1 above.
3. **Delete means reset, not account deletion.** The `control_user` row survives. Full
   account deletion was rejected because the user is still in `OIDC_REQUIRED_GROUP`, so
   the next login re-provisions them under a *new* user id — the list entry reappears and
   the operator reasonably concludes the delete failed.
4. **No self-service wipe in this phase.** Deferred, not rejected; the server function
   is written so a later account screen can call it unchanged.
5. **A reset clears the wiped user's outbox without a confirmation dialog**, but does
   surface a one-line notice in the existing sync banner. The user knows their data is
   gone; they should not have to adjudicate a discard prompt about it. The notice exists
   because the operator may reset someone who did not ask for it.
6. **The destructive control may use red.** UI-DECISIONS §5 reserves green/amber/red for
   the plan's pain-response framework, but that framework lives in the session runner,
   progress and export — surfaces where a user reads their own body signals. `/admin`
   carries no symptom vocabulary at all, so there is no scale for red to compete with, and
   red is the correct and conventional signal for an irreversible destructive action. §5
   gains a second narrow exception, scoped to this control on this route.

---

## 3. Identity and authorization

`OIDC_ADMIN_GROUP` is optional. Unset means no admin exists and `/admin` 404s for
everyone, including in a correctly configured production instance — an operator who has
not opted in has no admin surface at all.

In bypass mode (`GAIN_DEV_USER`) there are no groups, so `OIDC_ADMIN_GROUP` is ignored and
`GAIN_DEV_ADMIN=1` is the only switch. `loadConfig` rejects `OIDC_ADMIN_GROUP` set without
a complete OIDC configuration, for the same reason it rejects a partial one: a variable
that looks like it grants access but silently does nothing is worse than an error at boot.

`GainConfig` gains `adminGroup: string | null` and `devAdmin: boolean`.

**Admin-ness is a property of the session, not of the user.** The `groups` array is
already resolved at login (`src/routes/auth/callback/+server.ts`) and again on every token
refresh (`refreshIfDue` → `resolveGroups` in `src/lib/server/auth.ts`). The callback
computes `hasRequiredGroup(groups, adminGroup)` and writes it to `session.is_admin`;
`refreshIfDue` rewrites it whenever `resolveGroups` returns a non-null answer, and leaves
it untouched when it returns `null`. Removing someone from the admin group therefore drops
their privilege at the next refresh, with no separate revocation path to forget.

There is deliberately no admin flag on `control_user`: no persisted privilege to leak, and
no way for the database to disagree with Authentik about who is an operator.

`SessionCheck` and `locals.user` gain `isAdmin: boolean`.

---

## 4. `control.db` migration 002

| Change | Notes |
|---|---|
| `control_user.display_label TEXT` | Nullable. `preferred_username ?? email ?? name`, rewritten on every login, so existing rows fill in as their owners return. `preferred_username` leads because it is what the operator already sees in Authentik's own user list. |
| `control_user.data_generation INTEGER NOT NULL DEFAULT 0` | Bumped on reset. See §7. |
| `session.is_admin INTEGER NOT NULL DEFAULT 0` | See §3. |

New functions in `src/lib/server/control-db.ts`: `listUsers`, `setDisplayLabel`,
`bumpDataGeneration`, `getDataGeneration`, `deleteSessionsForUser`, and `is_admin` handled
inside the existing `createSession` / `storeRefreshedTokens` pair.

The migration is additive `ALTER TABLE ... ADD COLUMN`, which the existing forward-only
runner in `openControlDb` applies without special handling.

---

## 5. Cross-user reads — `src/lib/server/admin-stats.ts`

A new module, and the only place in the app that opens a `gain.db` belonging to someone
other than the requesting user. Concentrating it in one file is the point: the isolation
guarantee becomes a property of the module boundary rather than a rule every future
feature has to remember.

- It opens `<dataDir>/users/<id>/gain.db` with `{ readonly: true }`, per request, closing
  every handle in a `finally`. It never calls `getUserDbFor`, so admin code never holds a
  writable handle to another user's data and never pollutes the process-wide handle cache
  with users the operator merely looked at.
- It runs only `COUNT(*)` and `MAX(...)`. No function it exports can return a row from a
  content table.
- A user directory that does not exist yet yields a zeroed record with
  `provisioned: false` rather than an error.

`UserStats` carries: `userId`, `displayLabel`, `oidcSub`, `createdAt`, `lastLoginAt`,
`plans`, `planVersions`, `workoutsStarted`, `workoutsFinished`, `setLogs`,
`lastWorkoutAt`, `diskBytes` (the recursive size of `users/<id>/`, so the plan documents
and archived exports are counted, not just the database).

At self-hosted scale — tens of users — opening and closing one SQLite handle per user per
page load costs nothing. The rejected alternatives were caching counters in `control.db`
(adds a write path from user code into the shared database, and drifts) and reusing
`getUserDbFor` (simplest code, but hands admin code a read-write handle to everyone's
training data, which is exactly the property this design is trying to make impossible).

**To verify during implementation, not assume:** a `readonly` open of a WAL-mode database
can fail with `SQLITE_CANTOPEN` when the `-shm` file does not exist and the connection
cannot create it — reachable for a user provisioned but never written to, or one whose
handle is not currently cached. This gets a test that exercises the cold case explicitly
and a defined fallback, rather than an optimistic `try`.

---

## 6. Reset — `src/lib/server/admin-reset.ts`

The sequence is load-bearing and gets a module comment saying so:

1. **Delete the user's sessions** (`deleteSessionsForUser`). Nothing authenticated can
   write after this point, and the wiped user's browser starts receiving 401s — which the
   phase-6 sync layer already handles by holding its queue rather than dropping it.
2. **Bump `data_generation`.**
3. **`evictUserDb(userId)`** — a new export from `app-state.ts` that closes the cached
   `better-sqlite3` handle and removes it from the map. This must happen *before* the
   unlink: `better-sqlite3` holds the file open, and on Linux `rm` then leaves the process
   writing to a deleted inode, so the reset appears to work and silently does not.
4. **`fs.rmSync(users/<id>, { recursive: true, force: true })`**, then verify the
   directory is gone. `force: true` is best-effort by design; a partial failure must be
   reported rather than followed by a re-provision on top of surviving files.
5. **Re-provision** via `getUserDbFor` — fresh `gain.db`, directories, seeded
   AI-instruction template. The user logs back in to a working empty instance, not a
   broken one.

An in-process `resetting: Set<string>` makes `getUserDbFor` refuse a user between steps 3
and 5. Sessions are already gone by then, so no *authenticated* request can arrive, but a
request already in flight can — and would re-open the handle mid-delete.

The function takes `userId` and nothing else, so a later self-service account screen calls
it unchanged.

---

## 7. Sync generation, and clearing quarantined ops

Without this section, a reset is not a reset. The wiped user's IndexedDB outbox still
holds ops from before the wipe; they flush on the next reconnect, fail against a plan that
no longer exists, and quarantine. Quarantined ops are held forever by design (CLAUDE.md:
"held, never dropped"), and there is currently **no UI to clear them** — the layout banner
only counts them. The user would be left with a permanent, undismissable "entries could
not sync" banner immediately after being given a clean slate.

- `syncBatchSchema` gains `generation: z.number().int().default(0)`. The default is what
  makes this safe to roll out: a stale cached client that does not send the field is read
  as generation 0, which is correct for every user never reset, and correctly rejected for
  every user who has been.
- `POST /api/sync` compares against `control_user.data_generation`. A mismatch answers
  `409 { error, dataGeneration }` and applies **nothing** — the batch is rejected whole,
  never partially.
- The client clears the outbox on a 409 — pending *and* quarantined records — stores the
  new generation, and surfaces one line in the existing layout banner: *"Your data was
  reset by the administrator."*

This is the one place GAIN deliberately discards local data, and it is a narrow, named
exception to phase 6's "never lose anything" rule rather than a softening of it: the ops
belong to a generation that no longer exists, and no reconciliation is possible.

**Separately, and fixing a pre-existing gap:** `outbox.clearQuarantined()` plus a
**Discard** control beside the quarantined count in the layout banner. A stuck banner is
the same bug whether a reset caused it or a removed exercise slug did, and the reset work
touches this code anyway.

---

## 8. Routes and UX

`/admin`, guarded in `+page.server.ts`. A non-admin gets **404, not 403** — a 403 confirms
the route exists and that this instance has an operator; a 404 says nothing.

The load returns the `UserStats` list, sorted by last login descending. The `?/reset`
action takes the target `userId` and a `confirmLabel` that must match that user's display
label (falling back to the last six characters of the ULID when the label is still null).
A mismatch returns `fail(400, { actionError })`. Nothing in the action throws except
`redirect` — phase 4's rule, and the stakes here are higher than a lost form field.

The page is a **card list, not a table.** A stats table cannot survive 360 px without
horizontal overflow, which UI-DECISIONS §12 forbids and `npm run test:e2e` asserts against
at three viewports. Each card carries the label, the OIDC subject in small monospace, the
dates, the counts and the size, and a Reset control that expands in place to reveal the
type-to-confirm field.

The destructive control is red, per §2 decision 6. UI-DECISIONS §5 gains a second narrow
exception recording that, scoped to this control on this route — not to `/admin` errors,
not to destructive actions generally, and explicitly not to anything on a surface that
renders plan or symptom data.

The header in `src/routes/+layout.svelte` gains an Admin link, rendered only when
`data.user?.isAdmin`.

---

## 9. Testing

Unit (`tests/`):

- `loadConfig` across the three shapes: admin group with complete OIDC (accepted), admin
  group without OIDC (rejected at boot), admin group in bypass mode (ignored, with
  `GAIN_DEV_ADMIN` as the only switch).
- `is_admin` lifecycle in `checkSession`: set at login, dropped when a refresh reports the
  group gone, **unchanged when `resolveGroups` returns `null`**. That last case is the one
  the phase-3 review was written about and the one most likely to regress.
- `admin-stats` against seeded databases, including the cold WAL case from §5, and an
  assertion that no exported function returns a content row.
- `admin-reset` ordering — assert the handle is closed before the unlink, and that
  `getUserDbFor` refuses the user mid-reset.
- Generation mismatch: `POST /api/sync` rejects the whole batch and writes nothing.

End-to-end (`e2e/admin-walkthrough.spec.ts`), at the three viewport projects: sign in as
an admin, see two users listed, reset one, confirm the counts zero out and the other
user's are untouched. It follows the per-viewport bypass-user isolation pattern
established in `dd543bc`.

**One wrinkle to resolve while planning:** `GAIN_DEV_ADMIN` is a server variable, so it
goes in `playwright.config.ts`'s `webServer.env` — which makes *every* dev-bypass user an
admin for that run. Whether that disturbs the existing specs needs checking before the
plan is written, not after the suite goes red.

---

## 10. Documentation on close

- `docs/ARCHITECTURE.md` — §2 decision 4 reworded; §3's data-directory layout annotated
  for `display_label` and `data_generation`; §4's closing paragraph rewritten around the
  distinction in §1 above; §12's build-order table gains the phase row.
- `README.md` — the isolation claim at line 84.
- `docs/UI-DECISIONS.md` — §5's second exception.
- `.env.example` and `compose.yaml` — `OIDC_ADMIN_GROUP`, and `GAIN_DEV_ADMIN` in the
  dev-only section.
- `CLAUDE.md` — a new invariant covering both halves: the operator sees counts and never
  content, and the reset sequence's order is load-bearing.
- `docs/ROADMAP.md` — a new phase 9, "Operations". Phase 8 (revision diff review, template
  editor) is unrelated and keeps its place as next.
- `todo.md` — the "Admin section" item is deleted, per that file's own rule that anything
  bigger than a single commit moves to the roadmap.

---

## 11. Out of scope

- Self-service data wipe (deferred; §2 decision 4).
- Full account deletion (rejected; §2 decision 3).
- Any operator view of plan content, exercise names, set logs, metrics or notes.
- Editing another user's data. The only write the operator has is destroying all of it.
- Per-user quotas, rate limits, or disabling an account. Access is Authentik's job.
- Audit logging of admin actions. Worth revisiting once there is more than one admin
  action; not worth a table for a single button.
