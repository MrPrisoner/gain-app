/**
 * Runs once before any spec, in the Playwright root process — not inside the
 * dev server child process `webServer.command` spawns. Seeds `E2E_DATA_DIR`
 * with the bypass user and the fixture plan (`e2e/seed.ts`) so that by the
 * time `webServer` finishes booting against the same directory, the plan
 * already exists on disk for the browser to open.
 */

import { E2E_DATA_DIR, E2E_DATA_DIR_VAR, E2E_DEV_USER } from "./env";
import { seedFixturePlan } from "./seed";

export default function globalSetup(): void {
  seedFixturePlan(E2E_DATA_DIR, E2E_DEV_USER);
  // Published for the worker processes, which are forked after this runs and would
  // otherwise re-import `env.ts` and mint an empty temp directory of their own.
  process.env[E2E_DATA_DIR_VAR] = E2E_DATA_DIR;
}
