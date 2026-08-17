/**
 * Runs once before any spec, in the Playwright root process — not inside the
 * dev server child process `webServer.command` spawns. Seeds `E2E_DATA_DIR`
 * with the bypass user and the fixture plan (`e2e/seed.ts`) so that by the
 * time `webServer` finishes booting against the same directory, the plan
 * already exists on disk for the browser to open.
 */

import {
  E2E_DATA_DIR,
  E2E_DATA_DIR_VAR,
  E2E_DEV_USER,
  E2E_VIEWPORT_PROJECTS,
  homeDevUserFor,
} from "./env";
import { seedFixturePlan } from "./seed";

export default function globalSetup(): void {
  seedFixturePlan(E2E_DATA_DIR, E2E_DEV_USER);
  // `home-walkthrough.spec.ts` gets its own isolated account per viewport project (see
  // `homeDevUserFor`'s doc comment) so its whole-account assertions cannot see another
  // spec's workouts, or another project's concurrent run of this same spec.
  for (const project of E2E_VIEWPORT_PROJECTS) {
    seedFixturePlan(E2E_DATA_DIR, homeDevUserFor(project));
  }
  // Published for the worker processes, which are forked after this runs and would
  // otherwise re-import `env.ts` and mint an empty temp directory of their own.
  process.env[E2E_DATA_DIR_VAR] = E2E_DATA_DIR;
}
