import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getControlDb, getOidcEndpoints } from "$lib/server/app-state";
import { getConfig } from "$lib/server/config";
import { purgeOidcState, putOidcState } from "$lib/server/control-db";
import { safeReturnTo } from "$lib/server/gate";
import { buildAuthorizationUrl, generatePkce, randomToken } from "$lib/server/oidc";

/** Scopes per ARCHITECTURE §4. */
const SCOPE = "openid profile email groups";

/** Authorization states older than this are garbage. */
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export const load: PageServerLoad = async ({ url }) => {
  const config = getConfig();
  if (config.auth.mode === "bypass") {
    // The bypass authenticates every request; there is nothing to log in to.
    throw redirect(303, "/");
  }

  const errorCode = url.searchParams.get("error");
  if (errorCode) {
    return { loginError: describeLoginError(errorCode) };
  }

  const now = new Date();
  const control = getControlDb();
  purgeOidcState(control, now, STATE_MAX_AGE_MS);

  let endpoints;
  try {
    endpoints = await getOidcEndpoints();
  } catch {
    throw error(
      503,
      "GAIN could not reach its identity provider. Check the OIDC_ISSUER configuration and the container log, then try again.",
    );
  }

  const pkce = generatePkce();
  const state = randomToken(24);
  const nonce = randomToken(24);
  putOidcState(control, {
    state,
    codeVerifier: pkce.verifier,
    nonce,
    // Where the gate turned this request away from, so a deep link survives
    // the sign-in round trip. Validated — only a same-origin path is stored.
    returnTo: safeReturnTo(url.searchParams.get("return_to")),
    now,
  });

  throw redirect(
    303,
    buildAuthorizationUrl({
      authorizationEndpoint: endpoints.authorization_endpoint,
      clientId: config.auth.oidc.clientId,
      redirectUri: config.redirectUri,
      scope: SCOPE,
      state,
      codeChallenge: pkce.challenge,
      nonce,
    }),
  );
};

function describeLoginError(code: string): string {
  switch (code) {
    case "access_denied":
      return "Sign-in was cancelled at the identity provider. Try again when you are ready.";
    case "stale_state":
      return "That sign-in attempt had expired or was already used. Try again.";
    case "missing_params":
      return "The identity provider came back without a sign-in code. Try again.";
    case "token_exchange":
      return "GAIN could not exchange the sign-in code for tokens. Try again; if it keeps happening, the OIDC client configuration is likely wrong.";
    case "no_id_token":
    case "bad_id_token":
      return "The identity provider returned a token GAIN could not verify. Try again; if it keeps happening, check the OIDC provider configuration.";
    default:
      return `Sign-in failed (${code}). Try again.`;
  }
}
