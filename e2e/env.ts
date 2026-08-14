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
