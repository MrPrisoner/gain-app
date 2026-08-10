/**
 * OIDC authorization-code flow with PKCE against Authentik (ARCHITECTURE §4).
 *
 * Everything here takes its I/O as parameters — `fetchImpl` for HTTP, an
 * explicit key for ID-token verification, an injected clock — so the whole
 * flow is unit-testable without a live IdP. The identity key is the `sub`
 * claim, never email; the group gate reads the `groups` claim and is
 * re-checked on every token refresh, not just first login.
 */

import crypto from "node:crypto";
import type { KeyInput } from "jose";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type FetchImpl = typeof fetch;

export class OidcError extends Error {
  constructor(
    message: string,
    /** Machine-readable cause, surfaced in logs and the login-error page. */
    readonly cause_: string,
  ) {
    super(message);
    this.name = "OidcError";
  }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export type OidcEndpoints = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint: string | null;
  userinfo_endpoint: string | null;
};

/** `issuer` may or may not carry a trailing slash; the well-known path appends. */
export function discoveryUrl(issuer: string): string {
  const base = issuer.endsWith("/") ? issuer : `${issuer}/`;
  return new URL(".well-known/openid-configuration", base).toString();
}

export async function discoverEndpoints(
  issuer: string,
  fetchImpl: FetchImpl = fetch,
): Promise<OidcEndpoints> {
  const url = discoveryUrl(issuer);
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch (err) {
    throw new OidcError(
      `could not reach the OIDC discovery document at ${url}: ${String(err)}`,
      "discovery_unreachable",
    );
  }
  if (!response.ok) {
    throw new OidcError(
      `OIDC discovery at ${url} returned HTTP ${response.status}`,
      "discovery_status",
    );
  }

  const data = (await response.json()) as Record<string, unknown>;
  const required = ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"] as const;
  for (const field of required) {
    if (typeof data[field] !== "string" || data[field] === "") {
      throw new OidcError(
        `OIDC discovery document is missing '${field}'`,
        "discovery_missing_field",
      );
    }
  }

  return {
    issuer: data.issuer as string,
    authorization_endpoint: data.authorization_endpoint as string,
    token_endpoint: data.token_endpoint as string,
    jwks_uri: data.jwks_uri as string,
    end_session_endpoint:
      typeof data.end_session_endpoint === "string" ? data.end_session_endpoint : null,
    userinfo_endpoint: typeof data.userinfo_endpoint === "string" ? data.userinfo_endpoint : null,
  };
}

// ---------------------------------------------------------------------------
// PKCE + authorization request
// ---------------------------------------------------------------------------

export function randomToken(byteLength: number): string {
  return crypto.randomBytes(byteLength).toString("base64url");
}

export type PkcePair = { verifier: string; challenge: string };

/** RFC 7636 S256: challenge = BASE64URL(SHA-256(verifier)). */
export function generatePkce(): PkcePair {
  const verifier = randomToken(48);
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizationUrl(input: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  nonce: string;
}): string {
  const url = new URL(input.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scope);
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
};

async function tokenRequest(
  tokenEndpoint: string,
  params: Record<string, string>,
  fetchImpl: FetchImpl,
): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetchImpl(tokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(params).toString(),
    });
  } catch (err) {
    throw new OidcError(`could not reach the token endpoint: ${String(err)}`, "token_unreachable");
  }

  const data = (await response.json().catch(() => null)) as
    (TokenResponse & { error?: string; error_description?: string }) | null;

  if (!response.ok || !data || typeof data.access_token !== "string") {
    const detail = data?.error
      ? `${data.error}${data.error_description ? `: ${data.error_description}` : ""}`
      : `HTTP ${response.status}`;
    throw new OidcError(`token request failed — ${detail}`, data?.error ?? "token_status");
  }
  return data;
}

export function exchangeCode(
  endpoints: Pick<OidcEndpoints, "token_endpoint">,
  input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  },
  fetchImpl: FetchImpl = fetch,
): Promise<TokenResponse> {
  return tokenRequest(
    endpoints.token_endpoint,
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code_verifier: input.codeVerifier,
    },
    fetchImpl,
  );
}

export function refreshTokens(
  endpoints: Pick<OidcEndpoints, "token_endpoint">,
  input: { clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl: FetchImpl = fetch,
): Promise<TokenResponse> {
  return tokenRequest(
    endpoints.token_endpoint,
    {
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    },
    fetchImpl,
  );
}

// ---------------------------------------------------------------------------
// ID token verification
// ---------------------------------------------------------------------------

export type IdTokenClaims = {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  groups?: unknown;
  [claim: string]: unknown;
};

/**
 * A JWKS resolver, as returned by `createRemoteJWKSet`. Hold one per issuer and
 * reuse it: the instance owns the key cache, so a fresh one per verification
 * turns every login and every token refresh into a JWKS fetch.
 */
export type JwksResolver = ReturnType<typeof createRemoteJWKSet>;

export function createJwks(jwksUri: string): JwksResolver {
  return createRemoteJWKSet(new URL(jwksUri));
}

export type VerifyIdTokenInput = {
  issuer: string;
  clientId: string;
  /** When set, the `nonce` claim must match exactly. */
  expectedNonce?: string | null;
  /** Injected clock. */
  now?: Date;
  /** Verification key or JWKS resolver. Defaults to a fresh JWKS at `jwksUri`. */
  key?: KeyInput | JwksResolver;
  jwksUri?: string;
  fetchImpl?: FetchImpl;
};

export async function verifyIdToken(
  idToken: string,
  input: VerifyIdTokenInput,
): Promise<IdTokenClaims> {
  let key: KeyInput | JwksResolver;
  if (input.key !== undefined) {
    key = input.key;
  } else if (input.jwksUri) {
    key = createJwks(input.jwksUri);
  } else {
    throw new OidcError("verifyIdToken needs either a key or a jwksUri", "verify_misconfigured");
  }

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(idToken, key, {
      issuer: input.issuer,
      audience: input.clientId,
      clockTolerance: 60,
      currentDate: input.now ?? new Date(),
    });
    payload = result.payload;
  } catch (err) {
    throw new OidcError(`ID token failed verification: ${String(err)}`, "id_token_invalid");
  }

  if (input.expectedNonce != null && payload.nonce !== input.expectedNonce) {
    throw new OidcError(
      "ID token nonce does not match the authorization request",
      "nonce_mismatch",
    );
  }
  if (typeof payload.sub !== "string" || payload.sub === "") {
    throw new OidcError("ID token has no 'sub' claim", "missing_sub");
  }

  return payload as IdTokenClaims;
}

// ---------------------------------------------------------------------------
// The group gate
// ---------------------------------------------------------------------------

/**
 * Reads the `groups` claim tolerantly: an array of strings (Authentik's shape),
 * a single string, or anything else → no groups. Group membership is the only
 * authorisation decision GAIN ever makes (§4).
 */
export function extractGroups(claims: Record<string, unknown>): string[] {
  const raw = claims.groups;
  if (typeof raw === "string") return [raw];
  if (!Array.isArray(raw)) return [];
  return raw.filter((g): g is string => typeof g === "string");
}

export function hasRequiredGroup(groups: readonly string[], requiredGroup: string): boolean {
  return groups.includes(requiredGroup);
}

// ---------------------------------------------------------------------------
// Display name
// ---------------------------------------------------------------------------

/**
 * Reads a friendly display name from ID token claims, for the greeting and
 * the bootstrap prompt — display only, never an identity or authorization
 * decision. `name` first, falling back to `preferred_username` for IdPs or
 * users where it is blank; `null` when neither is a non-empty string.
 */
export function extractDisplayName(claims: Record<string, unknown>): string | null {
  for (const key of ["name", "preferred_username"] as const) {
    const value = claims[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/**
 * Fallback for IdPs that do not put `groups` in the ID token: ask the userinfo
 * endpoint with the access token.
 *
 * Returns `null` — not `[]` — when the endpoint could not be reached or did not
 * answer. "The IdP says you are in no groups" and "GAIN could not ask the IdP"
 * are different facts, and callers make different decisions on them: a login
 * denies on either, but a mid-session re-check must not evict a user over a
 * network blip (§4).
 */
export async function fetchUserinfoGroups(
  userinfoEndpoint: string,
  accessToken: string,
  fetchImpl: FetchImpl = fetch,
): Promise<string[] | null> {
  try {
    const response = await fetchImpl(userinfoEndpoint, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    return extractGroups(data);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

/**
 * Authentik's end-session endpoint. `id_token_hint` makes it a real logout —
 * without it the IdP would re-issue a token on the next login attempt (§4).
 */
export function buildEndSessionUrl(
  endSessionEndpoint: string,
  input: { idTokenHint?: string | null; postLogoutRedirectUri?: string | null },
): string {
  const url = new URL(endSessionEndpoint);
  if (input.idTokenHint) url.searchParams.set("id_token_hint", input.idTokenHint);
  if (input.postLogoutRedirectUri) {
    url.searchParams.set("post_logout_redirect_uri", input.postLogoutRedirectUri);
  }
  return url.toString();
}
