/**
 * The routing decisions the auth gate makes, as pure functions (ARCHITECTURE
 * §4). `hooks.server.ts` is the thin wrapper that applies them; the rules
 * themselves are here so they are testable without a SvelteKit request.
 */

/**
 * Paths that must answer without a session: the health endpoint Portainer
 * polls (§3), the login round trip itself, and the offline fallback page
 * (phase 6, design spec §7) — the service worker's `install` step precaches
 * it with `cache.addAll`, which fails the *entire* precache (app shell
 * included) on any single non-OK response, and that install runs on every
 * page load, including `/login` before a session exists. `/offline` names
 * no user and carries no data, so there is nothing an anonymous request to
 * it could leak.
 */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/healthz" ||
    pathname === "/login" ||
    pathname === "/offline" ||
    pathname.startsWith("/auth/")
  );
}

/**
 * Is this request a browser navigating, as opposed to script fetching?
 *
 * It decides what an expired session looks like. A navigation should land on
 * the login page; a fetch must not, because a 303 turns the follow-up into a
 * GET and the request body is gone. §4 is explicit that a 401 must not cost
 * the client its queued data, and the phase-6 sync queue depends on being able
 * to tell "you are logged out" from "here is a login page".
 *
 * `Sec-Fetch-Mode` is authoritative where it exists (every browser GAIN
 * targets); the Accept fallback covers curl and older clients.
 */
export function isNavigationRequest(request: {
  method: string;
  headers: { get(name: string): string | null };
}): boolean {
  const mode = request.headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";

  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  return (request.headers.get("accept") ?? "").includes("text/html");
}

/**
 * Where to send the user back to after login.
 *
 * Only a same-origin absolute path is ever echoed back. A value starting `//`
 * or `/\` is a protocol-relative URL that browsers resolve to another host, so
 * the login round trip would become an open redirect for anyone who can hand
 * the user a link.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

/** The login URL for an anonymous request, carrying where it was headed. */
export function loginUrlFor(pathname: string, search = ""): string {
  const target = safeReturnTo(`${pathname}${search}`);
  if (target === "/") return "/login";
  return `/login?return_to=${encodeURIComponent(target)}`;
}

/**
 * The gate's own refusal, as a response rather than a thrown `error()`.
 *
 * Throwing is what a route does; `handle` cannot. SvelteKit catches an `HttpError` out of
 * `handle` and builds the response itself through `handle_fatal_error`, which never
 * passes back through the hook's own `withSecurityHeaders` — so every response an
 * unauthenticated caller could see shipped with no CSP, no `x-frame-options` and no
 * `nosniff`, while every response an authenticated one saw had all four (ARCHITECTURE
 * §3). Returning the response instead puts the refusals back on the same path as
 * everything else.
 *
 * The two shapes match what SvelteKit was negotiating anyway: JSON for a fetch, which is
 * all `$lib/sync/client.svelte.ts` ever reads, and a page for a navigation. The page is
 * deliberately unstyled — `FALLBACK_CSP` is `default-src 'none'`, so an inline `<style>`
 * would be blocked by the very header this exists to carry.
 */
export function refusal(status: number, message: string, isNavigation: boolean): Response {
  if (!isNavigation) {
    return new Response(JSON.stringify({ message }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<title>${status}</title></head><body><h1>${status}</h1>` +
      `<p>${escapeHtml(message)}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/**
 * The login redirect, for the same reason `refusal` exists — a thrown `redirect()` skips
 * the header wrapper too. 303 rather than 302 so the method is reset to GET, and a body
 * would be ignored, so there is nothing here to escape.
 */
export function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

/**
 * The 403's message is `checkSession`'s, and that one names the required group — which
 * comes from `OIDC_REQUIRED_GROUP`, i.e. from configuration rather than from this
 * codebase. Interpolating it into markup unescaped is how a refusal page becomes an
 * injection point.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
