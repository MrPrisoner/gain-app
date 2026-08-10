/**
 * Seeds a runnable app state without an IdP or a live SvelteKit server —
 * everything a browser test needs on disk before the dev server boots.
 *
 * Calls the same functions `tests/server/first-run.test.ts` drives through
 * `src/routes/+page.server.ts`'s actions, and mirrors what `hooks.server.ts`
 * does for `GAIN_DEV_USER` — never a hand-written row:
 *  - the user is provisioned exactly like `ensureBypassUser`
 *    (`src/lib/server/auth.ts`) does, keyed on the same `dev-bypass:<user>`
 *    synthetic sub, so a browser signing in with the same `GAIN_DEV_USER`
 *    value lands on the same account this seeded;
 *  - the plan is committed through `parsePlanDocument` + `importPlan`, the
 *    same parse-then-write path the `confirmImport` action calls.
 *
 * This module intentionally imports `src/lib/**` by relative path rather than
 * the `$lib` alias, and skips `src/routes/+page.server.ts` and
 * `src/lib/server/app-state.ts` entirely: both sit behind Vite's module
 * graph (the route file only resolves `$lib` inside a Vite/SvelteKit
 * context, and `app-state.ts` pulls in `assets.ts`'s `?raw` markdown
 * imports, which only Vite — including Vitest's Vite-based runner — knows
 * how to load). Playwright's config and global-setup files run under plain
 * Node with no such loader, so this helper stays one level below both: the
 * library functions, not the framework glue around them.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { parsePlanDocument } from "../src/lib/parse/parser";
import { importPlan } from "../src/lib/db/import-plan";
import { openUserDb } from "../src/lib/db/user-db";
import { openControlDb, findUserBySub, createUser } from "../src/lib/server/control-db";

const FIXTURE_PATH = path.join(process.cwd(), "fixtures/plans/home-dumbbell-v1.md");
const AI_INSTRUCTIONS_PATH = path.join(process.cwd(), "templates/default-ai-instructions.md");

export type SeededFixture = {
  userId: string;
  dataDir: string;
};

/**
 * Provisions `dataDir` with a bypass user and the fixture plan committed as
 * version 1. Idempotent-per-directory only in the sense that a fresh
 * `dataDir` is expected each call — see `e2e/env.ts`'s `E2E_DATA_DIR`.
 */
export function seedFixturePlan(dataDir: string, devUser: string, now = new Date()): SeededFixture {
  const control = openControlDb(dataDir, now);
  try {
    const sub = `dev-bypass:${devUser}`;
    const user = findUserBySub(control, sub) ?? createUser(control, sub, now);

    const userDb = openUserDb(dataDir, user.id, {
      now,
      seedTemplates: [
        {
          name: "Default revision instructions",
          body_md: fs.readFileSync(AI_INSTRUCTIONS_PATH, "utf8"),
          is_default: true,
        },
      ],
    });
    try {
      const source = fs.readFileSync(FIXTURE_PATH, "utf8");
      const parsed = parsePlanDocument(source);
      if (!parsed.ok) {
        throw new Error(`fixture plan failed to parse (${parsed.kind}):\n${parsed.report}`);
      }

      const result = importPlan(userDb, { parsed, now });
      if (!result.ok) {
        throw new Error(`fixture plan failed to import: ${result.message}`);
      }
    } finally {
      userDb.close();
    }

    return { userId: user.id, dataDir };
  } finally {
    control.close();
  }
}

/**
 * A read-only handle on the one seeded user's `gain.db`, for specs that need to assert on
 * what a form action actually wrote rather than only on what the page draws — Task 6's
 * "re-logging cannot create a duplicate `(workout, exercise, set_no, side)`" is a claim
 * about rows, and rendered state cannot make it.
 *
 * `seedFixturePlan` provisions exactly one user per data directory, so the single entry
 * under `users/` is it; the caller does not have to thread `userId` out of global setup.
 * Opened `readonly` deliberately: a test that can write to the app's database can make its
 * own assertions come true. Specs must still scope every query to their own workout —
 * three viewport projects share this one file.
 */
export function openSeededUserDb(dataDir: string): Database.Database {
  const usersDir = path.join(dataDir, "users");
  const [userId] = fs.readdirSync(usersDir);
  if (!userId) throw new Error(`no seeded user under ${usersDir}`);
  return new Database(path.join(usersDir, userId, "gain.db"), { readonly: true });
}
