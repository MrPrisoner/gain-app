/**
 * Request-level authentication (ARCHITECTURE §4): resolve the session cookie,
 * refresh tokens when they are due, re-check the group gate on every refresh,
 * and keep the sliding expiry alive. `hooks.server.ts` calls `checkSession`;
 * the callback route shares the cookie helpers and the 403 wording.
 */

import type { Cookies } from "@sveltejs/kit";
import type { GainConfig, OidcConfig } from "./config";
import type { ControlDb, SessionRow } from "./control-db";
import {
  deleteSession,
  extendSession,
  findUserBySub,
  createUser,
  getSession,
  storeRefreshedTokens,
} from "./control-db";
import { getControlDb, getOidcEndpoints, getUserDbFor } from "./app-state";
import {
  extractGroups,
  fetchUserinfoGroups,
  hasRequiredGroup,
  refreshTokens,
  verifyIdToken,
  type OidcEndpoints,
  type TokenResponse,
} from "./oidc";
import { SESSION_COOKIE, signSessionId, verifySessionCookie } from "./session-cookie";

/** Refresh a token this long before it actually expires. */
const REFRESH_MARGIN_MS = 60_000;

export function forbiddenMessage(requiredGroup: string): string {
  return (
    `You are signed in, but your account is not a member of the '${requiredGroup}' group, ` +
    `which this GAIN instance requires. Access to GAIN is managed entirely in Authentik — ` +
    `ask the person who runs it to add you to the group, then sign in again.`
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
    }
  | { status: "anonymous" }
  | { status: "forbidden"; message: string };

/**
 * Resolve the session for this request. Anonymous when there is no valid
 * session (→ login redirect); forbidden when a token refresh revealed the
 * required group is gone (→ clean 403, §4).
 */
export async function checkSession(
  cookies: Cookies,
  config: GainConfig,
  oidc: OidcConfig,
  now: Date,
): Promise<SessionCheck> {
  const control = getControlDb();
  const cookieValue = cookies.get(SESSION_COOKIE);
  const sessionId = cookieValue ? verifySessionCookie(config.sessionSecret, cookieValue) : null;
  const session = sessionId ? getSession(control, sessionId, now) : undefined;
  if (!session) return { status: "anonymous" };

  const refresh = await refreshIfDue(control, session, oidc, now);
  if (refresh === "failed") return { status: "anonymous" };
  if (refresh === "forbidden") {
    return { status: "forbidden", message: forbiddenMessage(oidc.requiredGroup) };
  }

  // Sliding expiry: extend once less than half the idle window remains, so a
  // steady user never rewrites the row on every request.
  let setCookie: string | null = null;
  const remainingMs = Date.parse(session.expires_at) - now.getTime();
  if (remainingMs < config.sessionIdleMs / 2) {
    extendSession(control, session.id, now, config.sessionIdleMs);
    setCookie = session.id;
  }

  return { status: "ok", userId: session.user_id, setCookie };
}

type RefreshOutcome = "ok" | "failed" | "forbidden";

/**
 * The group gate is re-checked on every token refresh, not just first login
 * (§4). A refresh that fails logs the user out; a refresh that shows the
 * required group is gone ends in a 403.
 */
async function refreshIfDue(
  control: ControlDb,
  session: SessionRow,
  oidc: OidcConfig,
  now: Date,
): Promise<RefreshOutcome> {
  const accessExpiry = session.access_expires_at ? Date.parse(session.access_expires_at) : null;
  if (accessExpiry === null || now.getTime() < accessExpiry - REFRESH_MARGIN_MS) return "ok";
  if (!session.refresh_token) {
    // Nothing to refresh with; the gate was checked at login. Let the session
    // run down its sliding window.
    return "ok";
  }

  let endpoints: OidcEndpoints;
  try {
    endpoints = await getOidcEndpoints();
  } catch {
    return "failed";
  }

  let tokens: TokenResponse;
  try {
    tokens = await refreshTokens(endpoints, {
      clientId: oidc.clientId,
      clientSecret: oidc.clientSecret,
      refreshToken: session.refresh_token,
    });
  } catch {
    deleteSession(control, session.id);
    return "failed";
  }

  let groups: string[] = [];
  if (tokens.id_token) {
    try {
      const claims = await verifyIdToken(tokens.id_token, {
        issuer: endpoints.issuer,
        clientId: oidc.clientId,
        jwksUri: endpoints.jwks_uri,
        now,
      });
      groups = extractGroups(claims);
    } catch {
      groups = [];
    }
  }
  if (groups.length === 0 && endpoints.userinfo_endpoint) {
    groups = await fetchUserinfoGroups(endpoints.userinfo_endpoint, tokens.access_token);
  }

  if (!hasRequiredGroup(groups, oidc.requiredGroup)) {
    deleteSession(control, session.id);
    return "forbidden";
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
  return "ok";
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
