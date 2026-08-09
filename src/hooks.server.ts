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

  const { pathname } = event.url;
  if (pathname === "/healthz" || pathname === "/login" || pathname.startsWith("/auth/")) {
    return resolve(event);
  }

  const config = getConfig();
  const now = new Date();

  if (config.auth.mode === "bypass") {
    event.locals.user = { id: ensureBypassUser(config.auth.devUser, now), bypass: true };
    return resolve(event);
  }

  const check = await checkSession(event.cookies, config, config.auth.oidc, now);
  if (check.status === "anonymous") {
    throw redirect(303, "/login");
  }
  if (check.status === "forbidden") {
    throw error(403, check.message);
  }
  if (check.setCookie) {
    setSessionCookie(event.cookies, config, check.setCookie);
  }

  event.locals.user = { id: check.userId, bypass: false };
  return resolve(event);
};
