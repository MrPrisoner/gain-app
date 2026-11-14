/**
 * Request-level authentication (ARCHITECTURE §4): resolve the session cookie,
 * refresh tokens when they are due, re-check the email gate on every refresh,
 * and keep the sliding expiry alive. `hooks.server.ts` calls `checkSession`;
 * the callback route shares the cookie helpers and the 403 wording.
 */

import type { Cookies } from "@sveltejs/kit";
import { decodeJwt } from "jose";
import type { GainConfig, OidcConfig } from "./config";
import type { ControlDb, SessionRow } from "./control-db";
import {
  deleteSession,
  extendSession,
  findUserBySub,
  createUser,
  getSession,
  setSessionAdmin,
  storeRefreshedTokens,
} from "./control-db";
import { getControlDb, getJwksFor, getOidcEndpoints, getUserDbFor } from "./app-state";
import {
  OidcError,
  claimsAnswerEmail,
  extractDisplayName,
  extractEmailAnswer,
  fetchUserinfoEmail,
  isEmailAllowed,
  refreshTokens,
  verifyIdToken,
  type EmailAnswer,
  type FetchImpl,
  type JwksResolver,
  type OidcEndpoints,
  type TokenResponse,
} from "./oidc";
import { SESSION_COOKIE, signSessionId, verifySessionCookie } from "./session-cookie";

/** Refresh a token this long before it actually expires. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * The I/O `checkSession` needs. Defaults come from the process-wide singletons;
 * tests pass their own so the whole flow — refresh, ID-token verification, the
 * email re-check — runs against real signed JWTs and no live IdP.
 */
export type AuthDeps = {
  control: ControlDb;
  getEndpoints: () => Promise<OidcEndpoints>;
  /** ID-token verification key. Defaults to the cached JWKS for the issuer. */
  getKey: (endpoints: OidcEndpoints) => Promise<JwksResolver> | JwksResolver;
  fetchImpl: FetchImpl;
};

function defaultDeps(): AuthDeps {
  return {
    control: getControlDb(),
    getEndpoints: getOidcEndpoints,
    getKey: (endpoints) => getJwksFor(endpoints.jwks_uri),
    fetchImpl: fetch,
  };
}

/**
 * The 403's wording. It names the address the IdP supplied, because "which account did
 * I sign in with?" is the first thing a refused user needs to know — a second Google
 * account in the same browser is the likeliest cause. An address that arrived unverified
 * gets its own wording: telling that user "not on the list" would send the operator to
 * the list when the fix is the IdP's `email_verified` claim. `gate.ts` escapes it.
 */
export function forbiddenMessage(answer: EmailAnswer): string {
  const { email, unverified } = answer;
  if (email === null && unverified !== null) {
    return (
      `You are signed in as ${unverified}, but your identity provider did not mark that ` +
      "address as verified, and this GAIN instance only lets in verified addresses. Ask " +
      "the person who runs it to check that the provider sends email_verified."
    );
  }
  if (email === null) {
    return (
      "You are signed in, but your identity provider did not supply a verified email " +
      "address, which this GAIN instance needs to decide whether to let you in. Ask the " +
      "person who runs it to check the provider's email scope."
    );
  }
  return (
    `You are signed in as ${email}, but that address is not on this GAIN instance's list ` +
    "of allowed users. If you meant to use a different account, sign out of it and sign in " +
    "again; otherwise ask the person who runs GAIN to add you."
  );
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

export function setSessionCookie(cookies: Cookies, config: GainConfig, sessionId: string): void {
  cookies.set(SESSION_COOKIE, signSessionId(config.sessionSecret, sessionId), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    // Secure in production behind TLS; the dev server is plain http (§4).
    secure: config.isProduction,
    maxAge: Math.floor(config.sessionIdleMs / 1000),
  });
}

export function clearSessionCookie(cookies: Cookies): void {
  cookies.delete(SESSION_COOKIE, { path: "/" });
}

// ---------------------------------------------------------------------------
// Session resolution
// ---------------------------------------------------------------------------

export type SessionCheck =
  | {
      status: "ok";
      userId: string;
      /** Set when the sliding expiry was extended. */ setCookie: string | null;
      /** For the greeting and the bootstrap prompt — display only, see `displayNameFromIdToken`. */
      displayName: string | null;
      /** Operator, as of the last email evaluation. See `refreshIfDue`. */
      isAdmin: boolean;
    }
  | { status: "anonymous" }
  | { status: "forbidden"; message: string };

/**
 * A friendly name for display, read from the session's stored ID token —
 * never re-verified here, since it was already verified when written (at
 * login or the last refresh) and this is not an authorization decision.
 * Tolerant of a missing or malformed token: both just mean no greeting.
 */
function displayNameFromIdToken(idToken: string | null): string | null {
  if (!idToken) return null;
  try {
    return extractDisplayName(decodeJwt(idToken));
  } catch {
    return null;
  }
}

/**
 * Resolve the session for this request. Anonymous when there is no valid
 * session (→ login redirect); forbidden when a token refresh revealed the
 * address is no longer allowed (→ clean 403, §4).
 */
export async function checkSession(
  cookies: Cookies,
  config: GainConfig,
  oidc: OidcConfig,
  now: Date,
  deps: AuthDeps = defaultDeps(),
): Promise<SessionCheck> {
  const control = deps.control;
  const cookieValue = cookies.get(SESSION_COOKIE);
  const sessionId = cookieValue ? verifySessionCookie(config.sessionSecret, cookieValue) : null;
  const session = sessionId ? getSession(control, sessionId, now) : undefined;
  if (!session) return { status: "anonymous" };

  const refresh = await refreshIfDue(session, oidc, config.adminEmails, now, deps);
  if (refresh.outcome === "failed") return { status: "anonymous" };
  if (refresh.outcome === "forbidden") {
    return { status: "forbidden", message: forbiddenMessage(refresh.answer) };
  }

  // Sliding expiry: extend once less than half the idle window remains, so a
  // steady user never rewrites the row on every request.
  let setCookie: string | null = null;
  const remainingMs = Date.parse(session.expires_at) - now.getTime();
  if (remainingMs < config.sessionIdleMs / 2) {
    extendSession(control, session.id, now, config.sessionIdleMs);
    setCookie = session.id;
  }

  return {
    status: "ok",
    userId: session.user_id,
    setCookie,
    displayName: displayNameFromIdToken(session.id_token),
    isAdmin: refresh.isAdmin,
  };
}

type RefreshOutcome =
  | { outcome: "ok"; isAdmin: boolean }
  | { outcome: "failed" }
  | { outcome: "forbidden"; answer: EmailAnswer };

/**
 * The email gate is re-checked on every token refresh, not just first login
 * (§4). A refresh that fails logs the user out; a refresh that shows the
 * address is no longer allowed ends in a 403. The allowlist itself is
 * configuration, so removing someone takes effect at their next refresh after
 * the restart that applies it.
 *
 * The third case is the one worth being careful about: GAIN asked and got no
 * usable answer. An IdP that omits `id_token` from a refresh response (the
 * spec allows it) combined with a userinfo endpoint that blips would otherwise
 * read exactly like "no verified address", and evict a legitimate user
 * mid-session. An unevaluable gate keeps the session and is re-checked on the
 * next refresh; only a definite answer revokes.
 */
async function refreshIfDue(
  session: SessionRow,
  oidc: OidcConfig,
  adminEmails: ReadonlySet<string> | null,
  now: Date,
  deps: AuthDeps,
): Promise<RefreshOutcome> {
  const control = deps.control;
  // Every path that does not re-read the email reports the stored flag unchanged.
  const stored = { outcome: "ok", isAdmin: session.is_admin === 1 } as const;
  const accessExpiry = session.access_expires_at ? Date.parse(session.access_expires_at) : null;
  if (accessExpiry === null || now.getTime() < accessExpiry - REFRESH_MARGIN_MS) return stored;
  if (!session.refresh_token) {
    // Nothing to refresh with; the gate was checked at login. Let the session
    // run down its sliding window.
    return stored;
  }

  let endpoints: OidcEndpoints;
  try {
    endpoints = await deps.getEndpoints();
  } catch {
    // The IdP is unreachable. That is an outage, not a revocation — the
    // session stays valid and the refresh is retried on the next request.
    return stored;
  }

  let tokens: TokenResponse;
  try {
    tokens = await refreshTokens(
      endpoints,
      {
        clientId: oidc.clientId,
        clientSecret: oidc.clientSecret,
        refreshToken: session.refresh_token,
      },
      deps.fetchImpl,
    );
  } catch (err) {
    // Same distinction as the gate itself: a token endpoint that could not be
    // reached says nothing about this user, but one that answered "no" has
    // revoked the grant and the session goes with it.
    if (err instanceof OidcError && err.cause_ === "token_unreachable") return stored;
    deleteSession(control, session.id);
    return { outcome: "failed" };
  }

  const answer = await resolveEmail(tokens, endpoints, oidc, now, deps);
  if (answer !== null && !isEmailAllowed(answer.email, oidc.allowedEmails)) {
    deleteSession(control, session.id);
    return { outcome: "forbidden", answer };
  }

  // Admin-ness is re-derived from the same answer that just re-checked the access
  // gate. `answer === null` means GAIN could not establish the address at all, and the
  // same rule applies as to the gate itself: an unevaluable check is not a failed
  // check, so the flag is left exactly as it was.
  let isAdmin = session.is_admin === 1;
  if (answer !== null) {
    const nowAdmin = adminEmails !== null && isEmailAllowed(answer.email, adminEmails);
    if (nowAdmin !== isAdmin) {
      setSessionAdmin(control, session.id, nowAdmin);
      isAdmin = nowAdmin;
    }
  }

  storeRefreshedTokens(control, session.id, {
    access_token: tokens.access_token,
    access_expires_at:
      tokens.expires_in != null
        ? new Date(now.getTime() + tokens.expires_in * 1000).toISOString()
        : null,
    refresh_token: tokens.refresh_token ?? session.refresh_token,
    id_token: tokens.id_token ?? session.id_token,
  });
  return { outcome: "ok", isAdmin };
}

/**
 * The verified address as of this refresh: the `email` claim of a freshly
 * verified ID token, else the userinfo endpoint, else `null` for "could not tell".
 *
 * An ID token that verifies and carries `email` or `email_verified` is
 * authoritative even when the address is unverified — that is the IdP saying
 * "no verified address". `null` is reserved for the cases where no source
 * answered: no ID token in the refresh response and no reachable userinfo
 * endpoint.
 */
async function resolveEmail(
  tokens: TokenResponse,
  endpoints: OidcEndpoints,
  oidc: OidcConfig,
  now: Date,
  deps: AuthDeps,
): Promise<EmailAnswer | null> {
  if (tokens.id_token) {
    try {
      const claims = await verifyIdToken(tokens.id_token, {
        issuer: endpoints.issuer,
        clientId: oidc.clientId,
        key: await deps.getKey(endpoints),
        now,
      });
      // A verified token with no email claims at all is not an answer: the
      // provider simply does not put them in the ID token. Fall through to userinfo.
      if (claimsAnswerEmail(claims)) return extractEmailAnswer(claims);
    } catch {
      // Fall through — an unverifiable refresh token response is not evidence
      // of lost membership.
    }
  }

  if (endpoints.userinfo_endpoint) {
    return fetchUserinfoEmail(endpoints.userinfo_endpoint, tokens.access_token, deps.fetchImpl);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dev bypass
// ---------------------------------------------------------------------------

/**
 * The bypass user is provisioned exactly like a real first login — control
 * row, `gain.db`, directories, seeded template — just keyed on a synthetic
 * sub. Dev only; `loadConfig` refuses it in production.
 */
export function ensureBypassUser(devUser: string, now: Date): string {
  const control = getControlDb();
  const sub = `dev-bypass:${devUser}`;
  let user = findUserBySub(control, sub);
  if (!user) {
    user = createUser(control, sub, now);
  }
  getUserDbFor(user.id);
  return user.id;
}
