/**
 * Shared e2e helpers, small enough not to warrant their own file per spec.
 *
 * Task 9 (docs/superpowers/plans/2026-08-10-phase-4-remediation.md, ARCHITECTURE §9): a
 * genuinely fresh workout now opens on the pre-session metrics prompt before the runner
 * itself (`.log-strip`, `.exercise-head`, …) becomes visible at all — a *resumed* workout
 * (`page.reload()` within a test, which lands back on the same `client_id`) skips this
 * gate, since the `?/start` response carries `hydration` in that case and the runner
 * shows straight away. Every spec that navigates fresh to a session must dismiss this
 * gate before asserting on anything inside the runner.
 */

import type { Page } from "@playwright/test";

export async function dismissPreSessionPrompt(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Continue to session" }).click();
}
