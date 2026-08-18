/**
 * Shared constants for the e2e harness. `playwright.config.ts` reads these to
 * start the dev server and wait on its URL; `global-setup.ts` reads the same
 * values to seed the data directory that server serves from — one source so
 * the two halves can never drift apart.
 *
 * The data directory is unique per run (a fresh `mkdtemp`), computed once at
 * module load and cached by Node's module resolution — the config file and
 * the global setup script both import this module, so both processes agree
 * on the path without any file-based handshake. A fresh directory per run
 * also means a re-run never collides with a previous run's committed plan
 * version (`confirmImport` refuses a second import at the same version).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const E2E_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gain-e2e-"));

/**
 * How a *spec* asks for that directory. `E2E_DATA_DIR` above is only correct in the
 * Playwright root process: a worker process re-imports this module and would mint a
 * second, empty `mkdtemp` of its own. `globalSetup` publishes the real one through the
 * environment instead, which workers inherit when they are forked. Specs that read the
 * seeded `gain.db` directly (`session-runner-resume.spec.ts`) go through here.
 */
export const E2E_DATA_DIR_VAR = "GAIN_E2E_DATA_DIR";

export function seededDataDir(): string {
  const dir = process.env[E2E_DATA_DIR_VAR];
  if (!dir) {
    throw new Error(
      `${E2E_DATA_DIR_VAR} is not set — global setup publishes it, so this is being read outside a Playwright run`,
    );
  }
  return dir;
}

/** Matches `GAIN_DEV_USER` — the auth bypass (`src/lib/server/config.ts`). */
export const E2E_DEV_USER = "e2e";

/**
 * The three viewport projects that run every non-offline spec (`playwright.config.ts`) —
 * not `phone`/`mobile`, per CLAUDE.md's own naming note. Duplicated here as a plain
 * array rather than read off the config object, which `global-setup.ts` cannot import
 * without a cycle (`playwright.config.ts` itself imports this module).
 */
export const E2E_VIEWPORT_PROJECTS = ["small-android", "iphone", "tablet-portrait"] as const;

/**
 * A dedicated bypass user per viewport project, for any spec asserting on whole-account
 * state (a "what session does Home suggest next" read, not scoped to one `client_id`)
 * rather than its own workout. `E2E_DEV_USER` is shared by every other spec that starts
 * or finishes a workout, so a whole-account spec reading through it would see another
 * spec's workouts land in between (`docs/ROADMAP.md`, "Loose ends") — and reading through
 * one fixed second user still wouldn't be enough, since `fullyParallel: true` runs the
 * *same* spec file concurrently across all three viewport projects, which would then
 * collide with each other on that one shared account. `homeDevUserFor` names one user per
 * project instead, requested per-request via the `x-gain-e2e-user` header
 * (`src/hooks.server.ts`) since `GAIN_DEV_USER` itself is fixed for the whole dev-server
 * process. Any future whole-account-assertion spec should call this with its own project
 * name too, not reuse `home-walkthrough.spec.ts`'s users.
 */
export function homeDevUserFor(projectName: string): string {
  return `e2e-home-${projectName}`;
}

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

/** Off the beaten path, so a developer's own `npm run dev` on 5173 is untouched. */
export const E2E_PORT = 4319;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

/**
 * The offline project's own server: a real `vite build` + `node build`, because
 * `$service-worker`'s `build` manifest is empty under `vite dev` and the precache would
 * be a no-op — no offline test can pass against the dev server. Separate port so it can
 * run alongside the dev server; both `webServer` entries start together and share
 * `E2E_DATA_DIR` (SQLite's WAL mode is what makes two nodejs processes serving the same
 * `gain.db` concurrently safe).
 */
export const E2E_BUILT_PORT = E2E_PORT + 1;
export const E2E_BUILT_BASE_URL = `http://127.0.0.1:${E2E_BUILT_PORT}`;

/** `plan.slug` in `fixtures/plans/home-training-v1.md` — confirmed against the fixture and `tests/server/first-run.test.ts`. */
export const E2E_PLAN_SLUG = "home-training";

/** Session keys exercised by the harness — the fixture's actual keys (`A`–`D`), not the "Session A" prose shorthand. */
export const E2E_SESSION_KEYS = ["A", "D"] as const;
