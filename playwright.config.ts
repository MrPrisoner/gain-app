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
 *
 * A second `webServer` entry (phase 6) runs a real production build instead
 * of the dev server, for the `offline` project alone: `$service-worker`'s
 * `build` manifest is empty under `vite dev`, so no offline test can pass
 * against it. Playwright starts every `webServer` entry before any project's
 * tests run, so both servers are up for the whole suite regardless of which
 * project ends up using which.
 */

import { defineConfig } from "@playwright/test";
import {
  E2E_BASE_URL,
  E2E_BUILT_BASE_URL,
  E2E_BUILT_PORT,
  E2E_DATA_DIR,
  E2E_DEV_USER,
  E2E_PORT,
} from "./e2e/env";

const OFFLINE_SPEC = /offline-.*\.spec\.ts/;

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

  webServer: [
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${E2E_PORT} --strictPort`,
      url: E2E_BASE_URL,
      // A fresh, unique DATA_DIR per run (e2e/env.ts) means an already-running
      // server on this port is never bound to the directory `globalSetup` just
      // seeded — always start a new one rather than risk reusing a stale one.
      //
      // `--host` is explicit rather than left to resolve `localhost` itself: Vite's dev
      // server binds to a single address from a plain `net.Server.listen(port, host)`,
      // not dual-stack, so it takes whichever of ::1/127.0.0.1 the machine's resolver
      // returns first for "localhost". `E2E_BASE_URL` below is hardcoded to 127.0.0.1,
      // so a resolver that prefers IPv6 (Node's dns.lookup default order varies by
      // machine) leaves the server listening on ::1 while Playwright polls 127.0.0.1
      // and every webServer readiness check times out. Binding explicitly removes the
      // dependency on resolver order entirely.
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        DATA_DIR: E2E_DATA_DIR,
        GAIN_DEV_USER: E2E_DEV_USER,
      },
    },
    {
      command: `npm run build && node build`,
      url: E2E_BUILT_BASE_URL,
      reuseExistingServer: false,
      // `npm run build` is a plain `vite build` (no typecheck/lint/test — those are
      // `verify`'s job), but a real build plus the node process starting up is still
      // slower to come up than the dev server's ~1s, so this gets a longer timeout.
      timeout: 120_000,
      env: {
        DATA_DIR: E2E_DATA_DIR,
        GAIN_DEV_USER: E2E_DEV_USER,
        PORT: String(E2E_BUILT_PORT),
        // adapter-node requires ORIGIN outside dev, and a wrong one is the #1 cause of
        // login loops behind a proxy (svelte.config.js).
        ORIGIN: E2E_BUILT_BASE_URL,
        // NODE_ENV is deliberately NOT set to production. `src/lib/server/config.ts`
        // refuses GAIN_DEV_USER when NODE_ENV=production, and these specs need both the
        // dev-user bypass and a real build. The refusal keys on NODE_ENV rather than on
        // being a built bundle, so leaving it unset satisfies both — do not "fix" this by
        // weakening the refusal, which exists so a production deploy cannot ship an auth
        // bypass.
      },
    },
  ],

  projects: [
    {
      name: "small-android",
      testIgnore: OFFLINE_SPEC,
      use: { browserName: "chromium", viewport: { width: 360, height: 800 } },
    },
    {
      name: "iphone",
      testIgnore: OFFLINE_SPEC,
      use: { browserName: "chromium", viewport: { width: 390, height: 844 } },
    },
    {
      name: "tablet-portrait",
      testIgnore: OFFLINE_SPEC,
      use: { browserName: "chromium", viewport: { width: 768, height: 1024 } },
    },
    {
      name: "offline",
      testMatch: OFFLINE_SPEC,
      use: {
        browserName: "chromium",
        baseURL: E2E_BUILT_BASE_URL,
        viewport: { width: 360, height: 800 },
      },
    },
  ],
});
