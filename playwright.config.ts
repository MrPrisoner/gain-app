/**
 * Task 0 (docs/superpowers/plans/2026-08-10-phase-4-remediation.md): the
 * browser harness every later phase-4 UI task is verified against. Kept
 * entirely out of `npm run verify` — see the `test:e2e` script in
 * `package.json` — so CI's few-seconds check never needs a browser download.
 *
 * `webServer` boots the real Vite dev server (not `vite preview`: the
 * adapter-node production build isn't preview-servable, and dev mode starts
 * in about a second against nothing but `DATA_DIR` + `GAIN_DEV_USER`, no
 * `ORIGIN` needed — see `src/lib/server/config.ts`). `globalSetup` seeds that
 * same `DATA_DIR` (`e2e/env.ts`, `e2e/global-setup.ts`) before the server is
 * asked to serve it.
 */

import { defineConfig } from "@playwright/test";
import { E2E_BASE_URL, E2E_DATA_DIR, E2E_DEV_USER, E2E_PORT } from "./e2e/env";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Six headless Chromium instances launched at once is enough to trip an
  // occasional "Unable to capture screenshot" CDP protocol error that has
  // nothing to do with the app; three at a time (one per viewport project)
  // hasn't reproduced it across repeated local runs.
  workers: 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",

  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    // `chromium` ships a "fallback build" on this OS (Playwright doesn't
    // officially package for it) — `--disable-gpu` heads off an occasional
    // "Unable to capture screenshot" CDP error from that build's compositor.
    launchOptions: { args: ["--disable-gpu"] },
  },

  webServer: {
    command: `npm run dev -- --port ${E2E_PORT} --strictPort`,
    url: E2E_BASE_URL,
    // A fresh, unique DATA_DIR per run (e2e/env.ts) means an already-running
    // server on this port is never bound to the directory `globalSetup` just
    // seeded — always start a new one rather than risk reusing a stale one.
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      DATA_DIR: E2E_DATA_DIR,
      GAIN_DEV_USER: E2E_DEV_USER,
    },
  },

  projects: [
    {
      name: "small-android",
      use: { browserName: "chromium", viewport: { width: 360, height: 800 } },
    },
    {
      name: "iphone",
      use: { browserName: "chromium", viewport: { width: 390, height: 844 } },
    },
    {
      name: "tablet-portrait",
      use: { browserName: "chromium", viewport: { width: 768, height: 1024 } },
    },
  ],
});
