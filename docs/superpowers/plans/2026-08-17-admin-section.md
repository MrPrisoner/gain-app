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
  table.
- **Red is permitted on exactly one control:** the reset button and its confirm state on
  `/admin`. Nowhere else — not admin errors, not destructive actions generally.
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

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/config.test.ts`:

```ts
describe("admin configuration", () => {
  const oidcEnv = {
    OIDC_ISSUER: "https://auth.example.com/application/o/gain/",
    OIDC_CLIENT_ID: "gain",
    OIDC_CLIENT_SECRET: "secret",
    OIDC_REQUIRED_GROUP: "gain-users",
    ORIGIN: "https://gain.example.com",
    SESSION_SECRET: "s".repeat(64),
  };

  it("carries the admin group when OIDC is complete", () => {
    const config = loadConfig({ ...oidcEnv, OIDC_ADMIN_GROUP: "gain-admins" }, "production");
    expect(config.adminGroup).toBe("gain-admins");
    expect(config.devAdmin).toBeNull();
  });

  it("defaults to no admin at all", () => {
    const config = loadConfig(oidcEnv, "production");
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
    expect(() => loadConfig({ ...oidcEnv, GAIN_DEV_ADMIN: "dev" }, "production")).toThrow(
      /GAIN_DEV_ADMIN/,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server/config.test.ts`
Expected: FAIL — `config.adminGroup` is `undefined`, and neither error is thrown.

- [ ] **Step 3: Implement**

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/server/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Document the variables**

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

- [ ] **Step 6: Verify and commit**

Run: `npx prettier --write src/lib/server/config.ts tests/server/config.test.ts && npm run verify`
Expected: all green.

```bash
git add src/lib/server/config.ts tests/server/config.test.ts .env.example compose.yaml
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

- [ ] **Step 1: Write the failing tests**

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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server/control-db.test.ts`
Expected: FAIL — the new functions are not exported.

- [ ] **Step 3: Add migration 002**

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

- [ ] **Step 4: Update the row types and `createUser`/`createSession`**

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

- [ ] **Step 5: Add the new accessors**

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

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/server/control-db.test.ts`
Expected: PASS. Other suites will now fail to typecheck on `createSession` — Task 3 fixes
the callback; fix `tests/server/auth.test.ts` call sites here by adding `isAdmin: false`.

- [ ] **Step 7: Verify and commit**

Run: `npx prettier --write src/lib/server/control-db.ts tests/server/control-db.test.ts && npm run verify`

```bash
git add src/lib/server/control-db.ts tests/server/control-db.test.ts tests/server/auth.test.ts
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

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/auth.test.ts`, following the existing helpers that mint real signed
JWTs and a fake token endpoint:

```ts
describe("admin flag lifecycle", () => {
  it("reports the stored session flag", async () => {
    const { control, cookies, config, oidc } = await setupSession({ isAdmin: true });
    const check = await checkSession(cookies, config, oidc, new Date(), deps(control));
    expect(check).toMatchObject({ status: "ok", isAdmin: true });
  });

  it("drops the flag when a refresh shows the admin group is gone", async () => {
    const { control, cookies, config, oidc, sessionId } = await setupSession({
      isAdmin: true,
      accessExpiresInMs: -1,
    });
    // Refresh returns an ID token listing the required group but not the admin group.
    const check = await checkSession(
      cookies,
      config,
      oidc,
      new Date(),
      deps(control, { refreshGroups: ["gain-users"] }),
    );
    expect(check).toMatchObject({ status: "ok", isAdmin: false });
    expect(getSession(control, sessionId, new Date())?.is_admin).toBe(0);
  });

  it("leaves the flag untouched when groups cannot be established", async () => {
    const { control, cookies, config, oidc, sessionId } = await setupSession({
      isAdmin: true,
      accessExpiresInMs: -1,
    });
    // No id_token in the refresh response and no reachable userinfo — `null`, not `[]`.
    const check = await checkSession(
      cookies,
      config,
      oidc,
      new Date(),
      deps(control, { refreshGroups: null }),
    );
    expect(check).toMatchObject({ status: "ok", isAdmin: true });
    expect(getSession(control, sessionId, new Date())?.is_admin).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server/auth.test.ts`
Expected: FAIL — `isAdmin` is not on `SessionCheck`.

- [ ] **Step 3: Thread the flag through `checkSession`**

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/server/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Set the flag and the label at login**

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

- [ ] **Step 6: Expose it on `locals`**

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

- [ ] **Step 7: Verify and commit**

Run: `npx prettier --write src/lib/server/auth.ts src/lib/server/oidc.ts src/routes/auth/callback/+server.ts src/hooks.server.ts src/app.d.ts && npm run verify`

```bash
git add src/lib/server/auth.ts src/lib/server/oidc.ts src/routes/auth/callback/+server.ts src/hooks.server.ts src/app.d.ts tests/server/auth.test.ts
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

- [ ] **Step 1: Write the failing test**

Create `tests/server/admin-stats.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openUserDb } from "$lib/db/user-db";
import { importPlan } from "$lib/db/import";
import { statsForUsers } from "$lib/server/admin-stats";
import type { ControlUser } from "$lib/server/control-db";

const fixture = fs.readFileSync("fixtures/plans/home-training-v1.md", "utf8");

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
    const db = openUserDb(dataDir, "alice", { now: new Date(), seedTemplates: [] });
    importPlan(db, { sourceMd: fixture, now: new Date() });
    db.close();

    const [stats] = statsForUsers(dataDir, [user("alice")]);
    expect(stats.provisioned).toBe(true);
    expect(stats.plans).toBe(1);
    expect(stats.planVersions).toBe(1);
    expect(stats.workoutsStarted).toBe(0);
    expect(stats.diskBytes).toBeGreaterThan(0);
    // The plan's name appears nowhere in what the operator receives.
    expect(JSON.stringify(stats)).not.toContain("Home");
  });

  it("opens a cold WAL database that has never been written to", () => {
    // Provision and close immediately: no -shm exists on disk. A readonly open of a
    // WAL database can fail here with SQLITE_CANTOPEN, so the module must fall back.
    openUserDb(dataDir, "cold", { now: new Date(), seedTemplates: [] }).close();
    fs.rmSync(path.join(dataDir, "users", "cold", "gain.db-shm"), { force: true });
    fs.rmSync(path.join(dataDir, "users", "cold", "gain.db-wal"), { force: true });

    expect(() => statsForUsers(dataDir, [user("cold")])).not.toThrow();
    expect(statsForUsers(dataDir, [user("cold")])[0].plans).toBe(0);
  });

  it("keeps one user's counts out of another's", () => {
    const db = openUserDb(dataDir, "alice", { now: new Date(), seedTemplates: [] });
    importPlan(db, { sourceMd: fixture, now: new Date() });
    db.close();
    openUserDb(dataDir, "bob", { now: new Date(), seedTemplates: [] }).close();

    const stats = statsForUsers(dataDir, [user("alice"), user("bob")]);
    expect(stats.find((s) => s.userId === "alice")?.plans).toBe(1);
    expect(stats.find((s) => s.userId === "bob")?.plans).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/server/admin-stats.test.ts`
Expected: FAIL — cannot resolve `$lib/server/admin-stats`.

- [ ] **Step 3: Implement**

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/server/admin-stats.test.ts`
Expected: PASS. If the cold-WAL case still throws, the fallback branch is wrong — fix it
rather than deleting the test.

- [ ] **Step 5: Verify and commit**

Run: `npx prettier --write src/lib/server/admin-stats.ts tests/server/admin-stats.test.ts && npm run verify`

```bash
git add src/lib/server/admin-stats.ts tests/server/admin-stats.test.ts
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

- [ ] **Step 1: Write the failing test**

Create `tests/server/admin-reset.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openUserDb } from "$lib/db/user-db";
import { importPlan } from "$lib/db/import";
import { resetUserData } from "$lib/server/admin-reset";
import { openControlDb, createUser, createSession, getSession } from "$lib/server/control-db";
import { getUserDbFor, resetAppStateForTests } from "$lib/server/app-state";
import { statsForUsers, } from "$lib/server/admin-stats";

const fixture = fs.readFileSync("fixtures/plans/home-training-v1.md", "utf8");
let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-admin-reset-"));
});
afterEach(() => {
  resetAppStateForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("resetUserData", () => {
  it("wipes the directory, bumps the generation, and re-provisions", () => {
    const control = openControlDb(dataDir, new Date());
    const user = createUser(control, "sub-a", new Date());
    const db = openUserDb(dataDir, user.id, { now: new Date(), seedTemplates: [] });
    importPlan(db, { sourceMd: fixture, now: new Date() });
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
    const control = openControlDb(dataDir, new Date());
    const user = createUser(control, "sub-a", new Date());
    openUserDb(dataDir, user.id, { now: new Date(), seedTemplates: [] }).close();
    const session = createSession(control, {
      userId: user.id,
      now: new Date(),
      idleMs: 60_000,
      tokens: { access_token: null, access_expires_at: null, refresh_token: null, id_token: null },
      isAdmin: false,
    });

    resetUserData(control, dataDir, user.id);
    expect(getSession(control, session.id, new Date())).toBeUndefined();
    control.close();
  });

  it("closes the cached handle before unlinking, so the fresh db is genuinely empty", () => {
    const control = openControlDb(dataDir, new Date());
    const user = createUser(control, "sub-a", new Date());
    // Warm the process-wide cache the way a live request would.
    const cached = getUserDbFor(user.id);
    importPlan(cached, { sourceMd: fixture, now: new Date() });

    resetUserData(control, dataDir, user.id);

    // A stale handle would still answer from the deleted inode and report 1.
    const fresh = getUserDbFor(user.id);
    const n = fresh.db.prepare("SELECT COUNT(*) AS n FROM plan").get() as { n: number };
    expect(n.n).toBe(0);
    control.close();
  });

  it("leaves another user untouched", () => {
    const control = openControlDb(dataDir, new Date());
    const a = createUser(control, "sub-a", new Date());
    const b = createUser(control, "sub-b", new Date());
    for (const id of [a.id, b.id]) {
      const db = openUserDb(dataDir, id, { now: new Date(), seedTemplates: [] });
      importPlan(db, { sourceMd: fixture, now: new Date() });
      db.close();
    }

    resetUserData(control, dataDir, a.id);

    expect(statsForUsers(dataDir, [{ ...b }])[0].plans).toBe(1);
    control.close();
  });
});
```

Note: `getUserDbFor` reads `getConfig().dataDir`, so this test needs the config pointed at
the temp directory. Set `process.env.DATA_DIR = dataDir` in `beforeEach` and call
`resetConfigForTests()` — the same pattern `tests/server/first-run.test.ts` already uses.
Copy that file's setup rather than inventing a second one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/server/admin-reset.test.ts`
Expected: FAIL — cannot resolve `$lib/server/admin-reset`.

- [ ] **Step 3: Add the eviction and reset guard to `app-state.ts`**

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

- [ ] **Step 4: Implement the reset**

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

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/server/admin-reset.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run: `npx prettier --write src/lib/server/admin-reset.ts src/lib/server/app-state.ts tests/server/admin-reset.test.ts && npm run verify`

```bash
git add src/lib/server/admin-reset.ts src/lib/server/app-state.ts tests/server/admin-reset.test.ts
git commit -m "feat(admin): add the ordered per-user data reset"
```

---

### Task 6: The `/admin` route

**Files:**
- Create: `src/routes/admin/+page.server.ts`
- Create: `src/routes/admin/+page.svelte`
- Modify: `src/routes/+layout.svelte`
- Modify: `src/routes/+layout.server.ts`
- Modify: `docs/UI-DECISIONS.md`
- Test: `tests/server/admin-route.test.ts`

**Interfaces:**
- Consumes: `locals.user.isAdmin` (Task 3), `statsForUsers` (Task 4), `resetUserData`
  (Task 5), `listUsers` (Task 2).
- Produces: nothing later tasks consume, except the e2e selectors in Task 9.

- [ ] **Step 1: Write the failing test**

Create `tests/server/admin-route.test.ts`, following `tests/server/export-route.test.ts`
for how a route module's `load` and `actions` are invoked directly:

```ts
describe("/admin guard", () => {
  it("404s for a signed-in non-admin", async () => {
    await expect(load({ locals: { user: { id: "u1", isAdmin: false } } } as never)).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it("404s for an anonymous request", async () => {
    await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 404 });
  });

  it("lists users for an admin", async () => {
    const result = await load({ locals: { user: { id: "u1", isAdmin: true } } } as never);
    expect(Array.isArray(result.users)).toBe(true);
  });
});

describe("?/reset", () => {
  it("returns a 400 rather than throwing when the confirmation does not match", async () => {
    const result = await actions.reset({
      locals: { user: { id: "u1", isAdmin: true } },
      request: formRequest({ userId: target.id, confirmLabel: "wrong" }),
    } as never);
    expect(result).toMatchObject({ status: 400 });
    expect(result.data.actionError).toMatch(/does not match/i);
  });

  it("404s for a non-admin even with a valid confirmation", async () => {
    await expect(
      actions.reset({
        locals: { user: { id: "u1", isAdmin: false } },
        request: formRequest({ userId: target.id, confirmLabel: "alice" }),
      } as never),
    ).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/server/admin-route.test.ts`
Expected: FAIL — the route module does not exist.

- [ ] **Step 3: Implement the server route**

Create `src/routes/admin/+page.server.ts`:

```ts
/**
 * The operator screen (spec §8).
 *
 * A non-admin gets **404, not 403**. A 403 confirms both that the route exists and that
 * this instance has an operator; a 404 says nothing at all.
 */

import { error, fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { getControlDb } from "$lib/server/app-state";
import { getConfig } from "$lib/server/config";
import { listUsers } from "$lib/server/control-db";
import { statsForUsers } from "$lib/server/admin-stats";
import { resetUserData } from "$lib/server/admin-reset";

function requireAdmin(locals: App.Locals): void {
  if (!locals.user?.isAdmin) throw error(404, "Not found");
}

/** What the operator must type to confirm. The label when there is one; a stable, */
/** unambiguous tail of the ULID when there is not. */
export function confirmationFor(displayLabel: string | null, userId: string): string {
  return displayLabel ?? userId.slice(-6);
}

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  const config = getConfig();
  return { users: statsForUsers(config.dataDir, listUsers(getControlDb())) };
};

export const actions: Actions = {
  reset: async ({ locals, request }) => {
    requireAdmin(locals);

    const form = await request.formData();
    const userId = String(form.get("userId") ?? "");
    const typed = String(form.get("confirmLabel") ?? "").trim();

    const control = getControlDb();
    const target = listUsers(control).find((u) => u.id === userId);
    if (!target) return fail(400, { actionError: "That user no longer exists." });

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
      // the screen along with any sense of what happened.
      return fail(400, {
        actionError: err instanceof Error ? err.message : "The reset failed.",
        userId,
      });
    }

    return { resetLabel: expected };
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/server/admin-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the page**

Create `src/routes/admin/+page.svelte`. Runes mode — `$props`, `$state`, `$derived`; no
`export let`. A **card list, not a table**: a stats table cannot survive 360 px without
horizontal overflow, which UI-DECISIONS §12 forbids and the e2e suite asserts against.

```svelte
<script lang="ts">
  import { enhance } from "$app/forms";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  /** Which card has its confirmation field open. One at a time, by construction. */
  let openFor = $state<string | null>(null);
  let typed = $state("");

  function confirmationFor(label: string | null, id: string): string {
    return label ?? id.slice(-6);
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

  function formatDate(iso: string | null): string {
    return iso ? iso.slice(0, 10) : "never";
  }
</script>

<svelte:head><title>Admin — GAIN</title></svelte:head>

<h1>Users</h1>
<p class="lede">
  Counts only. Plans, exercises and logs stay private to the user who wrote them.
</p>

{#if form?.resetLabel}
  <p class="notice" role="status">Reset {form.resetLabel} to a clean slate.</p>
{/if}

<ul class="users">
  {#each data.users as user (user.userId)}
    {@const confirmation = confirmationFor(user.displayLabel, user.userId)}
    <li class="card">
      <h2>{user.displayLabel ?? "(no label yet)"}</h2>
      <p class="sub">{user.oidcSub}</p>

      <dl class="stats">
        <div><dt>Last login</dt><dd>{formatDate(user.lastLoginAt)}</dd></div>
        <div><dt>Last workout</dt><dd>{formatDate(user.lastWorkoutAt)}</dd></div>
        <div><dt>Plans</dt><dd>{user.plans} ({user.planVersions} versions)</dd></div>
        <div><dt>Workouts</dt><dd>{user.workoutsFinished} / {user.workoutsStarted}</dd></div>
        <div><dt>Sets</dt><dd>{user.setLogs}</dd></div>
        <div><dt>On disk</dt><dd>{formatBytes(user.diskBytes)}</dd></div>
      </dl>

      {#if openFor === user.userId}
        <form
          method="POST"
          action="?/reset"
          use:enhance={() => {
            return async ({ update }) => {
              await update();
              openFor = null;
              typed = "";
            };
          }}
        >
          <input type="hidden" name="userId" value={user.userId} />
          <label for="confirm-{user.userId}">
            This erases every plan, workout and log. Type <strong>{confirmation}</strong> to
            confirm.
          </label>
          <input
            id="confirm-{user.userId}"
            name="confirmLabel"
            bind:value={typed}
            autocomplete="off"
          />
          {#if form?.actionError && form?.userId === user.userId}
            <p class="action-error" role="alert">{form.actionError}</p>
          {/if}
          <div class="row">
            <button class="danger" type="submit" disabled={typed !== confirmation}>
              Reset this user's data
            </button>
            <button type="button" onclick={() => ((openFor = null), (typed = ""))}>Cancel</button>
          </div>
        </form>
      {:else}
        <button class="danger-outline" type="button" onclick={() => (openFor = user.userId)}>
          Reset data…
        </button>
      {/if}
    </li>
  {/each}
</ul>
```

Styles: follow `src/app.css`'s existing tokens. The destructive control is the one place
red is permitted — use `var(--red)` for the confirmed button's background and the outline
button's border. Everything else stays neutral. The card grid must use
`grid-template-columns: repeat(auto-fit, minmax(0, 1fr))` with `minmax(0, …)`, not
`minmax(<size>, …)` — a floor that cannot shrink is exactly the phase-4 overflow bug.

- [ ] **Step 6: Link it from the header**

In `src/routes/+layout.server.ts`, add `isAdmin: locals.user?.isAdmin ?? false` to the
returned `user` object. In `src/routes/+layout.svelte`, inside `.top-right` before the
sign-out form:

```svelte
      {#if data.user?.isAdmin}
        <a class="linklike" href="/admin">Admin</a>
      {/if}
```

- [ ] **Step 7: Record the UI-DECISIONS exception**

In `docs/UI-DECISIONS.md` §5, after the existing celebration-confetti exception, add a
second one. Match the file's prose voice — it argues a case, it is not a bullet list:

```markdown
**A second narrow exception, settled 2026-08-17:** the reset control on `/admin` is red.
The triad above belongs to the plan's pain-response framework, and it earns its
exclusivity on the surfaces where a user reads their own body signals — the session
runner, progress, the export. `/admin` carries no plan and no symptom data at all, so
there is no scale for red to compete with there, and red is the conventional and correct
signal for an irreversible destructive action. The exception is that control and its
confirmed state, on that route. It does not extend to errors on the admin screen, and it
does not licence a red destructive style anywhere that renders plan or symptom data.
```

- [ ] **Step 8: Verify and commit**

Run: `npx prettier --write src/routes/admin/ src/routes/+layout.svelte src/routes/+layout.server.ts tests/server/admin-route.test.ts && npm run verify`

Note `docs/` is prettier-ignored — do not pass `docs/UI-DECISIONS.md` to prettier.

```bash
git add src/routes/admin tests/server/admin-route.test.ts src/routes/+layout.svelte src/routes/+layout.server.ts docs/UI-DECISIONS.md
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

In `src/routes/+layout.server.ts`, add `dataGeneration: getDataGeneration(getControlDb(), locals.user.id)`
to the returned user object (0 when there is no user).

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
git add src/lib/sync src/routes/api/sync/+server.ts src/routes/+layout.server.ts src/routes/+layout.svelte tests/sync/ops.test.ts tests/server/sync-route.test.ts
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
- Produces: `discardQuarantined(): Promise<void>` exported from `client.svelte.ts`.

**Why this is here.** It fixes a gap that predates the admin work: quarantined ops are held
forever and nothing in the UI can clear them, so the banner sticks permanently whether a
reset caused it or a removed exercise slug did. Task 7 touches this exact code.

- [ ] **Step 1: Write the failing test**

In `tests/sync/queue.test.ts`, against the in-memory store the file already uses:

```ts
it("discards quarantined records and keeps pending ones", async () => {
  await outbox.append(pendingOp);
  await outbox.append(badOp);
  await outbox.quarantine([{ id: badOp.id, error: "unknown exercise" }]);

  await outbox.clearQuarantined();

  expect(await outbox.counts()).toEqual({ pending: 1, quarantined: 0 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sync/queue.test.ts`
Expected: FAIL — `clearQuarantined` is not on the test double.

- [ ] **Step 3: Implement**

Add `clearQuarantined` to the in-memory test store, then in `client.svelte.ts`:

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

Not red — §5's exception is scoped to `/admin` alone.

- [ ] **Step 6: Verify and commit**

Run: `npx prettier --write src/lib/sync/client.svelte.ts src/routes/+layout.svelte tests/sync/queue.test.ts && npm run verify`

```bash
git add src/lib/sync/client.svelte.ts src/routes/+layout.svelte tests/sync/queue.test.ts
git commit -m "feat(sync): let the user discard ops that can never sync"
```

---

### Task 9: End-to-end walkthrough

**Files:**
- Create: `e2e/admin-walkthrough.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: the durable proof this phase shipped.

- [ ] **Step 1: Grant dev admin in the Playwright server env**

In `playwright.config.ts`'s `webServer.env`, add `GAIN_DEV_ADMIN: "admin-e2e"`. Because
Task 1 made this a *name*, only the bypass user called `admin-e2e` becomes an operator —
every existing spec's user stays non-admin, so no existing spec changes behaviour. Confirm
that by running the full suite in step 4, not by assuming it.

- [ ] **Step 2: Write the spec**

Create `e2e/admin-walkthrough.spec.ts`. Reuse `e2e/helpers.ts` for gestures and
`e2e/seed.ts` for getting a plan in; drive the two users through the `x-gain-e2e-user`
header exactly as `e2e/home-walkthrough.spec.ts` does per viewport.

```ts
import { test, expect } from "@playwright/test";
import { asUser, seedPlan, expectNoHorizontalOverflow } from "./helpers";

test("an operator sees counts, resets one user, and leaves the other alone", async ({
  browser,
}, testInfo) => {
  // Per-viewport user names, so the four projects never share state (see dd543bc).
  const suffix = testInfo.project.name;
  const subject = `subject-${suffix}`;

  const subjectPage = await asUser(browser, subject);
  await seedPlan(subjectPage);
  await subjectPage.close();

  const adminPage = await asUser(browser, "admin-e2e");
  await adminPage.goto("/admin");

  const card = adminPage.locator(".card", { hasText: subject });
  await expect(card).toBeVisible();
  await expect(card.getByText("1 (1 versions)")).toBeVisible();
  await expectNoHorizontalOverflow(adminPage);

  // The plan's name never reaches the operator.
  await expect(adminPage.getByText("Home training")).toHaveCount(0);

  await card.getByRole("button", { name: /Reset data/ }).click();
  const confirm = card.getByRole("button", { name: /Reset this user's data/ });
  await expect(confirm).toBeDisabled();

  await card.getByLabel(/Type/).fill(subject);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(adminPage.getByRole("status")).toContainText(subject);
  await expect(adminPage.locator(".card", { hasText: subject }).getByText("0 (0 versions)")).toBeVisible();
});

test("a non-admin gets a 404", async ({ browser }, testInfo) => {
  const page = await asUser(browser, `plain-${testInfo.project.name}`);
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
});
```

If `asUser`, `seedPlan` or `expectNoHorizontalOverflow` are named differently in
`e2e/helpers.ts`, use the real names — read that file first rather than adding duplicates.

- [ ] **Step 3: Run the new spec at one viewport**

Run: `npx playwright test --project=iphone e2e/admin-walkthrough.spec.ts`
Expected: PASS. Needs `npx playwright install chromium` once first.

- [ ] **Step 4: Run the whole suite**

Run: `npm run test:e2e`
Expected: PASS, including every pre-existing spec. If `GAIN_DEV_ADMIN` disturbed one, fix
the config rather than the spec.

- [ ] **Step 5: Commit**

```bash
git add e2e/admin-walkthrough.spec.ts playwright.config.ts
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
later account screen calls it unchanged; decision 5 → Task 7; decision 6 → Task 6 step 7.
§3 → Tasks 1, 3. §4 → Task 2. §5 → Task 4. §6 → Task 5. §7 → Tasks 7, 8. §8 → Task 6.
§9 → tests inside Tasks 1–8 plus Task 9. §10 → Task 10. §11 out of scope, unbuilt.

**Two spec refinements made here, both improvements:**

1. `GAIN_DEV_ADMIN` names a bypass user instead of being a boolean. The spec's §9 flagged
   "makes every bypass user an admin" as a wrinkle to resolve; making it a name resolves it
   rather than working around it.
2. §5's `readonly` open gets an explicit fallback, and the module comment states plainly
   that the guarantee lives in the query surface rather than the connection flag.

**Type consistency:** `statsForUsers(dataDir, users)` is used with that signature in Tasks
5 and 6. `resetUserData(control, dataDir, userId)` likewise. `confirmationFor` is defined
in `+page.server.ts` and duplicated in the component deliberately — the component cannot
import from a `+page.server.ts` module, and both are exercised by Task 6's tests and Task
9's spec.
