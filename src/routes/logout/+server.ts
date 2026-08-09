/**
 * Real logout (ARCHITECTURE §4): delete the server-side session, clear the
 * cookie, then hand the user to Authentik's end-session endpoint with the
 * id_token_hint — otherwise the IdP session survives and "login" is a
 * one-click re-authentication, not a login.
 *
 * POST-only: SvelteKit's CSRF check validates the Origin header on POSTs.
 */

import { redirect, type RequestHandler } from "@sveltejs/kit";
import { clearSessionCookie } from "$lib/server/auth";
import { getControlDb, getOidcEndpoints } from "$lib/server/app-state";
import { getConfig } from "$lib/server/config";
import { deleteSession, getSession } from "$lib/server/control-db";
import { buildEndSessionUrl } from "$lib/server/oidc";
import { SESSION_COOKIE, verifySessionCookie } from "$lib/server/session-cookie";

export const POST: RequestHandler = async ({ cookies }) => {
  const config = getConfig();

  let idToken: string | null = null;
  const cookieValue = cookies.get(SESSION_COOKIE);
  const sessionId = cookieValue ? verifySessionCookie(config.sessionSecret, cookieValue) : null;
  if (sessionId) {
    const control = getControlDb();
    const session = getSession(control, sessionId, new Date());
    idToken = session?.id_token ?? null;
    deleteSession(control, sessionId);
  }
  clearSessionCookie(cookies);

  if (config.auth.mode === "bypass") {
    // The bypass re-authenticates every request; there is nowhere to log out to.
    throw redirect(303, "/");
  }

  let endSessionUrl: string | null = null;
  try {
    const endpoints = await getOidcEndpoints();
    if (endpoints.end_session_endpoint) {
      endSessionUrl = buildEndSessionUrl(endpoints.end_session_endpoint, {
        idTokenHint: idToken,
        postLogoutRedirectUri: config.origin,
      });
    }
  } catch {
    endSessionUrl = null;
  }

  throw redirect(303, endSessionUrl ?? "/login");
};
