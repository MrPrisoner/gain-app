/**
 * The OIDC callback (ARCHITECTURE §4): exchange the code with the PKCE
 * verifier, verify the ID token, apply the group gate, provision the user on
 * first successful login, and start the server-side session.
 *
 * A failed gate is a clean 403 with a human explanation — no user row, no
 * session, nothing written.
 */

import { error, redirect, type RequestHandler } from "@sveltejs/kit";
import { forbiddenMessage, setSessionCookie } from "$lib/server/auth";
import { getControlDb, getJwksFor, getOidcEndpoints, getUserDbFor } from "$lib/server/app-state";
import { getConfig } from "$lib/server/config";
import {
  createSession,
  createUser,
  findUserBySub,
  takeOidcState,
  touchUserLogin,
} from "$lib/server/control-db";
import { safeReturnTo } from "$lib/server/gate";
import {
  exchangeCode,
  extractGroups,
  fetchUserinfoGroups,
  hasRequiredGroup,
  verifyIdToken,
} from "$lib/server/oidc";

export const GET: RequestHandler = async ({ url, cookies }) => {
  const config = getConfig();
  if (config.auth.mode === "bypass") throw redirect(303, "/");
  const oidc = config.auth.oidc;

  const providerError = url.searchParams.get("error");
  if (providerError) {
    throw redirect(303, `/login?error=${encodeURIComponent(providerError)}`);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) throw redirect(303, "/login?error=missing_params");

  const control = getControlDb();
  const stored = takeOidcState(control, state);
  if (!stored) throw redirect(303, "/login?error=stale_state");

  let endpoints;
  try {
    endpoints = await getOidcEndpoints();
  } catch {
    throw redirect(303, "/login?error=idp_unreachable");
  }

  let tokens;
  try {
    tokens = await exchangeCode(endpoints, {
      clientId: oidc.clientId,
      clientSecret: oidc.clientSecret,
      code,
      redirectUri: config.redirectUri,
      codeVerifier: stored.code_verifier,
    });
  } catch {
    throw redirect(303, "/login?error=token_exchange");
  }

  if (!tokens.id_token) throw redirect(303, "/login?error=no_id_token");

  let claims;
  try {
    claims = await verifyIdToken(tokens.id_token, {
      issuer: endpoints.issuer,
      clientId: oidc.clientId,
      expectedNonce: stored.nonce,
      key: getJwksFor(endpoints.jwks_uri),
    });
  } catch {
    throw redirect(303, "/login?error=bad_id_token");
  }

  // The group gate (§4). The ID token carries `groups` when the Authentik
  // provider maps the scope; userinfo is the fallback when it does not.
  //
  // Unlike the mid-session re-check, a login denies when membership cannot be
  // established at all: there is no established session to protect here, and
  // admitting an unverified user is the wrong direction to fail in.
  let groups = extractGroups(claims);
  if (groups.length === 0 && endpoints.userinfo_endpoint) {
    groups = (await fetchUserinfoGroups(endpoints.userinfo_endpoint, tokens.access_token)) ?? [];
  }
  if (!hasRequiredGroup(groups, oidc.requiredGroup)) {
    throw error(403, forbiddenMessage(oidc.requiredGroup));
  }

  const now = new Date();
  let user = findUserBySub(control, claims.sub);
  if (!user) {
    // First successful login: control row, then the per-user gain.db,
    // directories and the seeded AI-instruction template (§4).
    user = createUser(control, claims.sub, now);
  }
  touchUserLogin(control, user.id, now);
  getUserDbFor(user.id);

  const session = createSession(control, {
    userId: user.id,
    now,
    idleMs: config.sessionIdleMs,
    tokens: {
      access_token: tokens.access_token,
      access_expires_at:
        tokens.expires_in != null
          ? new Date(now.getTime() + tokens.expires_in * 1000).toISOString()
          : null,
      refresh_token: tokens.refresh_token ?? null,
      id_token: tokens.id_token ?? null,
    },
    // Task 3 replaces this with the real group check; nothing reads the flag yet.
    isAdmin: false,
  });

  setSessionCookie(cookies, config, session.id);
  // Re-validated on the way out as well as on the way in: the redirect target
  // is the one value here that came from a URL the user was handed.
  throw redirect(303, safeReturnTo(stored.return_to));
};
