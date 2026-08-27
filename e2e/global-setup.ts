/**
 * Runs once before any spec, in the Playwright root process — not inside the
 * dev server child process `webServer.command` spawns. Seeds `E2E_DATA_DIR`
 * with the bypass user and the fixture plan (`e2e/seed.ts`) so that by the
 * time `webServer` finishes booting against the same directory, the plan
 * already exists on disk for the browser to open.
 */

import {
  E2E_ADMIN_USER,
  E2E_DATA_DIR,
  E2E_DATA_DIR_VAR,
  E2E_DEV_USER,
  E2E_VIEWPORT_PROJECTS,
  accountResetDevUserFor,
  adminSubjectFor,
  homeDevUserFor,
} from "./env";
import { seedFixturePlan } from "./seed";
import { openControlDb, setDisplayLabel } from "../src/lib/server/control-db";

export default function globalSetup(): void {
  seedFixturePlan(E2E_DATA_DIR, E2E_DEV_USER);
  // `home-walkthrough.spec.ts` gets its own isolated account per viewport project (see
  // `homeDevUserFor`'s doc comment) so its whole-account assertions cannot see another
  // spec's workouts, or another project's concurrent run of this same spec.
  for (const project of E2E_VIEWPORT_PROJECTS) {
    seedFixturePlan(E2E_DATA_DIR, homeDevUserFor(project));
  }
  // The operator, and one disposable account per project for it to reset.
  seedFixturePlan(E2E_DATA_DIR, E2E_ADMIN_USER);
  for (const project of E2E_VIEWPORT_PROJECTS) {
    const subject = adminSubjectFor(project);
    const seeded = seedFixturePlan(E2E_DATA_DIR, subject);
    // A real login sets `display_label` from the IdP's claims
    // (`src/routes/auth/callback/+server.ts`); the dev-bypass path never does, so a
    // bypass-seeded user's confirmation string (`confirmationFor`) would otherwise fall
    // back to the ULID tail rather than the readable name the admin spec asserts on.
    // Setting it here mirrors what a real operator would see for an account that has
    // actually logged in.
    const control = openControlDb(E2E_DATA_DIR, new Date());
    try {
      setDisplayLabel(control, seeded.userId, subject);
    } finally {
      control.close();
    }
  }
  // One disposable account per project for the self-service reset walkthrough — same
  // reasoning as the admin subjects above, since this reset is just as destructive.
  for (const project of E2E_VIEWPORT_PROJECTS) {
    seedFixturePlan(E2E_DATA_DIR, accountResetDevUserFor(project));
  }
  // Published for the worker processes, which are forked after this runs and would
  // otherwise re-import `env.ts` and mint an empty temp directory of their own.
  process.env[E2E_DATA_DIR_VAR] = E2E_DATA_DIR;
}
