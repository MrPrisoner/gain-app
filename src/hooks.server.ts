/**
 * The auth gate (ARCHITECTURE §4). Every route except `/healthz`, `/login`
 * and `/auth/*` needs a session; a missing one redirects to login, a group
 * lost on refresh ends in a clean 403.
 *
 * Module scope doubles as startup: loading the config validates the whole
 * environment, so a misconfigured container fails on its first import rather
 * than at first login — and the §14 mitigation is the log line that follows:
 * the effective origin and OIDC redirect URI, echoed so a proxy
 * misconfiguration is visible in the container log.
 */

import { building } from "$app/environment";
import { error, redirect, type Handle } from "@sveltejs/kit";
import { checkSession, ensureBypassUser, setSessionCookie } from "$lib/server/auth";
import { getControlDb } from "$lib/server/app-state";
import { getConfig } from "$lib/server/config";
import { purgeExpiredSessions } from "$lib/server/control-db";
import { isNavigationRequest, isPublicPath, loginUrlFor } from "$lib/server/gate";

let started = false;

function startup(): void {
  if (started || building) return;
  started = true;

  const config = getConfig();
  getControlDb();
  purgeExpiredSessions(getControlDb(), new Date());

  console.log(
    `[gain] ready — origin=${config.origin} redirect_uri=${config.redirectUri} ` +
      `data_dir=${config.dataDir} auth=${config.auth.mode}`,
  );
  if (config.auth.mode === "bypass") {
    console.warn(
      "[gain] AUTH BYPASS IS ACTIVE (GAIN_DEV_USER). Development only — production builds refuse it.",
    );
  }
}

startup();

export const handle: Handle = async ({ event, resolve }) => {
  startup();
  event.locals.user = null;

  const { pathname, search } = event.url;
  if (isPublicPath(pathname)) {
    return resolve(event);
  }

  const config = getConfig();
  const now = new Date();

  if (config.auth.mode === "bypass") {
    // `x-gain-e2e-user` lets a Playwright spec ask for its own isolated bypass user
    // instead of the one `GAIN_DEV_USER` names, without needing a second server process
    // — `GAIN_DEV_USER` is read once at boot (module-level `config`), so there is no
    // other way for one running dev server to answer two browser contexts as two
    // different users. Only reachable inside this already dev-only branch: bypass mode
    // requires `GAIN_DEV_USER` to be set, and `getConfig` refuses that in production.
    const devUser = event.request.headers.get("x-gain-e2e-user") ?? config.auth.devUser;
    event.locals.user = {
      id: ensureBypassUser(devUser, now),
      bypass: true,
      // No real OIDC identity in bypass mode; the env var (or the e2e override above)
      // stands in so the greeting can still be exercised without a live IdP.
      displayName: devUser,
      // A name, not a flag: an e2e run drives an admin and a non-admin through
      // `x-gain-e2e-user` against one server process.
      isAdmin: config.devAdmin !== null && config.devAdmin === devUser,
    };
    return resolve(event);
  }

  const check = await checkSession(event.cookies, config, config.auth.oidc, now);
  if (check.status === "anonymous") {
    // A navigation goes to the login page and comes back to where it was
    // headed; anything else gets a 401 it can act on, because a 303 would
    // replay a POST as a GET and discard the body (§4).
    if (!isNavigationRequest(event.request)) {
      throw error(401, "Your session has expired. Sign in again to continue.");
    }
    throw redirect(303, loginUrlFor(pathname, search));
  }
  if (check.status === "forbidden") {
    throw error(403, check.message);
  }
  if (check.setCookie) {
    setSessionCookie(event.cookies, config, check.setCookie);
  }

  event.locals.user = {
    id: check.userId,
    bypass: false,
    displayName: check.displayName,
    isAdmin: check.isAdmin,
  };
  return resolve(event);
};
