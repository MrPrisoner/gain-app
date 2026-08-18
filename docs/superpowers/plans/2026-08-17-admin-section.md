# Admin Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the self-hosting operator a `/admin` screen listing every registered user
with per-user counts, and a reset that wipes one user's training data to a clean slate —
without any code path that can read another user's training content.

**Architecture:** Admin-ness rides the existing OIDC group pipeline as a per-session flag,
never a stored user attribute. Every cross-user read is concentrated in one module that
opens each `gain.db` with a count-only query surface. Reset is an ordered sequence whose
order is load-bearing (close the handle before the unlink), and it bumps a per-user
generation counter that invalidates the wiped user's offline outbox so a reset survives
them reconnecting.

**Tech Stack:** TypeScript 6, SvelteKit (runes mode — `$state`/`$derived`/`$props`, never
`export let`), Zod 4 (`z.strictObject`, `error:` — never `z.object().strict()` or
`message:`), `better-sqlite3` 13, Vitest 4, Playwright.

**Spec:** [`docs/superpowers/specs/2026-08-17-admin-section-design.md`](../specs/2026-08-17-admin-section-design.md)

## Resuming this plan

This is built to run across several sessions. Everything a fresh session needs is here.

**Branch:** `feat/admin-section`, in the main checkout. **Do not use a git worktree** —
CLAUDE.md forbids it in this repo, because a session's history lives with the workspace
that was open when it ran, and moving the work into a worktree drops the session out of
the VS Code extension's history tab. That is precisely the failure mode a multi-session
build cannot afford.

**Opening message for a new session:**

> Continue `docs/superpowers/plans/2026-08-17-admin-section.md` on branch
> `feat/admin-section`. Use `superpowers:executing-plans`. Start at the first unticked
> task.

`superpowers:executing-plans` is the right sub-skill here, not
`superpowers:subagent-driven-development` — the latter is for running tasks inside one
session. Use it within a session if you like; the session-level frame is still the former.

**Tick the boxes, and commit the ticks.** The `- [ ]` checkboxes are the cursor: they are
the only thing that tells a fresh session where the work stopped. Every task's `git add`
line already includes this plan file for that reason — do not drop it when copying the
command.

**Never stop mid-task.** Each task ends with `npm run verify` and a commit, so every task
boundary is a known-good tree. Several tasks are *not* safe to stop inside: Task 2 adds a
required `isAdmin` to `createSession` and leaves two call sites broken until its step 6,
and Tasks 3, 6 and 7 have the same shape. If context runs short partway through a task,
either finish it or `git checkout .` and redo it fresh — a half-applied task costs the
next session more than a repeated one.

**Suggested batches**, each one coherent idea, all boundaries safe. Collapse them if a
session goes quickly:

| Session | Tasks | |
|---|---|---|
| 1 | 1–3 | Config and the auth spine. All server, no UI decisions. |
| 2 | 4–5 | The data layer: the count-only reader, then the destroyer. |
| 3 | 6 | The screen, alone — much the largest task, and the only one with design latitude. |
| 4 | 7–8 | Sync. Task 7 adds the interface methods Task 8 consumes; splitting them leaves a dangling API. |
| 5 | 9–10 | e2e, then docs. Needs `npx playwright install chromium` once (~150 MB), and the full run is slow because the `offline` project does a production build. |

**Do not re-derive settled facts.** The Global Constraints below and the corrections table
in the Self-Review at the end are load-bearing for a multi-session build: the table records
signatures and helper names that were verified against the codebase and that a plausible
recollection gets wrong. If something in this plan contradicts your memory of how this
repo works, read the file it names before changing the plan.

---

## Global Constraints

- **The operator sees counts, never content.** No function reachable from `/admin` may
  return a row from `plan`, `plan_version`, `exercise_def`, `version_*`, `prescription`,
  `set_log`, `metric_value`, `deviation`, `activity` or `ai_template`. Only `COUNT(*)`,
  `MAX(...)` and file sizes.
- **`control.db` holds no training data.** It gains exactly one display label per user and
  one integer generation. Nothing else personal is added.
- **A form action must never throw** except `redirect`. Every failure path returns
  `fail(400, { actionError })`. A thrown `Error` renders `+error.svelte` and destroys
  in-progress state.
- **An unevaluable group check is not a failed check.** When `resolveGroups` returns
  `null`, `is_admin` is left exactly as it was — never cleared.
- **No literal control characters** anywhere. Write `\u0000`, never the character.
  Enforced by `npm run check:chars` and the `gain/no-control-characters` ESLint rule.
- **No horizontal overflow at 360 px**, in both themes. `/admin` is a card list, not a
  table. Any grid uses `minmax(min(100%, <size>), 1fr)`; a bare `minmax(<size>, 1fr)`
  cannot shrink and is the phase-4 bug.
- **Red is permitted on exactly one control:** the reset button and the panel it sits in
  on `/admin`. Nowhere else — not the error inside that panel, not admin errors generally,
  not destructive actions elsewhere.
- **One type family, no monospace anywhere** (UI-DECISIONS §10). Figures that can be
  compared vertically get the `tabular` class. Absolute dates render ISO
  (`iso.slice(0, 10)`), matching `history/+page.svelte`.
- **Icons come from `~icons/lucide/*`** and carry no size or colour of their own;
  `app.css` sizes every `<svg>` at 1.15em. Never set `width`/`height` at a call site.
- **Colours come from the existing tokens** in `src/app.css` (`--ground`, `--surface`,
  `--raised`, `--line`, `--line-soft`, `--text`, `--muted`, `--dim`, `--accent`, `--red`).
  Do not add global tokens for one screen.
- **Run `npx prettier --write <file>` after editing any TypeScript/Svelte file**, and
  `npm run verify` before claiming a task is done.

---

### Task 1: Config — `OIDC_ADMIN_GROUP` and `GAIN_DEV_ADMIN`

**Files:**
- Modify: `src/lib/server/config.ts`
- Modify: `.env.example`
- Modify: `compose.yaml`
- Test: `tests/server/config.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `GainConfig.adminGroup: string | null` (the Authentik group name, only ever
  non-null when `auth.mode === "oidc"`) and `GainConfig.devAdmin: string | null` (the
  name of the bypass user who is admin, only ever non-null when `auth.mode === "bypass"`).

**Design note — `GAIN_DEV_ADMIN` names a user, it is not a boolean.** The spec floated
`GAIN_DEV_ADMIN=1`, which would make *every* dev-bypass user an admin and break e2e
isolation. `hooks.server.ts` already supports per-spec bypass users via the
`x-gain-e2e-user` header, so `GAIN_DEV_ADMIN=<username>` grants admin to exactly that one
bypass user and lets an e2e spec drive an admin and a non-admin in the same run.

- [x] **Step 1: Write the failing tests**

Add to `tests/server/config.test.ts`. The file already defines a `FULL_OIDC` constant and
imports `loadConfig` by relative path (`../../src/lib/server/config`) — reuse both rather
than introducing a second fixture or a `$lib` import this directory does not use.

```ts
describe("admin configuration", () => {
  const prodEnv = {
    ...FULL_OIDC,
    ORIGIN: "https://gain.example.com",
    SESSION_SECRET: "abc123",
  };

  it("carries the admin group when OIDC is complete", () => {
    const config = loadConfig({ ...prodEnv, OIDC_ADMIN_GROUP: "gain-admins" }, "production");
    expect(config.adminGroup).toBe("gain-admins");
    expect(config.devAdmin).toBeNull();
  });

  it("defaults to no admin at all", () => {
    const config = loadConfig(prodEnv, "production");
    expect(config.adminGroup).toBeNull();
  });

  it("refuses an admin group without a complete OIDC configuration", () => {
    expect(() =>
      loadConfig(
        { GAIN_DEV_USER: "dev", OIDC_ADMIN_GROUP: "gain-admins", SESSION_SECRET: "s" },
        "development",
      ),
    ).toThrow(/OIDC_ADMIN_GROUP/);
  });

  it("grants dev admin to the named bypass user only", () => {
    const config = loadConfig(
      { GAIN_DEV_USER: "dev", GAIN_DEV_ADMIN: "dev", SESSION_SECRET: "s" },
      "development",
    );
    expect(config.devAdmin).toBe("dev");
    expect(config.adminGroup).toBeNull();
  });

  it("refuses GAIN_DEV_ADMIN in production", () => {
    expect(() => loadConfig({ ...prodEnv, GAIN_DEV_ADMIN: "dev" }, "production")).toThrow(
      /GAIN_DEV_ADMIN/,
    );
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server/config.test.ts`
Expected: FAIL — `config.adminGroup` is `undefined`, and neither error is thrown.

- [x] **Step 3: Implement**

In `src/lib/server/config.ts`, add to the `GainConfig` type after `auth`:

```ts
  /**
   * The Authentik group whose members are operators (spec §3). `null` means this
   * instance has no admin at all and `/admin` 404s for everyone — an operator who has
   * not opted in has no admin surface.
   */
  adminGroup: string | null;
  /**
   * Dev-only: the single `GAIN_DEV_USER`-style name that is treated as an operator.
   * A name rather than a flag, so an e2e run can drive an admin and a non-admin at
   * once through the `x-gain-e2e-user` header. Refused in production, like the bypass
   * itself.
   */
  devAdmin: string | null;
```

Then, immediately after the existing `devUser` production guard:

```ts
  const devAdmin = env.GAIN_DEV_ADMIN?.trim() || null;
  if (devAdmin && isProduction) {
    throw new Error(
      "GAIN_DEV_ADMIN is set but NODE_ENV=production — it is a development tool and " +
        "cannot be enabled in a production build. Use OIDC_ADMIN_GROUP instead.",
    );
  }
```

After the `auth` assignment block closes, add:

```ts
  const adminGroup = env.OIDC_ADMIN_GROUP?.trim() || null;
  if (adminGroup && auth.mode !== "oidc") {
    throw new Error(
      "OIDC_ADMIN_GROUP is set but OIDC is not configured. A variable that looks like " +
        "it grants access and silently does nothing is worse than a startup error. " +
        "For local development, set GAIN_DEV_ADMIN to a GAIN_DEV_USER name instead.",
    );
  }
```

Add both to the returned object:

```ts
    adminGroup,
    devAdmin: auth.mode === "bypass" ? devAdmin : null,
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/server/config.test.ts`
Expected: PASS.

- [x] **Step 5: Document the variables**

In `.env.example`, in the OIDC section:

```
# Optional. Members of this Authentik group get the operator screen at /admin:
# per-user counts, and the ability to reset a user's data. Unset means this
# instance has no admin at all. Operators cannot read any user's training content.
OIDC_ADMIN_GROUP=gain-admins
```

And in the dev-only section at the bottom (the one `.env.local` is allowed to hold):

```
# Dev only. The GAIN_DEV_USER name to treat as an operator. A name, not a flag,
# so an e2e run can drive an admin and a non-admin at the same time.
GAIN_DEV_ADMIN=
```

In `compose.yaml`, add `OIDC_ADMIN_GROUP: ${OIDC_ADMIN_GROUP:-}` beside
`OIDC_REQUIRED_GROUP`.

- [x] **Step 6: Verify and commit**

Run: `npx prettier --write src/lib/server/config.ts tests/server/config.test.ts && npm run verify`
Expected: all green.

```bash
git add src/lib/server/config.ts tests/server/config.test.ts .env.example compose.yaml docs/superpowers/plans/2026-08-17-admin-section.md
git commit -m "feat(admin): add OIDC_ADMIN_GROUP and the dev admin switch"
```

---

### Task 2: `control.db` migration 002 and its accessors

**Files:**
- Modify: `src/lib/server/control-db.ts`
- Test: `tests/server/control-db.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `ControlUser` gains `display_label: string | null` and `data_generation: number`.
  - `SessionRow` gains `is_admin: number` (SQLite has no boolean; 0 or 1).
  - `createSession(control, { userId, now, idleMs, tokens, isAdmin })` — `isAdmin` is a
    new required field on the input object.
  - `listUsers(control: ControlDb): ControlUser[]` — every user, `last_login_at` DESC.
  - `setDisplayLabel(control: ControlDb, userId: string, label: string | null): void`
  - `setSessionAdmin(control: ControlDb, sessionId: string, isAdmin: boolean): void`
  - `bumpDataGeneration(control: ControlDb, userId: string): number` — returns the new
    generation.
  - `getDataGeneration(control: ControlDb, userId: string): number`
  - `deleteSessionsForUser(control: ControlDb, userId: string): number` — rows deleted.

- [x] **Step 1: Write the failing tests**

Add to `tests/server/control-db.test.ts`. Follow the existing file's setup for opening a
temp-directory control db.

```ts
describe("migration 002 — admin and generation columns", () => {
  it("defaults a new user to no label and generation 0", () => {
    const user = createUser(control, "sub-1", new Date("2026-08-17T10:00:00Z"));
    expect(user.display_label).toBeNull();
    expect(user.data_generation).toBe(0);
  });

  it("stores and overwrites a display label", () => {
    const user = createUser(control, "sub-1", new Date());
    setDisplayLabel(control, user.id, "alice");
    expect(getUserById(control, user.id)?.display_label).toBe("alice");
    setDisplayLabel(control, user.id, "alice.renamed");
    expect(getUserById(control, user.id)?.display_label).toBe("alice.renamed");
  });

  it("bumps the generation monotonically and reads it back", () => {
    const user = createUser(control, "sub-1", new Date());
    expect(bumpDataGeneration(control, user.id)).toBe(1);
    expect(bumpDataGeneration(control, user.id)).toBe(2);
    expect(getDataGeneration(control, user.id)).toBe(2);
  });

  it("lists users most-recently-logged-in first", () => {
    const older = createUser(control, "sub-old", new Date("2026-01-01T00:00:00Z"));
    const newer = createUser(control, "sub-new", new Date("2026-08-01T00:00:00Z"));
    expect(listUsers(control).map((u) => u.id)).toEqual([newer.id, older.id]);
  });

  it("records is_admin on the session and updates it in place", () => {
    const user = createUser(control, "sub-1", new Date());
    const session = createSession(control, {
      userId: user.id,
      now: new Date(),
      idleMs: 1000 * 60,
      tokens: { access_token: null, access_expires_at: null, refresh_token: null, id_token: null },
      isAdmin: true,
    });
    expect(session.is_admin).toBe(1);
    setSessionAdmin(control, session.id, false);
    expect(getSession(control, session.id, new Date())?.is_admin).toBe(0);
  });

  it("deletes every session belonging to one user and no others", () => {
    const a = createUser(control, "sub-a", new Date());
    const b = createUser(control, "sub-b", new Date());
    const tokens = {
      access_token: null,
      access_expires_at: null,
      refresh_token: null,
      id_token: null,
    };
    const now = new Date();
    createSession(control, { userId: a.id, now, idleMs: 60_000, tokens, isAdmin: false });
    createSession(control, { userId: a.id, now, idleMs: 60_000, tokens, isAdmin: false });
    const kept = createSession(control, {
      userId: b.id,
      now,
      idleMs: 60_000,
      tokens,
      isAdmin: false,
    });

    expect(deleteSessionsForUser(control, a.id)).toBe(2);
    expect(getSession(control, kept.id, now)).toBeDefined();
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server/control-db.test.ts`
Expected: FAIL — the new functions are not exported.

- [x] **Step 3: Add migration 002**

Append to the `MIGRATIONS` array in `src/lib/server/control-db.ts`:

```ts
  {
    version: 2,
    name: "admin-and-generation",
    sql: `
      -- The operator needs a human-readable label to aim a reset at; a list of
      -- ULIDs forces the identification step out into Authentik, unchecked
      -- (spec §1). This narrows "nothing personal in control.db" to "no training
      -- data in control.db" — see ARCHITECTURE §4.
      ALTER TABLE control_user ADD COLUMN display_label TEXT;

      -- Bumped by a reset. The offline outbox carries the generation it was
      -- filled under, so ops from before a wipe are rejected wholesale rather
      -- than flushing back in and quarantining forever (spec §7).
      ALTER TABLE control_user ADD COLUMN data_generation INTEGER NOT NULL DEFAULT 0;

      -- Admin-ness is a property of the session, not the user: it is recomputed
      -- from the IdP's groups at login and on every token refresh, so there is no
      -- stored privilege that can disagree with Authentik (spec §3).
      ALTER TABLE session ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
    `,
  },
```

- [x] **Step 4: Update the row types and `createUser`/`createSession`**

`ControlUser` gains:

```ts
  display_label: string | null;
  data_generation: number;
```

`SessionRow` gains `is_admin: number;`.

In `createUser`, add `display_label: null,` and `data_generation: 0,` to the object literal
(the INSERT itself is unchanged — both columns have defaults, and the returned object must
match what a later `getUserById` reads).

In `createSession`, add `isAdmin: boolean` to the input type, set
`is_admin: input.isAdmin ? 1 : 0` on the object, and add the column and its parameter to
the INSERT.

- [x] **Step 5: Add the new accessors**

```ts
/** Every registered user, most recently active first — the admin list's source. */
export function listUsers(control: ControlDb): ControlUser[] {
  return control.db
    .prepare("SELECT * FROM control_user ORDER BY last_login_at DESC")
    .all() as ControlUser[];
}

/**
 * The label the operator identifies this user by, rewritten on every login from
 * `preferred_username ?? email ?? name`. Display only — never an identity key (§4).
 */
export function setDisplayLabel(control: ControlDb, userId: string, label: string | null): void {
  control.db.prepare("UPDATE control_user SET display_label = ? WHERE id = ?").run(label, userId);
}

/** Re-stamp a live session's operator flag after a token refresh re-read the groups. */
export function setSessionAdmin(control: ControlDb, sessionId: string, isAdmin: boolean): void {
  control.db
    .prepare("UPDATE session SET is_admin = ? WHERE id = ?")
    .run(isAdmin ? 1 : 0, sessionId);
}

/** Invalidate everything the client queued under the old generation. Returns the new one. */
export function bumpDataGeneration(control: ControlDb, userId: string): number {
  const row = control.db
    .prepare(
      "UPDATE control_user SET data_generation = data_generation + 1 WHERE id = ? " +
        "RETURNING data_generation",
    )
    .get(userId) as { data_generation: number } | undefined;
  if (!row) throw new Error(`No such user: ${userId}`);
  return row.data_generation;
}

export function getDataGeneration(control: ControlDb, userId: string): number {
  const row = control.db
    .prepare("SELECT data_generation FROM control_user WHERE id = ?")
    .get(userId) as { data_generation: number } | undefined;
  return row?.data_generation ?? 0;
}

/**
 * Sign this user out everywhere. The first step of a reset (spec §6): nothing
 * authenticated can write once their sessions are gone.
 */
export function deleteSessionsForUser(control: ControlDb, userId: string): number {
  return control.db.prepare("DELETE FROM session WHERE user_id = ?").run(userId).changes;
}
```

- [x] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/server/control-db.test.ts`
Expected: PASS.

Adding a required `isAdmin` to `createSession` breaks two existing call sites. Fix both
here, in this commit, or the suite does not compile:

- `tests/server/auth.test.ts`'s `seedSession` helper (around line 158) — add
  `isAdmin?: boolean` to its options object and pass
  `isAdmin: options.isAdmin ?? false` through to `createSession`. Task 3's tests need
  that parameter, so add it now rather than reaching back for it.
- `src/routes/auth/callback/+server.ts` — pass `isAdmin: false` for now; Task 3 replaces
  it with the real group check. A temporary literal is correct here: this commit has no
  `config.adminGroup` consumer yet, and leaving the file uncompilable to "save" one line
  would break the task boundary.

- [x] **Step 7: Verify and commit**

Run: `npx prettier --write src/lib/server/control-db.ts tests/server/control-db.test.ts && npm run verify`

```bash
git add src/lib/server/control-db.ts tests/server/control-db.test.ts tests/server/auth.test.ts docs/superpowers/plans/2026-08-17-admin-section.md
git commit -m "feat(db): add the admin, display-label and generation columns to control.db"
```

---

### Task 3: Admin-ness through the session lifecycle

**Files:**
- Modify: `src/lib/server/auth.ts`
- Modify: `src/routes/auth/callback/+server.ts`
- Modify: `src/hooks.server.ts`
- Modify: `src/app.d.ts`
- Test: `tests/server/auth.test.ts`

**Interfaces:**
- Consumes: `GainConfig.adminGroup`, `GainConfig.devAdmin` (Task 1);
  `setSessionAdmin`, `setDisplayLabel`, `createSession({ ..., isAdmin })` (Task 2).
- Produces: `SessionCheck` with `status: "ok"` gains `isAdmin: boolean`;
  `App.Locals.user` gains `isAdmin: boolean`.

- [x] **Step 1: Write the failing tests**

`tests/server/auth.test.ts` already has everything these need — do not add new harness.
The helpers, with their real signatures:

- `seedSession({ accessTtlMs, refreshToken, createdAt, idToken })` → the session **id**.
  Task 2 added `isAdmin` to its options.
- `deps(control, { token, userinfo, endpoints, getEndpoints })` — overrides are at the
  HTTP level. There is no `refreshGroups` shortcut: a refresh reporting groups means a
  `token` override returning an `id_token` that lists them.
- `idToken(claims, issuedAt?)` → a real signed JWT. `json(body, status?)` → a `Response`.
- `check(sessionId, now, deps)` → `Promise<SessionCheck>`.

**First**, add `adminGroup: "gain-admins"` to the module-level `config` object this file
builds — `check()` passes it to `checkSession`, so without it every case below reads as
"no admin configured" and passes vacuously.

```ts
describe("the admin flag", () => {
  it("reports the flag stored on the session", async () => {
    const sessionId = seedSession({ accessTtlMs: 60 * 60_000, isAdmin: true });
    expect(await check(sessionId, NOW, deps(control))).toMatchObject({
      status: "ok",
      isAdmin: true,
    });
  });

  it("drops the flag when a refresh shows the admin group is gone", async () => {
    const sessionId = seedSession({ accessTtlMs: -1, isAdmin: true });
    const result = await check(
      sessionId,
      NOW,
      deps(control, {
        token: async () =>
          json({
            access_token: "access-2",
            expires_in: 3600,
            id_token: await idToken({ groups: ["gain-users"] }),
          }),
      }),
    );
    expect(result).toMatchObject({ status: "ok", isAdmin: false });
    expect(getSession(control, sessionId, NOW)?.is_admin).toBe(0);
  });

  it("grants the flag when a refresh shows the group was added", async () => {
    const sessionId = seedSession({ accessTtlMs: -1, isAdmin: false });
    const result = await check(
      sessionId,
      NOW,
      deps(control, {
        token: async () =>
          json({
            access_token: "access-2",
            expires_in: 3600,
            id_token: await idToken({ groups: ["gain-users", "gain-admins"] }),
          }),
      }),
    );
    expect(result).toMatchObject({ status: "ok", isAdmin: true });
    expect(getSession(control, sessionId, NOW)?.is_admin).toBe(1);
  });

  it("leaves the flag untouched when membership cannot be established", async () => {
    // No `id_token` in the refresh response, and `deps` throws for an un-overridden
    // userinfo endpoint — which `fetchUserinfoGroups` turns into `null`, not `[]`.
    // This is the phase-3 rule the whole design leans on; if it regresses, an IdP blip
    // silently demotes the operator.
    const sessionId = seedSession({ accessTtlMs: -1, isAdmin: true });
    const result = await check(
      sessionId,
      NOW,
      deps(control, { token: () => json({ access_token: "access-2", expires_in: 3600 }) }),
    );
    expect(result).toMatchObject({ status: "ok", isAdmin: true });
    expect(getSession(control, sessionId, NOW)?.is_admin).toBe(1);
  });
});
```

`getSession` must be added to this file's imports from `../../src/lib/server/control-db`.

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server/auth.test.ts`
Expected: FAIL — `isAdmin` is not on `SessionCheck`.

- [x] **Step 3: Thread the flag through `checkSession`**

In `src/lib/server/auth.ts`, add to the `"ok"` variant of `SessionCheck`:

```ts
      /** Operator, as of the last group evaluation. See `refreshIfDue`. */
      isAdmin: boolean;
```

Change `refreshIfDue`'s signature to take the admin group and report back the flag it
settled on. Replace its return type with:

```ts
type RefreshOutcome =
  | { outcome: "ok"; isAdmin: boolean }
  | { outcome: "failed" }
  | { outcome: "forbidden" };
```

Every early `return "ok"` becomes `return { outcome: "ok", isAdmin: session.is_admin === 1 }`
— an unevaluable or skipped refresh must not change the stored flag. `return "failed"` and
`return "forbidden"` become their object forms.

After the existing `hasRequiredGroup` revocation check, and before
`storeRefreshedTokens`, add:

```ts
  // Admin-ness is re-derived from the same answer that just re-checked the access
  // gate. `groups === null` means GAIN could not establish membership at all, and the
  // same rule applies as to the gate itself: an unevaluable check is not a failed
  // check, so the flag is left exactly as it was (spec §3).
  let isAdmin = session.is_admin === 1;
  if (groups !== null) {
    const nowAdmin = adminGroup !== null && hasRequiredGroup(groups, adminGroup);
    if (nowAdmin !== isAdmin) {
      setSessionAdmin(control, session.id, nowAdmin);
      isAdmin = nowAdmin;
    }
  }
```

and return `{ outcome: "ok", isAdmin }` at the end.

In `checkSession`, pass `config.adminGroup` into `refreshIfDue`, branch on
`refresh.outcome`, and add `isAdmin: refresh.isAdmin` to the returned `"ok"` object.

Import `setSessionAdmin` from `./control-db`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/server/auth.test.ts`
Expected: PASS.

- [x] **Step 5: Set the flag and the label at login**

In `src/routes/auth/callback/+server.ts`, after the `touchUserLogin(control, user.id, now)`
line:

```ts
  // The label the operator identifies this user by (spec §1). `preferred_username`
  // leads because it is what Authentik's own user list shows, so an operator matching
  // a name across the two screens sees the same string.
  setDisplayLabel(control, user.id, extractDisplayLabel(claims));
```

Add to `src/lib/server/oidc.ts`, beside `extractDisplayName`:

```ts
/**
 * The operator-facing label for a user, distinct from `extractDisplayName`'s greeting:
 * this one prefers `preferred_username` because that is the string Authentik's admin UI
 * shows, so the two lists can be matched by eye. Display only, never an identity.
 */
export function extractDisplayLabel(claims: Record<string, unknown>): string | null {
  for (const key of ["preferred_username", "email", "name"] as const) {
    const value = claims[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}
```

Then pass the flag into `createSession`:

```ts
    isAdmin: config.adminGroup !== null && hasRequiredGroup(groups, config.adminGroup),
```

- [x] **Step 6: Expose it on `locals`**

In `src/app.d.ts`, add to the `user` object:

```ts
        /**
         * Operator (spec §3). Re-derived from the IdP's groups at login and on
         * every token refresh, so revoking the group revokes this — there is no
         * separate revocation path to forget.
         */
        isAdmin: boolean;
```

In `src/hooks.server.ts`, the bypass branch becomes:

```ts
    event.locals.user = {
      id: ensureBypassUser(devUser, now),
      bypass: true,
      displayName: devUser,
      // A name, not a flag: an e2e run drives an admin and a non-admin through
      // `x-gain-e2e-user` against one server process.
      isAdmin: config.devAdmin !== null && config.devAdmin === devUser,
    };
```

and the OIDC branch's assignment gains `isAdmin: check.isAdmin`.

- [x] **Step 7: Verify and commit**

Run: `npx prettier --write src/lib/server/auth.ts src/lib/server/oidc.ts src/routes/auth/callback/+server.ts src/hooks.server.ts src/app.d.ts && npm run verify`

```bash
git add src/lib/server/auth.ts src/lib/server/oidc.ts src/routes/auth/callback/+server.ts src/hooks.server.ts src/app.d.ts tests/server/auth.test.ts docs/superpowers/plans/2026-08-17-admin-section.md
git commit -m "feat(auth): derive operator status from the OIDC groups on every refresh"
```

---

### Task 4: `admin-stats.ts` — the only cross-user read

**Files:**
- Create: `src/lib/server/admin-stats.ts`
- Test: `tests/server/admin-stats.test.ts`

**Interfaces:**
- Consumes: `ControlUser` and `listUsers` (Task 2).
- Produces:

```ts
export type UserStats = {
  userId: string;
  displayLabel: string | null;
  oidcSub: string;
  createdAt: string;
  lastLoginAt: string;
  provisioned: boolean;
  plans: number;
  planVersions: number;
  workoutsStarted: number;
  workoutsFinished: number;
  setLogs: number;
  lastWorkoutAt: string | null;
  diskBytes: number;
};

export function statsForUsers(dataDir: string, users: readonly ControlUser[]): UserStats[];
```

**Design note — where the guarantee actually lives.** The `readonly: true` flag is defence
in depth, not the guarantee. A read-only open of a WAL database throws `SQLITE_CANTOPEN`
when the `-shm` file does not exist and the connection cannot create it, which is reachable
for a user provisioned but never written to. The fallback is a normal open. **The
guarantee is the module's query surface** — only `COUNT(*)` and `MAX(...)`, no exported
function that can return a content row — and that is what the test asserts.

- [x] **Step 1: Write the failing test**

Create `tests/server/admin-stats.test.ts`:

Note the import paths: `importPlan` lives in `src/lib/db/import-plan.ts` (**not**
`import.ts`) and takes an already-**parsed** document, not raw Markdown —
`importPlan(userDb, { parsed, now })`. `tests/server/` imports by relative path, not
`$lib`. Copy the `seedPlan` helper below rather than re-deriving the parse-then-import
dance in each test.

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { importPlan } from "../../src/lib/db/import-plan";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { statsForUsers } from "../../src/lib/server/admin-stats";
import type { ControlUser } from "../../src/lib/server/control-db";

const fixtureMd = fs.readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const NOW = new Date("2026-08-17T09:00:00Z");

/** Import the fixture plan as version 1. Throws loudly rather than half-seeding. */
function seedPlan(userDb: UserDb): void {
  const parsed = parsePlanDocument(fixtureMd);
  if (!parsed.ok) throw new Error(`fixture failed to parse (${parsed.kind}):\n${parsed.report}`);
  const result = importPlan(userDb, { parsed, now: NOW });
  if (!result.ok) throw new Error(`fixture failed to import: ${result.message}`);
}

function user(id: string): ControlUser {
  return {
    id,
    oidc_sub: `sub-${id}`,
    created_at: "2026-01-01T00:00:00.000Z",
    last_login_at: "2026-08-17T00:00:00.000Z",
    display_label: id,
    data_generation: 0,
  };
}

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-admin-stats-"));
});
afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("statsForUsers", () => {
  it("reports a zeroed, unprovisioned record for a user with no directory", () => {
    const [stats] = statsForUsers(dataDir, [user("ghost")]);
    expect(stats).toMatchObject({
      userId: "ghost",
      provisioned: false,
      plans: 0,
      workoutsStarted: 0,
      setLogs: 0,
      lastWorkoutAt: null,
      diskBytes: 0,
    });
  });

  it("counts a provisioned user's plans without reading their content", () => {
    const db = openUserDb(dataDir, "alice", { now: NOW, seedTemplates: [] });
    seedPlan(db);
    db.close();

    const [stats] = statsForUsers(dataDir, [user("alice")]);
    expect(stats.provisioned).toBe(true);
    expect(stats.plans).toBe(1);
    expect(stats.planVersions).toBe(1);
    expect(stats.workoutsStarted).toBe(0);
    expect(stats.diskBytes).toBeGreaterThan(0);
    // Nothing the plan says reaches the operator — not its name, not a slug.
    const serialised = JSON.stringify(stats);
    expect(serialised).not.toContain("Home");
    expect(serialised).not.toContain("goblet");
  });

  it("opens a cold WAL database that has never been written to", () => {
    // Provision and close immediately: no -shm exists on disk. A readonly open of a
    // WAL database can fail here with SQLITE_CANTOPEN, so the module must fall back.
    openUserDb(dataDir, "cold", { now: NOW, seedTemplates: [] }).close();
    fs.rmSync(path.join(dataDir, "users", "cold", "gain.db-shm"), { force: true });
    fs.rmSync(path.join(dataDir, "users", "cold", "gain.db-wal"), { force: true });

    expect(() => statsForUsers(dataDir, [user("cold")])).not.toThrow();
    expect(statsForUsers(dataDir, [user("cold")])[0].plans).toBe(0);
  });

  it("keeps one user's counts out of another's", () => {
    const db = openUserDb(dataDir, "alice", { now: NOW, seedTemplates: [] });
    seedPlan(db);
    db.close();
    openUserDb(dataDir, "bob", { now: NOW, seedTemplates: [] }).close();

    const stats = statsForUsers(dataDir, [user("alice"), user("bob")]);
    expect(stats.find((s) => s.userId === "alice")?.plans).toBe(1);
    expect(stats.find((s) => s.userId === "bob")?.plans).toBe(0);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/server/admin-stats.test.ts`
Expected: FAIL — cannot resolve `$lib/server/admin-stats`.

- [x] **Step 3: Implement**

Create `src/lib/server/admin-stats.ts`:

```ts
/**
 * Per-user aggregates for the operator screen (spec §5) — and the only module in GAIN
 * that opens a `gain.db` belonging to someone other than the requesting user.
 *
 * That concentration is the design. ARCHITECTURE §4's promise is that no code path
 * reads another user's training data; keeping every cross-user read in one file makes
 * that a property of a module boundary rather than a rule every future feature has to
 * remember. **Nothing here may return a row from a content table.** Only `COUNT(*)`,
 * `MAX(...)` and file sizes leave this module, and `tests/server/admin-stats.test.ts`
 * asserts it.
 *
 * The `readonly` open is defence in depth rather than the guarantee itself: a read-only
 * connection to a WAL database throws `SQLITE_CANTOPEN` when no `-shm` exists and it
 * cannot create one — reachable for a user provisioned but never written to — so there
 * is a fallback, and the query surface above is what actually holds the line.
 *
 * Handles are opened per request and closed in a `finally`. `getUserDbFor` is
 * deliberately not used: it would hand admin code a writable handle to every user's
 * data and fill the process-wide cache with users the operator merely looked at.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ControlUser } from "./control-db";

export type UserStats = {
  userId: string;
  displayLabel: string | null;
  oidcSub: string;
  createdAt: string;
  lastLoginAt: string;
  /** False when this user has logged in but no `gain.db` exists yet. */
  provisioned: boolean;
  plans: number;
  planVersions: number;
  workoutsStarted: number;
  workoutsFinished: number;
  setLogs: number;
  lastWorkoutAt: string | null;
  /** Recursive size of `users/<id>/`, so plan documents and archived exports count. */
  diskBytes: number;
};

type Counts = Omit<
  UserStats,
  "userId" | "displayLabel" | "oidcSub" | "createdAt" | "lastLoginAt" | "diskBytes"
>;

const EMPTY: Counts = {
  provisioned: false,
  plans: 0,
  planVersions: 0,
  workoutsStarted: 0,
  workoutsFinished: 0,
  setLogs: 0,
  lastWorkoutAt: null,
};

export function statsForUsers(dataDir: string, users: readonly ControlUser[]): UserStats[] {
  return users.map((user) => {
    const userDir = path.join(dataDir, "users", user.id);
    return {
      userId: user.id,
      displayLabel: user.display_label,
      oidcSub: user.oidc_sub,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      diskBytes: directorySize(userDir),
      ...countsFor(path.join(userDir, "gain.db")),
    };
  });
}

function countsFor(dbPath: string): Counts {
  if (!fs.existsSync(dbPath)) return EMPTY;

  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    // See the module comment: a cold WAL database cannot always be opened read-only.
    db = new Database(dbPath, { fileMustExist: true });
  }

  try {
    return {
      provisioned: true,
      plans: count(db, "SELECT COUNT(*) AS n FROM plan"),
      planVersions: count(db, "SELECT COUNT(*) AS n FROM plan_version"),
      workoutsStarted: count(db, "SELECT COUNT(*) AS n FROM workout"),
      workoutsFinished: count(
        db,
        "SELECT COUNT(*) AS n FROM workout WHERE completed_at IS NOT NULL",
      ),
      setLogs: count(db, "SELECT COUNT(*) AS n FROM set_log"),
      lastWorkoutAt:
        (db.prepare("SELECT MAX(started_at) AS t FROM workout").get() as { t: string | null }).t ??
        null,
    };
  } finally {
    db.close();
  }
}

function count(db: Database.Database, sql: string): number {
  return (db.prepare(sql).get() as { n: number }).n;
}

/** Recursive byte total. Symlinks are counted by their own size, never followed. */
function directorySize(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += directorySize(full);
    } else {
      try {
        total += fs.lstatSync(full).size;
      } catch {
        // Raced with a reset. A missing file contributes nothing.
      }
    }
  }
  return total;
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/server/admin-stats.test.ts`
Expected: PASS. If the cold-WAL case still throws, the fallback branch is wrong — fix it
rather than deleting the test.

- [x] **Step 5: Verify and commit**

Run: `npx prettier --write src/lib/server/admin-stats.ts tests/server/admin-stats.test.ts && npm run verify`

```bash
git add src/lib/server/admin-stats.ts tests/server/admin-stats.test.ts docs/superpowers/plans/2026-08-17-admin-section.md
git commit -m "feat(admin): add the count-only per-user stats reader"
```

---

### Task 5: `evictUserDb` and the reset sequence

**Files:**
- Modify: `src/lib/server/app-state.ts`
- Create: `src/lib/server/admin-reset.ts`
- Test: `tests/server/admin-reset.test.ts`

**Interfaces:**
- Consumes: `deleteSessionsForUser`, `bumpDataGeneration` (Task 2).
- Produces:
  - `evictUserDb(userId: string): void` from `app-state.ts` — closes and forgets the
    cached handle.
  - `beginReset(userId: string): void` / `endReset(userId: string): void` from
    `app-state.ts` — the in-process guard `getUserDbFor` refuses against.
  - `resetUserData(control: ControlDb, dataDir: string, userId: string): { generation: number }`
    from `admin-reset.ts`.

- [x] **Step 1: Write the failing test**

Create `tests/server/admin-reset.test.ts`:

`resetUserData` re-provisions through `getUserDbFor`, which reads `getConfig().dataDir` —
so this file has to point the process-wide config at its temp directory. Copy the
`beforeEach`/`afterEach` pattern from `tests/server/first-run.test.ts` exactly (it sets
`DATA_DIR` and `GAIN_DEV_USER`, deletes the four `OIDC_*` variables, and calls both
`resetConfigForTests()` and `resetAppStateForTests()`); a partial copy leaves a cached
config pointing at a directory the previous test deleted.

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { importPlan } from "../../src/lib/db/import-plan";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { resetUserData } from "../../src/lib/server/admin-reset";
import {
  openControlDb,
  createUser,
  createSession,
  getSession,
} from "../../src/lib/server/control-db";
import { getUserDbFor, resetAppStateForTests } from "../../src/lib/server/app-state";
import { resetConfigForTests } from "../../src/lib/server/config";
import { statsForUsers } from "../../src/lib/server/admin-stats";

const fixtureMd = fs.readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const NOW = new Date("2026-08-17T09:00:00Z");
const NO_TOKENS = {
  access_token: null,
  access_expires_at: null,
  refresh_token: null,
  id_token: null,
};

function seedPlan(userDb: UserDb): void {
  const parsed = parsePlanDocument(fixtureMd);
  if (!parsed.ok) throw new Error(`fixture failed to parse (${parsed.kind}):\n${parsed.report}`);
  const result = importPlan(userDb, { parsed, now: NOW });
  if (!result.ok) throw new Error(`fixture failed to import: ${result.message}`);
}

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-admin-reset-"));
  process.env.DATA_DIR = dataDir;
  process.env.GAIN_DEV_USER = "tester";
  delete process.env.OIDC_ISSUER;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_CLIENT_SECRET;
  delete process.env.OIDC_REQUIRED_GROUP;
  resetConfigForTests();
  resetAppStateForTests();
});

afterEach(() => {
  resetAppStateForTests();
  resetConfigForTests();
  delete process.env.DATA_DIR;
  delete process.env.GAIN_DEV_USER;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("resetUserData", () => {
  it("wipes the directory, bumps the generation, and re-provisions", () => {
    const control = openControlDb(dataDir, NOW);
    const user = createUser(control, "sub-a", NOW);
    const db = openUserDb(dataDir, user.id, { now: NOW, seedTemplates: [] });
    seedPlan(db);
    db.close();

    const before = statsForUsers(dataDir, [{ ...user }])[0];
    expect(before.plans).toBe(1);

    const { generation } = resetUserData(control, dataDir, user.id);
    expect(generation).toBe(1);

    const after = statsForUsers(dataDir, [{ ...user }])[0];
    expect(after.provisioned).toBe(true);
    expect(after.plans).toBe(0);
    expect(after.setLogs).toBe(0);
    control.close();
  });

  it("signs the user out everywhere", () => {
    const control = openControlDb(dataDir, NOW);
    const user = createUser(control, "sub-a", NOW);
    openUserDb(dataDir, user.id, { now: NOW, seedTemplates: [] }).close();
    const session = createSession(control, {
      userId: user.id,
      now: NOW,
      idleMs: 60_000,
      tokens: NO_TOKENS,
      isAdmin: false,
    });

    resetUserData(control, dataDir, user.id);
    expect(getSession(control, session.id, NOW)).toBeUndefined();
    control.close();
  });

  it("closes the cached handle before unlinking, so the fresh db is genuinely empty", () => {
    const control = openControlDb(dataDir, NOW);
    const user = createUser(control, "sub-a", NOW);
    // Warm the process-wide cache the way a live request would.
    seedPlan(getUserDbFor(user.id));

    resetUserData(control, dataDir, user.id);

    // A stale handle would still answer from the deleted inode and report 1.
    const fresh = getUserDbFor(user.id);
    const n = fresh.db.prepare("SELECT COUNT(*) AS n FROM plan").get() as { n: number };
    expect(n.n).toBe(0);
    control.close();
  });

  it("leaves another user untouched", () => {
    const control = openControlDb(dataDir, NOW);
    const a = createUser(control, "sub-a", NOW);
    const b = createUser(control, "sub-b", NOW);
    for (const id of [a.id, b.id]) {
      const db = openUserDb(dataDir, id, { now: NOW, seedTemplates: [] });
      seedPlan(db);
      db.close();
    }

    resetUserData(control, dataDir, a.id);

    expect(statsForUsers(dataDir, [{ ...b }])[0].plans).toBe(1);
    control.close();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/server/admin-reset.test.ts`
Expected: FAIL — cannot resolve `$lib/server/admin-reset`.

- [x] **Step 3: Add the eviction and reset guard to `app-state.ts`**

```ts
/**
 * Close this user's `gain.db` and forget it. Called before a reset unlinks the file:
 * `better-sqlite3` holds it open, and on Linux the unlink then leaves this process
 * writing to a deleted inode — the reset appears to work and silently does not.
 */
export function evictUserDb(userId: string): void {
  const db = userDbs.get(userId);
  if (db) {
    db.close();
    userDbs.delete(userId);
  }
}

/**
 * Users currently mid-reset. Their sessions are already gone by the time the directory
 * is unlinked, so no *authenticated* request can arrive — but one already in flight can,
 * and would re-open the handle between the eviction and the re-provision.
 */
const resetting = new Set<string>();

export function beginReset(userId: string): void {
  resetting.add(userId);
}

export function endReset(userId: string): void {
  resetting.delete(userId);
}
```

At the top of `getUserDbFor`, before the cache read:

```ts
  if (resetting.has(userId)) {
    throw new Error(`User ${userId} is being reset; their database is unavailable.`);
  }
```

Add `resetting.clear();` to `resetAppStateForTests`.

- [x] **Step 4: Implement the reset**

Create `src/lib/server/admin-reset.ts`:

```ts
/**
 * Reset one user's training data to a clean slate (spec §6).
 *
 * **The order below is load-bearing, not stylistic.** Each step exists because doing it
 * later breaks something quietly:
 *
 * 1. Sessions first — nothing authenticated can write once they are gone, and the
 *    wiped user's browser starts receiving 401s, which the sync layer already handles
 *    by holding its queue rather than dropping it.
 * 2. The generation bump invalidates whatever that held queue contains, so the ops do
 *    not flush back in after the wipe and quarantine forever (spec §7).
 * 3. The cached handle is closed *before* the unlink. `better-sqlite3` holds the file
 *    open; unlinking first leaves this process writing to a deleted inode.
 * 4. The directory goes, and is verified gone — `force: true` is best-effort by design,
 *    and re-provisioning on top of survivors would be worse than failing.
 * 5. Re-provision, so the user logs back in to a working empty instance rather than a
 *    broken one.
 *
 * The account itself survives: the `control_user` row stays, because the user is still
 * in `OIDC_REQUIRED_GROUP` and deleting the row only means their next login mints a new
 * user id and the list entry reappears (spec §2, decision 3).
 */

import fs from "node:fs";
import path from "node:path";
import { beginReset, endReset, evictUserDb, getUserDbFor } from "./app-state";
import { bumpDataGeneration, deleteSessionsForUser, type ControlDb } from "./control-db";

export function resetUserData(
  control: ControlDb,
  dataDir: string,
  userId: string,
): { generation: number } {
  const userDir = path.join(dataDir, "users", userId);

  deleteSessionsForUser(control, userId);
  const generation = bumpDataGeneration(control, userId);

  beginReset(userId);
  try {
    evictUserDb(userId);
    fs.rmSync(userDir, { recursive: true, force: true });
    if (fs.existsSync(userDir)) {
      throw new Error(
        `Could not remove ${userDir}. The user's data is partly deleted and their ` +
          `session has ended; re-run the reset once the cause is cleared.`,
      );
    }
  } finally {
    endReset(userId);
  }

  getUserDbFor(userId);
  return { generation };
}
```

- [x] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/server/admin-reset.test.ts`
Expected: PASS.

- [x] **Step 6: Verify and commit**

Run: `npx prettier --write src/lib/server/admin-reset.ts src/lib/server/app-state.ts tests/server/admin-reset.test.ts && npm run verify`

```bash
git add src/lib/server/admin-reset.ts src/lib/server/app-state.ts tests/server/admin-reset.test.ts docs/superpowers/plans/2026-08-17-admin-section.md
git commit -m "feat(admin): add the ordered per-user data reset"
```

---

### Task 6: The `/admin` screen

**Files:**
- Create: `src/lib/admin/user-status.ts`
- Create: `src/routes/admin/+page.server.ts`
- Create: `src/routes/admin/+page.svelte`
- Modify: `src/routes/+layout.svelte`
- Modify: `docs/UI-DECISIONS.md`
- Test: `tests/admin/user-status.test.ts`, `tests/server/admin-route.test.ts`

**Interfaces:**
- Consumes: `locals.user.isAdmin` (Task 3), `statsForUsers` / `UserStats` (Task 4),
  `resetUserData` (Task 5), `listUsers` (Task 2).
- Produces: `describeActivity(stats: UserStats, now: Date): string` and
  `confirmationFor(displayLabel: string | null, userId: string): string` from
  `src/lib/admin/user-status.ts`. Task 9's e2e spec depends on the copy strings below
  being exact.

**`src/routes/+layout.server.ts` needs no change.** It already returns
`user: locals.user` wholesale, so Task 3's `isAdmin` reaches the layout for free. (Task 7
does modify it, for a different field.)

#### What this screen is for

The operator is one person — whoever runs the container — visiting rarely: onboarding an
alpha tester, answering "can you wipe me", or wondering who is actually using this. Their
real question is never "how many sets has this person logged". It is **"is this person
alive on the platform?"** During alpha the interesting states are: signed in but never
imported a plan; imported a plan but never trained; training; stopped training weeks ago.

So the card leads with a plain-language reading of that, and keeps the counts underneath
as the evidence for it. That interpretive line is the one idea this screen is built
around; everything else stays deliberately quiet. A grid of raw counts would make the
operator do the arithmetic that the screen exists to do for them.

Two consequences worth stating, because both are easy to "fix" back into blandness:

- **No status colour.** UI-DECISIONS §5 reserves green/amber/red, and that constraint is
  doing real work here — it forces a sentence that says what is happening instead of a
  dot that makes the operator learn a colour code.
- **Relative phrasing in the status line only.** The rest of the app writes ISO dates
  (`toISOString().slice(0, 10)`) and the evidence row keeps doing that. "Last trained 6
  weeks ago" answers the question at a glance; `2026-07-06` does not. Both are present,
  each doing one job.

- [x] **Step 1: Write the failing test for the status line**

Create `tests/admin/user-status.test.ts`. The clock is injected — this is a pure module
and the repo's determinism rule applies to it.

```ts
import { describe, expect, it } from "vitest";
import { confirmationFor, describeActivity } from "../../src/lib/admin/user-status";
import type { UserStats } from "../../src/lib/server/admin-stats";

const NOW = new Date("2026-08-17T09:00:00Z");

function stats(overrides: Partial<UserStats> = {}): UserStats {
  return {
    userId: "01KZKQ4GB22EEQBF20YDKD1BYE",
    displayLabel: "alice",
    oidcSub: "sub-1",
    createdAt: "2026-03-12T00:00:00.000Z",
    lastLoginAt: "2026-08-16T00:00:00.000Z",
    provisioned: true,
    plans: 1,
    planVersions: 1,
    workoutsStarted: 4,
    workoutsFinished: 3,
    setLogs: 88,
    lastWorkoutAt: "2026-08-14T07:00:00.000Z",
    diskBytes: 1024,
    ...overrides,
  };
}

describe("describeActivity", () => {
  it("names the empty account before anything else", () => {
    expect(describeActivity(stats({ provisioned: false, plans: 0 }), NOW)).toBe("No plan yet");
    expect(describeActivity(stats({ plans: 0 }), NOW)).toBe("No plan yet");
  });

  it("separates having a plan from having used it", () => {
    expect(describeActivity(stats({ workoutsStarted: 0, lastWorkoutAt: null }), NOW)).toBe(
      "Plan imported, not trained yet",
    );
  });

  it("reads recent training in days", () => {
    expect(describeActivity(stats({ lastWorkoutAt: "2026-08-17T06:00:00.000Z" }), NOW)).toBe(
      "Last trained today",
    );
    expect(describeActivity(stats({ lastWorkoutAt: "2026-08-16T06:00:00.000Z" }), NOW)).toBe(
      "Last trained yesterday",
    );
    expect(describeActivity(stats({ lastWorkoutAt: "2026-08-14T06:00:00.000Z" }), NOW)).toBe(
      "Last trained 3 days ago",
    );
  });

  it("switches to weeks, then months, as the gap grows", () => {
    expect(describeActivity(stats({ lastWorkoutAt: "2026-08-03T06:00:00.000Z" }), NOW)).toBe(
      "Last trained 2 weeks ago",
    );
    expect(describeActivity(stats({ lastWorkoutAt: "2026-05-17T06:00:00.000Z" }), NOW)).toBe(
      "Last trained 3 months ago",
    );
  });

  it("says 1 week rather than 7 days at the boundary", () => {
    expect(describeActivity(stats({ lastWorkoutAt: "2026-08-10T09:00:00.000Z" }), NOW)).toBe(
      "Last trained 1 week ago",
    );
  });
});

describe("confirmationFor", () => {
  it("uses the label when there is one", () => {
    expect(confirmationFor("alice", "01KZKQ4GB22EEQBF20YDKD1BYE")).toBe("alice");
  });

  it("falls back to the tail of the user id", () => {
    expect(confirmationFor(null, "01KZKQ4GB22EEQBF20YDKD1BYE")).toBe("KD1BYE");
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/admin/user-status.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/admin/user-status`.

- [x] **Step 3: Implement the status line**

Create `src/lib/admin/user-status.ts`:

```ts
/**
 * How the operator screen reads a user's aggregates back as a sentence.
 *
 * Pure, with the clock injected, so the phrasing is testable and deterministic — and
 * because the answer is computed in `load` rather than the component: deriving "3 days
 * ago" at render time would disagree between the server-rendered markup and hydration,
 * the same trap `src/routes/+page.svelte` documents around its `nowMs`.
 *
 * The three states below are the ones that matter during alpha, in the order that
 * distinguishes them: an account with no plan is a different problem from a plan nobody
 * has trained, which is different again from someone who trained and stopped. UI-DECISIONS
 * §5 reserves colour for the plan's symptom framework, so this says it in words — which
 * is the better answer anyway, since a coloured dot would need a legend.
 */

import type { UserStats } from "../server/admin-stats";

const DAY_MS = 24 * 60 * 60 * 1000;

export function describeActivity(stats: UserStats, now: Date): string {
  if (!stats.provisioned || stats.plans === 0) return "No plan yet";
  if (stats.lastWorkoutAt === null) return "Plan imported, not trained yet";
  return `Last trained ${relativeDays(stats.lastWorkoutAt, now)}`;
}

/**
 * Calendar-day difference, not elapsed hours: a session at 23:00 and a glance at 08:00
 * the next morning is "yesterday", not "9 hours ago".
 */
function relativeDays(iso: string, now: Date): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "at an unknown time";

  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(new Date(then))) / DAY_MS));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 9) return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;

  const months = Math.max(1, Math.round(days / 30));
  return `${months} ${months === 1 ? "month" : "months"} ago`;
}

function startOfDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * What the operator must type to confirm a reset. The label when there is one; the tail
 * of the ULID when the user has not logged in since `display_label` was added.
 *
 * Typing it is the safety device, not the red button: it is the one step that cannot be
 * completed by muscle memory on the wrong card.
 */
export function confirmationFor(displayLabel: string | null, userId: string): string {
  return displayLabel ?? userId.slice(-6);
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/admin/user-status.test.ts`
Expected: PASS.

- [x] **Step 5: Write the failing route test**

Create `tests/server/admin-route.test.ts`. Model the request stand-ins on
`tests/server/first-run.test.ts`, which drives `+page.server.ts` directly with a minimal
`locals`/`request` object and the same `DATA_DIR` + `resetConfigForTests()` setup — copy
that file's `beforeEach`/`afterEach` wholesale, exactly as Task 5 did.

```ts
import { describe, expect, it } from "vitest";
import { isHttpError } from "@sveltejs/kit";
import { actions, load } from "../../src/routes/admin/+page.server";

function event(user: { id: string; isAdmin: boolean } | null, fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return {
    locals: { user: user && { ...user, bypass: true, displayName: null } },
    request: { formData: () => Promise.resolve(form) },
  } as never;
}

describe("the /admin guard", () => {
  it("404s for a signed-in non-admin", async () => {
    await expect(load(event({ id: "u1", isAdmin: false }))).rejects.toSatisfy(
      (err: unknown) => isHttpError(err) && err.status === 404,
    );
  });

  it("404s for an anonymous request", async () => {
    await expect(load(event(null))).rejects.toSatisfy(
      (err: unknown) => isHttpError(err) && err.status === 404,
    );
  });

  it("404s the reset action too, not just the page", async () => {
    // A guard on `load` alone leaves the action reachable by anyone who can POST.
    await expect(
      actions.reset(event({ id: "u1", isAdmin: false }, { userId: "u2", confirmLabel: "x" })),
    ).rejects.toSatisfy((err: unknown) => isHttpError(err) && err.status === 404);
  });
});

describe("the reset action", () => {
  it("fails with 400 rather than throwing when the confirmation is wrong", async () => {
    const result = await actions.reset(
      event({ id: admin.id, isAdmin: true }, { userId: subject.id, confirmLabel: "wrong" }),
    );
    expect(result).toMatchObject({ status: 400 });
    expect((result as { data: { actionError: string } }).data.actionError).toContain(
      "does not match",
    );
  });

  it("fails with 400 for a user id that no longer exists", async () => {
    const result = await actions.reset(
      event({ id: admin.id, isAdmin: true }, { userId: "gone", confirmLabel: "gone" }),
    );
    expect(result).toMatchObject({ status: 400 });
  });

  it("resets when the confirmation matches exactly", async () => {
    const result = await actions.reset(
      event({ id: admin.id, isAdmin: true }, { userId: subject.id, confirmLabel: "subject" }),
    );
    expect(result).toMatchObject({ resetLabel: "subject" });
  });
});
```

Seed `admin` and `subject` as `control_user` rows with `setDisplayLabel(…, "subject")` in
`beforeEach`, and give `subject` a provisioned `gain.db` with the fixture plan — reuse
Task 5's `seedPlan` helper by copying it, since `tests/helpers/` holds no equivalent.

- [x] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/server/admin-route.test.ts`
Expected: FAIL — the route module does not exist.

- [x] **Step 7: Implement the server route**

Create `src/routes/admin/+page.server.ts`:

```ts
/**
 * The operator screen (spec §8).
 *
 * A non-admin gets **404, not 403**. A 403 confirms both that the route exists and that
 * this instance has an operator configured; a 404 says nothing at all. The guard runs in
 * `load` *and* in the action — guarding only the page leaves the destructive POST
 * reachable by anyone who can construct one.
 */

import { error, fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { getControlDb } from "$lib/server/app-state";
import { getConfig } from "$lib/server/config";
import { listUsers } from "$lib/server/control-db";
import { statsForUsers } from "$lib/server/admin-stats";
import { resetUserData } from "$lib/server/admin-reset";
import { confirmationFor, describeActivity } from "$lib/admin/user-status";

function requireAdmin(locals: App.Locals): void {
  if (!locals.user?.isAdmin) throw error(404, "Not found");
}

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  const now = new Date();
  const users = statsForUsers(getConfig().dataDir, listUsers(getControlDb()));
  return {
    // The status sentence is resolved here, not in the component: "3 days ago" derived
    // at render time would differ between SSR and hydration.
    users: users.map((user) => ({
      ...user,
      status: describeActivity(user, now),
      confirmation: confirmationFor(user.displayLabel, user.userId),
    })),
  };
};

export const actions: Actions = {
  reset: async ({ locals, request }) => {
    requireAdmin(locals);

    const form = await request.formData();
    const userId = String(form.get("userId") ?? "");
    const typed = String(form.get("confirmLabel") ?? "").trim();

    const control = getControlDb();
    const target = listUsers(control).find((user) => user.id === userId);
    if (!target) return fail(400, { actionError: "That user no longer exists.", userId });

    const expected = confirmationFor(target.display_label, target.id);
    if (typed !== expected) {
      return fail(400, {
        actionError: `That does not match. Type ${expected} exactly to confirm.`,
        userId,
      });
    }

    try {
      resetUserData(control, getConfig().dataDir, target.id);
    } catch (err) {
      // Never throw from an action: a 500 renders +error.svelte and the operator loses
      // the screen along with any account of what happened.
      return fail(400, {
        actionError: err instanceof Error ? err.message : "The reset did not finish.",
        userId,
      });
    }

    return { resetLabel: expected };
  },
};
```

- [x] **Step 8: Run the route test to verify it passes**

Run: `npx vitest run tests/server/admin-route.test.ts`
Expected: PASS.

- [x] **Step 9: Build the page**

Create `src/routes/admin/+page.svelte`. Runes mode throughout — `$props`, `$state`,
`$derived`. No `export let`, no `createEventDispatcher`; there is not one of either
anywhere in `src/`.

**The card, at 360 px.** Four tiers of emphasis, dimmest last, so the eye lands on who
and how they are doing before it reaches identifiers:

```
┌──────────────────────────────────────┐
│ alice.smith                          │  --text, 1.05rem, 600
│ Last trained 3 days ago              │  --text, 0.95rem   ← the answer
│                                      │
│ 2 plans · 18 of 21 finished · 486 sets│ --muted, 0.875rem, tabular
│ Joined 2026-03-12 · 4.2 MB           │  --dim, 0.8125rem
│ a1b2c3d4-…-9f0e  (full, wrapped)     │  --dim, 0.8125rem
│                                      │
│ [ Reset data… ]                      │  neutral outline
└──────────────────────────────────────┘
```

The OIDC subject is rendered **in full and allowed to wrap** (`overflow-wrap: anywhere`),
never truncated and never in a monospace face — UI-DECISIONS §10 sets one family for the
whole app and no monospace anywhere. Truncating would hide exactly the string the operator
needs in order to match this row against Authentik's user list, which is the only reason
it is on screen.

**The reset, expanded.** The trigger is neutral; red appears only on the final confirm
button, at the moment the action is actually armed:

```
┌──────────────────────────────────────┐
│ ⚠ This permanently erases every plan, │
│   workout and log for alice.smith.    │
│   They keep their account and can     │
│   start again from an empty GAIN.     │
│                                       │
│ Type alice.smith to confirm           │
│ [___________________________]         │
│                                       │
│ [ Reset alice.smith's data ] [Cancel] │   ← red, disabled until matched
└──────────────────────────────────────┘
```

Typing the name is the real safety device; the colour is a signal, not the guard. That is
also what keeps the control usable for an operator who cannot distinguish red from
neutral.

```svelte
<script lang="ts">
  import { enhance } from "$app/forms";
  import IconTriangleAlert from "~icons/lucide/triangle-alert";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  /** Which card has its confirmation open. One at a time, by construction. */
  let openFor = $state<string | null>(null);
  let typed = $state("");

  function open(userId: string): void {
    openFor = userId;
    typed = "";
  }

  function close(): void {
    openFor = null;
    typed = "";
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["kB", "MB", "GB"];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
  }

  /** ISO everywhere the app shows an absolute date (`history/+page.svelte`). */
  function isoDate(iso: string): string {
    return iso.slice(0, 10);
  }
</script>

<svelte:head><title>Users — GAIN</title></svelte:head>

<h1>Users</h1>
<p class="lede">
  Counts only. Plans, workouts and notes stay private to the person who wrote them.
</p>

{#if form?.resetLabel}
  <p class="done" role="status">Reset {form.resetLabel}'s data.</p>
{/if}

{#if data.users.length === 0}
  <p class="empty">No one has signed in yet. Users appear here after their first sign-in.</p>
{/if}

<ul class="users">
  {#each data.users as user (user.userId)}
    <li class="card">
      <h2>{user.displayLabel ?? "No name yet"}</h2>
      <p class="status">{user.status}</p>

      <p class="counts tabular">
        {user.plans}
        {user.plans === 1 ? "plan" : "plans"} ·
        {user.workoutsFinished} of {user.workoutsStarted} finished ·
        {user.setLogs}
        {user.setLogs === 1 ? "set" : "sets"}
      </p>
      <p class="meta tabular">
        Joined {isoDate(user.createdAt)} · last seen {isoDate(user.lastLoginAt)} ·
        {formatBytes(user.diskBytes)}
      </p>
      <p class="meta identity">{user.oidcSub}</p>

      {#if openFor === user.userId}
        <form
          method="POST"
          action="?/reset"
          class="danger-panel"
          use:enhance={() => {
            return async ({ update }) => {
              await update();
              close();
            };
          }}
        >
          <input type="hidden" name="userId" value={user.userId} />

          <p class="warning" id="warn-{user.userId}">
            <IconTriangleAlert aria-hidden="true" />
            <span>
              This permanently erases every plan, workout and log for
              <strong>{user.confirmation}</strong>. They keep their account and can start
              again from an empty GAIN.
            </span>
          </p>

          <label for="confirm-{user.userId}">Type {user.confirmation} to confirm</label>
          <input
            id="confirm-{user.userId}"
            name="confirmLabel"
            bind:value={typed}
            aria-describedby="warn-{user.userId}"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
          />

          {#if form?.actionError && form?.userId === user.userId}
            <p class="action-error" role="alert">{form.actionError}</p>
          {/if}

          <div class="row">
            <button class="danger" type="submit" disabled={typed !== user.confirmation}>
              Reset {user.confirmation}'s data
            </button>
            <button class="quiet" type="button" onclick={close}>Cancel</button>
          </div>
        </form>
      {:else}
        <button class="trigger" type="button" onclick={() => open(user.userId)}>
          Reset data…
        </button>
      {/if}
    </li>
  {/each}
</ul>
```

**Styles.** Use the existing tokens only — no new colours beyond a soft red wash, which
the palette lacks an equivalent of (`--accent-soft` and `--amber-soft` exist, `--red-soft`
does not). Define it locally in this component rather than adding a global token for one
screen:

- `.users` — `list-style: none; padding: 0;` and
  `grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr))` with `gap: 1rem`.
  The `min(100%, 22rem)` floor is the load-bearing part: a bare `minmax(22rem, 1fr)`
  cannot shrink below 22 rem and overflows at 360 px, which is exactly the phase-4 grid
  bug UI-DECISIONS §12 exists to catch.
- `.card` — `background: var(--surface); border: 1px solid var(--line-soft); border-radius: var(--r-md); padding: 1.25rem;`
  matching `src/routes/+page.svelte`'s card.
- `.status` — `var(--text)`, `0.95rem`, `margin: 0.15rem 0 0.75rem`. The one line that
  is not muted below the name.
- `.counts` — `var(--muted)`, `0.875rem`. `.meta` — `var(--dim)`, `0.8125rem`,
  `margin: 0.15rem 0 0`.
- `.identity` — `overflow-wrap: anywhere;`. No `font-family` override.
- `.trigger` — transparent background, `1px solid var(--line)`, `border-radius: var(--r-sm)`,
  `color: var(--muted)`, full-width at narrow widths, `margin-top: 1rem`.
- `.danger-panel` — `margin-top: 1rem; padding: 1rem; border-radius: var(--r-sm);`
  `border: 1px solid var(--red); background: color-mix(in srgb, var(--red) 10%, transparent);`
- `.warning` — `display: flex; gap: 0.5rem; align-items: start;` with the icon inheriting
  its colour from the text (do **not** set width/height on the `<svg>`; `app.css` sizes
  every icon at 1.15em already).
- `.danger` — `background: var(--red); color: #fff; border: 0; border-radius: var(--r-sm);`
  and `&:disabled { opacity: 0.5; cursor: not-allowed; }`.
- `.action-error` — `color: var(--text)`, not `var(--red)`: inside a red-bordered panel a
  red error is unreadable, and the phase-4 rule that an error must be legible next to the
  control that failed still applies.
- `.row` — `display: flex; gap: 0.5rem; flex-wrap: wrap;` so the two buttons stack rather
  than overflow at 360 px.
- Respect `@media (prefers-reduced-motion: reduce)` if you add any transition at all; the
  panel appearing needs none.

- [x] **Step 10: Link it from the header**

In `src/routes/+layout.svelte`, inside `.top-right`, before the sign-out form:

```svelte
      {#if data.user?.isAdmin}
        <a class="linklike" href="/admin">Users</a>
      {/if}
```

"Users", not "Admin" — the link says what is behind it, and it matches the page's own `h1`.
An action keeps the same name through the whole flow.

- [x] **Step 11: Record the UI-DECISIONS exception**

In `docs/UI-DECISIONS.md` §5, after the existing celebration-confetti exception. Match the
file's prose voice — it argues a case, it is not a bullet list. `docs/` is
prettier-ignored, so do not run prettier over it.

```markdown
**A second narrow exception, settled 2026-08-17:** the reset control on `/admin` is red.
The triad above belongs to the plan's pain-response framework, and it earns its
exclusivity on the surfaces where a user reads their own body signals — the session
runner, progress, the export. `/admin` renders no plan and no symptom data at all, so
there is no scale for red to compete with there, and red is the conventional signal for an
irreversible destructive action. The exception covers that button and the panel it sits
in, on that route, and nothing else: not the error message inside that panel, which stays
`var(--text)` because red-on-red is unreadable, and not destructive styling anywhere that
renders plan or symptom data. Note also what is *not* coloured — the per-user activity
line reads "Last trained 6 weeks ago" rather than showing an amber dot, because a sentence
needs no legend and the triad could not have been borrowed for it anyway.
```

- [x] **Step 12: Verify and commit**

Run: `npx prettier --write src/lib/admin src/routes/admin src/routes/+layout.svelte tests/admin tests/server/admin-route.test.ts && npm run verify`

```bash
git add src/lib/admin src/routes/admin tests/admin tests/server/admin-route.test.ts src/routes/+layout.svelte docs/UI-DECISIONS.md docs/superpowers/plans/2026-08-17-admin-section.md
git commit -m "feat(admin): add the operator screen and its per-user reset"
```
---

### Task 7: Sync generation — reject ops from before a reset

**Files:**
- Modify: `src/lib/sync/ops.ts`
- Modify: `src/routes/api/sync/+server.ts`
- Modify: `src/routes/+layout.server.ts`
- Modify: `src/lib/sync/client.svelte.ts`
- Modify: `src/lib/sync/idb.ts`
- Modify: `src/lib/sync/queue.ts`
- Test: `tests/sync/ops.test.ts`, `tests/server/sync-route.test.ts`

**Interfaces:**
- Consumes: `getDataGeneration` (Task 2).
- Produces:
  - `syncBatchSchema` gains `generation: number` (defaulted, so absent means 0).
  - `OutboxStore` gains `clearAll(): Promise<void>`.
  - `SyncStatus` gains `resetNotice: boolean`.

**Why the default matters.** A cached client that predates this change sends no
`generation`, which reads as 0 — correct for every user never reset, and correctly
rejected for every user who has been. Without the default, rolling this out would 400
every stale client.

- [ ] **Step 1: Write the failing tests**

In `tests/sync/ops.test.ts`:

```ts
it("defaults a batch with no generation to 0", () => {
  const parsed = syncBatchSchema.parse({ ops: [] });
  expect(parsed.generation).toBe(0);
});

it("carries an explicit generation", () => {
  expect(syncBatchSchema.parse({ ops: [], generation: 3 }).generation).toBe(3);
});
```

In `tests/server/sync-route.test.ts`:

```ts
it("rejects a whole batch from a stale generation and writes nothing", async () => {
  bumpDataGeneration(control, userId); // now generation 1

  const response = await POST({
    locals: { user: { id: userId } },
    request: jsonRequest({ generation: 0, ops: [startOp] }),
  } as never);

  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ dataGeneration: 1 });
  const n = userDb.db.prepare("SELECT COUNT(*) AS n FROM workout").get() as { n: number };
  expect(n.n).toBe(0);
});

it("applies a batch whose generation matches", async () => {
  const response = await POST({
    locals: { user: { id: userId } },
    request: jsonRequest({ generation: 0, ops: [startOp] }),
  } as never);
  expect(response.status).toBe(200);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/sync/ops.test.ts tests/server/sync-route.test.ts`
Expected: FAIL — `generation` is not on the schema; the route returns 200 for both.

- [ ] **Step 3: Add the field to the schema**

In `src/lib/sync/ops.ts`, on `syncBatchSchema`:

```ts
  /**
   * The `control_user.data_generation` this outbox was filled under. Defaulted so a
   * client cached from before this field existed reads as 0 — correct for anyone never
   * reset, and correctly rejected for anyone who has been (spec §7).
   */
  generation: z.number().int().nonnegative().default(0),
```

Keep it `z.strictObject` — this repo is Zod 4 throughout.

- [ ] **Step 4: Enforce it in the endpoint**

In `src/routes/api/sync/+server.ts`, after the schema parse and before `getUserDbFor`:

```ts
  // A reset bumps the generation, so anything queued before it belongs to data that no
  // longer exists. Reject the batch whole — a partial application would write orphan
  // rows into the fresh database (spec §7).
  const generation = getDataGeneration(getControlDb(), locals.user.id);
  if (parsed.data.generation !== generation) {
    return json(
      {
        error: "Your data was reset. Queued entries from before the reset cannot be applied.",
        dataGeneration: generation,
      },
      { status: 409 },
    );
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/sync/ops.test.ts tests/server/sync-route.test.ts`
Expected: PASS.

- [ ] **Step 6: Publish the generation to the client**

`src/routes/+layout.server.ts` is three lines and returns `user: locals.user` wholesale.
Add the generation as a **sibling field**, not a property of `user` — `locals.user` is
built in `hooks.server.ts` and typed in `app.d.ts`, and widening it there would put a
`control.db` read into the hot path of every request including the ones that never sync:

```ts
export const load: LayoutServerLoad = ({ locals }) => ({
  user: locals.user,
  appVersion: getConfig().appVersion,
  // The generation the client's outbox must match to be accepted (spec §7). 0 for an
  // anonymous request, which is also the default a batch with no generation parses to.
  dataGeneration: locals.user ? getDataGeneration(getControlDb(), locals.user.id) : 0,
});
```

Import `getControlDb` from `$lib/server/app-state` and `getDataGeneration` from
`$lib/server/control-db`.

- [ ] **Step 7: Add `clearAll` to the outbox and honour the 409**

`src/lib/sync/idb.ts`'s module comment currently reads **"There is no `clear()`, and there
never will be."** That commitment has to be rewritten, not quietly contradicted. Replace
that paragraph with:

```
 * **Ops leave this store two ways, and only two.** The server acknowledged them, or the
 * server declared the generation they belong to void — a reset wiped the account, and
 * the data they describe no longer exists to be reconciled against (spec §7). A
 * quarantined op is neither: it is updated in place and kept, so the user can be told
 * about it, and it leaves only when the user discards it themselves.
```

Add to `OutboxStore` in `queue.ts`:

```ts
  /**
   * Drop every record, pending and quarantined. Called only on a generation mismatch —
   * the server has said this outbox describes data that no longer exists.
   */
  clearAll(): Promise<void>;
  /** Drop only the quarantined records, at the user's explicit request. */
  clearQuarantined(): Promise<void>;
```

Implement both in `idb.ts` (`store.clear()` for the first; a cursor over the `state` index
for the second).

Add `resetNotice: boolean` to `SyncStatus`, initialised `false`.

In `client.svelte.ts`'s flush, before the `!response.ok` branch:

```ts
    if (response.status === 409) {
      // The account was reset. These ops describe data that no longer exists, so there
      // is nothing to reconcile — clear them and say so. This is the one place GAIN
      // discards local data, and it is narrow by construction: only the server, only on
      // an explicit generation mismatch (spec §7).
      await outbox.clearAll();
      syncStatus.resetNotice = true;
      backoffMs = 1_000;
      await refreshCounts();
      syncStatus.state = "idle";
      return;
    }
```

- [ ] **Step 8: Surface the notice**

In `src/routes/+layout.svelte`'s `bannerText`, before the `switch`:

```ts
    if (syncStatus.resetNotice) {
      return "Your data was reset by the administrator.";
    }
```

- [ ] **Step 9: Verify and commit**

Run: `npx prettier --write src/lib/sync/ src/routes/api/sync/+server.ts src/routes/+layout.server.ts src/routes/+layout.svelte tests/sync/ops.test.ts tests/server/sync-route.test.ts && npm run verify`

```bash
git add src/lib/sync src/routes/api/sync/+server.ts src/routes/+layout.server.ts src/routes/+layout.svelte tests/sync/ops.test.ts tests/server/sync-route.test.ts docs/superpowers/plans/2026-08-17-admin-section.md
git commit -m "feat(sync): reject queued ops from before a data reset"
```

---

### Task 8: Let the user discard quarantined ops

**Files:**
- Modify: `src/routes/+layout.svelte`
- Modify: `src/lib/sync/client.svelte.ts`
- Test: `tests/sync/queue.test.ts`

**Interfaces:**
- Consumes: `OutboxStore.clearQuarantined` (Task 7).
- Produces: `discardQuarantined(): Promise<void>` exported from `client.svelte.ts`, and
  `memoryOutbox(): OutboxStore` from `tests/sync/memory-outbox.ts`.

**Why this is here.** It fixes a gap that predates the admin work: quarantined ops are held
forever and nothing in the UI can clear them, so the banner sticks permanently whether a
reset caused it or a removed exercise slug did. Task 7 touches this exact code.

**Read this before writing the test.** `tests/sync/queue.test.ts` has **no in-memory
store** — it only exercises the pure `planBatch` and `applyAck` functions, and Vitest runs
with `environment: "node"` (see `vitest.config.ts`), so there is no IndexedDB and no
`fake-indexeddb` dependency. `src/lib/sync/idb.ts` therefore has no unit coverage today,
and this task must not pretend otherwise. Split the difference honestly:

- **The interface contract** gets a real in-memory `OutboxStore` written for it, which is
  useful beyond this task and is what the test below drives.
- **The real `idb.ts` implementation** is proven in Task 9's e2e, which runs a browser and
  the actual object store. Do not claim unit coverage of `idb.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/sync/memory-outbox.ts` — a complete `OutboxStore` over a `Map`, implementing
every method of the interface, including the two Task 7 added:

```ts
import type { OutboxRecord, OutboxStore } from "../../src/lib/sync/queue";
import type { SyncOp } from "../../src/lib/sync/ops";

/**
 * An `OutboxStore` over a Map, for testing the queue's contract without a browser.
 * `src/lib/sync/idb.ts` is the real implementation and is covered by the e2e suite —
 * this proves the interface's semantics, not IndexedDB's.
 */
export function memoryOutbox(): OutboxStore {
  const records = new Map<string, OutboxRecord>();

  return {
    async append(op: SyncOp) {
      records.set(op.id, { op, state: "pending" });
    },
    async pending() {
      return [...records.values()].filter((r) => r.state === "pending").map((r) => r.op);
    },
    async ack(ids) {
      for (const id of ids) records.delete(id);
    },
    async quarantine(entries) {
      for (const { id, error } of entries) {
        const record = records.get(id);
        if (record) records.set(id, { ...record, state: "quarantined", error });
      }
    },
    async forWorkout(workoutClientId) {
      return [...records.values()].filter(
        (r) => (r.op as { workoutClientId?: string }).workoutClientId === workoutClientId,
      );
    },
    async counts() {
      const all = [...records.values()];
      return {
        pending: all.filter((r) => r.state === "pending").length,
        quarantined: all.filter((r) => r.state === "quarantined").length,
      };
    },
    async clearAll() {
      records.clear();
    },
    async clearQuarantined() {
      for (const [id, record] of records) {
        if (record.state === "quarantined") records.delete(id);
      }
    },
  };
}
```

Then in `tests/sync/queue.test.ts`:

```ts
describe("the outbox contract", () => {
  it("discards quarantined records and keeps pending ones", async () => {
    const outbox = memoryOutbox();
    await outbox.append(setOp("01"));
    await outbox.append(setOp("02"));
    await outbox.quarantine([{ id: "02", error: "unknown exercise `ghost`" }]);

    await outbox.clearQuarantined();

    expect(await outbox.counts()).toEqual({ pending: 1, quarantined: 0 });
  });

  it("clearAll drops pending and quarantined alike", async () => {
    const outbox = memoryOutbox();
    await outbox.append(setOp("01"));
    await outbox.append(setOp("02"));
    await outbox.quarantine([{ id: "02", error: "unknown exercise `ghost`" }]);

    await outbox.clearAll();

    expect(await outbox.counts()).toEqual({ pending: 0, quarantined: 0 });
  });
});
```

`setOp(id)` is already defined at the top of that file — reuse it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sync/queue.test.ts`
Expected: FAIL — `clearQuarantined` and `clearAll` are not on `OutboxStore`, so
`memoryOutbox` does not typecheck against it. (If Task 7 is already committed they are on
the interface, and the failure is instead that `memory-outbox.ts` does not exist.)

- [ ] **Step 3: Implement**

In `client.svelte.ts`:

```ts
/**
 * Drop the quarantined ops at the user's explicit request. Nothing else may call this —
 * "held, never dropped" (ARCHITECTURE §4) means held until the person whose data it is
 * decides otherwise, not held forever with no way out.
 */
export async function discardQuarantined(): Promise<void> {
  const outbox = await store();
  await outbox.clearQuarantined();
  await refreshCounts();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/sync/queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the control to the banner**

In `src/routes/+layout.svelte`, beside the rendered `bannerText`, when
`syncStatus.quarantined > 0`:

```svelte
        <button class="linklike" type="button" onclick={() => discardQuarantined()}>
          Discard
        </button>
```

Not red — §5's exception is scoped to the `/admin` reset alone. The banner already sits in
neutral chrome on every screen in the app, several of which render plan and symptom data.

- [ ] **Step 6: Verify and commit**

Run: `npx prettier --write src/lib/sync/client.svelte.ts src/routes/+layout.svelte tests/sync && npm run verify`

```bash
git add src/lib/sync/client.svelte.ts src/routes/+layout.svelte tests/sync docs/superpowers/plans/2026-08-17-admin-section.md
git commit -m "feat(sync): let the user discard ops that can never sync"
```

---

### Task 9: End-to-end walkthrough

**Files:**
- Modify: `e2e/env.ts`
- Modify: `e2e/global-setup.ts`
- Modify: `playwright.config.ts`
- Create: `e2e/admin-walkthrough.spec.ts`

**Interfaces:**
- Consumes: everything above, and the exact copy strings from Task 6.
- Produces: `E2E_ADMIN_USER` and `adminSubjectFor(projectName)` in `e2e/env.ts`; the
  durable proof this phase shipped.

**How this harness actually works** — do not invent helpers, all of this exists:

- Bypass users are named, and a spec asks for its own by setting the
  `x-gain-e2e-user` request header **before its first navigation**
  (`src/hooks.server.ts`). `page.setExtraHTTPHeaders({ "x-gain-e2e-user": name })`.
- Per-project users are minted by a function like `homeDevUserFor(projectName)` in
  `e2e/env.ts` and seeded in `e2e/global-setup.ts`. `test.use()` cannot vary by project,
  which is why the header is set inside the test body from `testInfo.project.name`.
- Plans are seeded by `seedFixturePlan(dataDir, devUser)` at global setup, not inside a
  spec.
- The overflow assertion is `assertNoHorizontalOverflow(page)` from `e2e/helpers.ts` —
  **not** `expectNoHorizontalOverflow`.

- [ ] **Step 1: Add the two user names**

In `e2e/env.ts`, beside `homeDevUserFor`:

```ts
/**
 * The one operator account. `GAIN_DEV_ADMIN` is a single environment variable read once
 * at boot, so unlike the subject below this cannot vary per project — which is fine,
 * because the admin spec asserts only on its own subject's card, never on the list as a
 * whole.
 */
export const E2E_ADMIN_USER = "e2e-admin";

/**
 * The account the admin spec resets, one per viewport project. The reset is destructive
 * and `fullyParallel: true` runs this file concurrently across all three projects, so a
 * shared subject would have its data wiped out from under a sibling run mid-assertion —
 * the same hazard `homeDevUserFor` exists for, with a sharper edge.
 */
export function adminSubjectFor(projectName: string): string {
  return `e2e-admin-subject-${projectName}`;
}
```

- [ ] **Step 2: Seed them**

In `e2e/global-setup.ts`, after the existing `homeDevUserFor` loop:

```ts
  // The operator, and one disposable account per project for it to reset.
  seedFixturePlan(E2E_DATA_DIR, E2E_ADMIN_USER);
  for (const project of E2E_VIEWPORT_PROJECTS) {
    seedFixturePlan(E2E_DATA_DIR, adminSubjectFor(project));
  }
```

Add `E2E_ADMIN_USER` and `adminSubjectFor` to the import from `./env`.

- [ ] **Step 3: Grant dev admin in both servers**

In `playwright.config.ts`, add `GAIN_DEV_ADMIN: E2E_ADMIN_USER` to the `env` of **both**
`webServer` entries, and import `E2E_ADMIN_USER` from `./e2e/env`. The built server runs
no admin spec today, but keeping the two environments identical except where they must
differ is what stops the next person debugging a phantom difference between them.

Because Task 1 made `GAIN_DEV_ADMIN` a *name* rather than a flag, every existing spec's
user stays a non-admin and no existing spec changes behaviour. Confirm that in step 6
rather than assuming it.

- [ ] **Step 4: Write the spec**

Create `e2e/admin-walkthrough.spec.ts`.

The assertions deliberately key on the **status line**, not the counts row. It is the
string that proves `statsForUsers` actually read that user's database and
`describeActivity` interpreted it — the phase-7 lesson is that asserting on a component's
shell can pass vacuously while the data path behind it never fired. "Plan imported, not
trained yet" before and "No plan yet" after is a claim only a real read-then-wipe can
satisfy.

```ts
/**
 * The operator screen's "done when" (docs/superpowers/specs/2026-08-17-admin-section-design.md):
 * an operator sees every registered user with counts, resets one, and no user's training
 * content is on the screen at any point.
 *
 * One admin account shared across projects, one disposable subject per project — see
 * `adminSubjectFor`. `GAIN_DEV_ADMIN` (playwright.config.ts) is what makes the first of
 * those an operator; every other spec's bypass user stays a normal user.
 */

import { expect, test } from "@playwright/test";
import { E2E_ADMIN_USER, E2E_PLAN_SLUG, adminSubjectFor, homeDevUserFor } from "./env";
import { assertNoHorizontalOverflow } from "./helpers";

test("an operator sees counts, resets one user, and never sees plan content", async ({
  page,
}, testInfo) => {
  const subject = adminSubjectFor(testInfo.project.name);
  await page.setExtraHTTPHeaders({ "x-gain-e2e-user": E2E_ADMIN_USER });

  await page.goto("/admin");

  const card = page.locator("li.card", { hasText: subject });
  await expect(card).toBeVisible();

  // The seeded subject has a plan and has never trained. This string can only be right
  // if the cross-user read actually happened.
  await expect(card.locator(".status")).toHaveText("Plan imported, not trained yet");

  // Counts only: nothing naming the plan reaches the operator.
  await expect(page.getByText(E2E_PLAN_SLUG)).toHaveCount(0);

  await card.getByRole("button", { name: "Reset data…" }).click();

  const confirm = card.getByRole("button", { name: `Reset ${subject}'s data` });
  await expect(confirm).toBeDisabled();

  // The widest state the card ever reaches — input plus two buttons — in both themes.
  await assertNoHorizontalOverflow(page);
  await page.emulateMedia({ colorScheme: "light" });
  await assertNoHorizontalOverflow(page);
  await page.emulateMedia({ colorScheme: "dark" });

  await card.getByLabel(`Type ${subject} to confirm`).fill(subject);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // Scoped to the page body: the sync banner in the root layout is also a live region,
  // so a bare getByRole("status") can match two nodes.
  await expect(page.locator("p.done")).toHaveText(`Reset ${subject}'s data.`);

  // The account survives the reset; only its data is gone.
  const after = page.locator("li.card", { hasText: subject });
  await expect(after).toBeVisible();
  await expect(after.locator(".status")).toHaveText("No plan yet");
});

test("the operator screen is invisible to everyone else", async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ "x-gain-e2e-user": homeDevUserFor(testInfo.project.name) });

  const response = await page.goto("/admin");

  // 404, not 403: a 403 would confirm both that the route exists and that this instance
  // has an operator configured.
  expect(response?.status()).toBe(404);
});
```

If `p.done` or `li.card` do not match what Task 6 actually built, fix the **selector**
here to match the component — do not loosen the assertion to make it pass.

- [ ] **Step 5: Run the new spec at one viewport**

Run: `npx playwright test --project=iphone e2e/admin-walkthrough.spec.ts`
Expected: PASS. Needs `npx playwright install chromium` once first (~150 MB).

- [ ] **Step 6: Run the whole suite**

Run: `npm run test:e2e`
Expected: PASS, including every pre-existing spec. This is the step that proves
`GAIN_DEV_ADMIN` disturbed nothing — if a spec fails, fix the configuration, not the spec.

Note this runs the `offline` project too, which does a full production build, so it is
noticeably slower than the other three combined.

- [ ] **Step 7: Commit**

```bash
git add e2e/admin-walkthrough.spec.ts e2e/env.ts e2e/global-setup.ts playwright.config.ts docs/superpowers/plans/2026-08-17-admin-section.md
git commit -m "test(e2e): walk the operator screen and a reset end to end"
```
---

### Task 10: Documentation and status

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `README.md`, `docs/ROADMAP.md`, `CLAUDE.md`, `todo.md`

**Interfaces:** none. This is the "keep the status current" step CLAUDE.md requires in the
same commit that closes the work.

- [ ] **Step 1: ARCHITECTURE**

- §2, decision 4 → `Gated on an Authentik group, auto-provision on first login, optional operator role on a second group`.
- §3's data-directory listing: annotate `control.db` as `users, oidc subject → user id, sessions, display label, no training data`.
- §3's compose example: add `OIDC_ADMIN_GROUP: gain-admins`.
- §4's closing paragraph, replacing "There is no admin role and no user-management UI":

```markdown
There is one optional operator role, gated on a second Authentik group
(`OIDC_ADMIN_GROUP`); leave it unset and the instance has no admin at all. The operator
sees that a user exists, when they were last active, and how much they have logged, and
can reset any user's data to a clean slate. They cannot read any of it. No plan, exercise,
set, metric or note is reachable from `/admin` through any code path — every cross-user
read in the app lives in `src/lib/server/admin-stats.ts` and returns nothing but counts,
dates and byte totals. Access itself is still administered entirely in Authentik.
```

- §12's build-order table: a phase 9 row, "Done when" matching ROADMAP.

- [ ] **Step 2: README**

Line 84's isolation claim becomes: no admin role that can read anyone's training *content*
— the operator sees per-user counts and can reset a user's data, nothing more.

- [ ] **Step 3: ROADMAP**

Add phase 9, "Operations", with the acceptance criteria from the spec's "Done when", and
tick its items with their commit SHAs. Phase 8 keeps its place as next.

- [ ] **Step 4: CLAUDE.md**

Add to Invariants:

```markdown
- **The operator sees counts, never content — and the reset's order is load-bearing.**
  `OIDC_ADMIN_GROUP` grants a `/admin` screen (ARCHITECTURE §4) whose every cross-user
  read goes through `src/lib/server/admin-stats.ts`, which returns only `COUNT(*)`,
  `MAX(...)` and byte totals. Nothing else in the app may open another user's `gain.db`;
  putting a second such reader anywhere else dissolves the guarantee, because it is the
  single module boundary — not a rule — that keeps it true. The reset in
  `src/lib/server/admin-reset.ts` closes and evicts the cached handle **before** the
  unlink: `better-sqlite3` holds the file open, so unlinking first leaves the process
  writing to a deleted inode and the reset silently does nothing. It also bumps
  `control_user.data_generation`, which is what stops the wiped user's offline outbox
  flushing back in and quarantining forever — the one place GAIN deliberately discards
  local data, and narrow by construction: only on the server's explicit 409.
```

Update the "Current state" paragraph to say phase 9 shipped.

- [ ] **Step 5: `todo.md`**

Delete the entire "Admin section" item. Per that file's own rules the work moved to the
roadmap; the commit history is the record.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify` (docs are prettier-ignored, but `check:chars` still covers them).

```bash
git add docs README.md CLAUDE.md todo.md
git commit -m "docs(admin): record the operator role and close the phase"
```

---

## Self-Review

**Spec coverage:** §2 decision 1 → Task 1; decision 2 → Tasks 2, 3; decision 3 → Task 5;
decision 4 (no self-service) → out of scope, `resetUserData` takes only a `userId` so a
later account screen calls it unchanged; decision 5 → Task 7; decision 6 → Task 6 step 11.
§3 → Tasks 1, 3. §4 → Task 2. §5 → Task 4. §6 → Task 5. §7 → Tasks 7, 8. §8 → Task 6.
§9 → tests inside Tasks 1–8 plus Task 9. §10 → Task 10. §11 out of scope, unbuilt.

**Three spec refinements made here, all improvements:**

1. `GAIN_DEV_ADMIN` names a bypass user instead of being a boolean. The spec's §9 flagged
   "makes every bypass user an admin" as a wrinkle to resolve; making it a name resolves it
   rather than working around it, because `hooks.server.ts` already routes per-spec bypass
   users through the `x-gain-e2e-user` header.
2. §5's `readonly` open gets an explicit fallback, and the module comment states plainly
   that the guarantee lives in the count-only query surface rather than the connection
   flag.
3. §8's card gains an interpretive status line (`src/lib/admin/user-status.ts`), pure and
   clock-injected. The spec described a stats card; the operator's actual question is
   whether a person is alive on the platform, and a row of counts makes them do that
   arithmetic themselves. It also gives Task 9 an assertion that cannot pass vacuously.

**Verified against the codebase, not assumed.** Every signature, helper and path in this
plan was checked against the files it names. Corrections that came out of that pass, listed
so a reader who half-remembers an earlier draft does not "fix" them back:

| Assumption | Reality |
|---|---|
| `importPlan` in `db/import.ts`, takes `{ sourceMd, now }` | `db/import-plan.ts`, takes `{ parsed, now }` — parse first with `parsePlanDocument` |
| `auth.test.ts` has `setupSession` / `deps({ refreshGroups })` | It has `seedSession`, `deps({ token, userinfo, … })`, `check`, `idToken`, `json`; group answers are built as real signed ID tokens |
| `e2e/helpers.ts` exports `expectNoHorizontalOverflow`, `asUser`, `seedPlan` | Only `assertNoHorizontalOverflow` exists; users come from the `x-gain-e2e-user` header, plans from `seedFixturePlan` at global setup |
| `tests/sync/queue.test.ts` has an in-memory store | It tests pure functions only; Vitest runs `environment: "node"` with no IndexedDB, so Task 8 adds `tests/sync/memory-outbox.ts` and defers real `idb.ts` proof to e2e |
| `+layout.server.ts` needs `isAdmin` added | It returns `user: locals.user` wholesale, so `isAdmin` flows for free; only `dataGeneration` needs adding, as a sibling field |
| The OIDC subject renders in monospace | UI-DECISIONS §10: one family, no monospace anywhere. It renders in the body face at `--dim`, wrapped, never truncated |
| `minmax(0, 1fr)` for the card grid | `minmax(min(100%, 22rem), 1fr)` — the version that both shrinks below 360 px and still forms columns on a tablet |
| `tests/server/*` import via `$lib` | That directory imports by relative path (`../../src/lib/…`) |

**Type consistency:** `statsForUsers(dataDir, users)` and `resetUserData(control, dataDir, userId)`
are used with those signatures everywhere they appear. `describeActivity` and
`confirmationFor` are defined once in `src/lib/admin/user-status.ts` and imported by
`+page.server.ts`; the component receives `status` and `confirmation` as resolved strings
on `data.users`, so nothing is duplicated between server and client and the status line
cannot disagree between SSR and hydration.

**Known coverage gap, stated rather than papered over:** `src/lib/sync/idb.ts` has no unit
test before or after this plan, because the suite has no DOM environment. Task 8 covers the
`OutboxStore` contract with an in-memory implementation and Task 9 exercises the real
IndexedDB path in a browser. Adding `fake-indexeddb` would close it properly and is out of
scope here.
