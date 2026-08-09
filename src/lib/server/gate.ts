/**
 * The routing decisions the auth gate makes, as pure functions (ARCHITECTURE
 * §4). `hooks.server.ts` is the thin wrapper that applies them; the rules
 * themselves are here so they are testable without a SvelteKit request.
 */

/**
 * Paths that must answer without a session: the health endpoint Portainer
 * polls (§3) and the login round trip itself.
 */
export function isPublicPath(pathname: string): boolean {
  return pathname === "/healthz" || pathname === "/login" || pathname.startsWith("/auth/");
}

/**
 * Is this request a browser navigating, as opposed to script fetching?
 *
 * It decides what an expired session looks like. A navigation should land on
 * the login page; a fetch must not, because a 303 turns the follow-up into a
 * GET and the request body is gone. §4 is explicit that a 401 must not cost
 * the client its queued data, and the phase-5 sync queue depends on being able
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
