// e2e/security-headers.spec.ts
/**
 * The security headers (ARCHITECTURE §3), asserted where they can actually be observed:
 * on a real response, and against a real browser that would refuse to run the app if the
 * policy were wrong.
 *
 * Runs against the dev server like every other viewport project, and the dev server's CSP
 * is a deliberate *superset* of the shipped one — SvelteKit adds `'unsafe-inline'` to
 * `style-src` in dev for HMR. So the assertions here name the directives that are
 * identical in both, never the whole header. The shipped policy itself was verified by
 * hand against a real `node build`, because the only browser
 * project that runs against that server is `offline`, and a header assertion has no
 * business being named as an offline spec.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import { dismissPreSessionPrompt } from "./helpers";

test("every app response carries the security headers", async ({ page }) => {
  const response = await page.goto("/");
  expect(response).not.toBeNull();
  const headers = response!.headers();

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("same-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");

  const csp = headers["content-security-policy"];
  expect(csp, "SvelteKit renders the page's CSP, nonce and all").toBeTruthy();
  // The nonce is what makes `script-src 'self'` survivable without `'unsafe-inline'`;
  // if it stopped being emitted the app would still load, from cache, until it didn't.
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("form-action 'self'");
  // `style:` directives compile to inline style attributes, so this one allowance has to
  // be there — and it has to be the attribute directive, not `style-src` at large.
  expect(csp).toContain("style-src-attr 'unsafe-inline'");
});

test("/healthz answers with the deny-everything fallback policy", async ({ request }) => {
  // Nothing SvelteKit renders a page for gets the nonce'd policy; the JSON endpoints and
  // bodiless errors get one that permits nothing, from `hooks.server.ts`.
  const response = await request.get("/healthz");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-security-policy"]).toBe(
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});

test("the session runner loads with no policy violation", async ({ page }) => {
  // The runner is the screen with the most inline-style surface in the app — the rest
  // timer, the confetti overlay, every `style:` directive — so it is the one that would
  // break first if `style-src-attr` were dropped. A violation surfaces as a console
  // error, not as a failed request, which is why the assertion is on the console.
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });

  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  expect(violations, violations.join("\n")).toEqual([]);
});
