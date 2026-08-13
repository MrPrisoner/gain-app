/**
 * Effective configuration, loaded once from the environment (ARCHITECTURE §3, §4).
 *
 * Pure function over an env map so the validation rules are testable; the
 * singleton at the bottom is what server code reads. Invalid configuration
 * fails loudly at startup rather than at first login — a container that
 * cannot authenticate must not pretend to serve.
 */

import crypto from "node:crypto";

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  requiredGroup: string;
};

export type AuthConfig =
  | { mode: "oidc"; oidc: OidcConfig }
  /** Dev-only bypass (`GAIN_DEV_USER`); refused outright in production. */
  | { mode: "bypass"; devUser: string };

export type GainConfig = {
  isProduction: boolean;
  /** Absolute or cwd-relative root of everything mutable (§3). */
  dataDir: string;
  /**
   * The public URL of this instance. Required in production (adapter-node
   * enforces it too); in dev it defaults to the local dev server.
   */
  origin: string;
  /** `${origin}/auth/callback` — registered in the Authentik provider. */
  redirectUri: string;
  /** HMAC key for the session cookie. Random per boot in dev. */
  sessionSecret: string;
  /** Sliding session idle timeout. */
  sessionIdleMs: number;
  auth: AuthConfig;
  /** Release tag baked into the image at build time (`APP_VERSION`); `"dev"` outside CI. */
  appVersion: string;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function loadConfig(
  env: Record<string, string | undefined>,
  nodeEnv: string | undefined,
): GainConfig {
  const isProduction = nodeEnv === "production";
  const dataDir = env.DATA_DIR ?? "./data";

  const devUser = env.GAIN_DEV_USER?.trim() || null;
  if (devUser && isProduction) {
    throw new Error(
      "GAIN_DEV_USER is set but NODE_ENV=production — the auth bypass is a development tool " +
        "and cannot be enabled in a production build. Unset GAIN_DEV_USER.",
    );
  }

  const oidcEnv = {
    issuer: env.OIDC_ISSUER?.trim() || null,
    clientId: env.OIDC_CLIENT_ID?.trim() || null,
    clientSecret: env.OIDC_CLIENT_SECRET || null,
    requiredGroup: env.OIDC_REQUIRED_GROUP?.trim() || null,
  };
  const oidcPartials = [
    oidcEnv.issuer,
    oidcEnv.clientId,
    oidcEnv.clientSecret,
    oidcEnv.requiredGroup,
  ];
  const oidcComplete = oidcPartials.every((v) => v !== null && v !== "");

  let auth: AuthConfig;
  if (oidcComplete) {
    auth = {
      mode: "oidc",
      oidc: {
        issuer: oidcEnv.issuer as string,
        clientId: oidcEnv.clientId as string,
        clientSecret: oidcEnv.clientSecret as string,
        requiredGroup: oidcEnv.requiredGroup as string,
      },
    };
  } else if (oidcPartials.some((v) => v !== null && v !== "")) {
    throw new Error(
      "Partial OIDC configuration: OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and " +
        "OIDC_REQUIRED_GROUP must all be set together. For local development without an IdP, " +
        "set GAIN_DEV_USER instead.",
    );
  } else if (devUser) {
    auth = { mode: "bypass", devUser };
  } else if (isProduction) {
    throw new Error(
      "No auth configuration: set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and " +
        "OIDC_REQUIRED_GROUP.",
    );
  } else {
    throw new Error(
      "No auth configuration: set the OIDC_* variables, or set GAIN_DEV_USER for the " +
        "dev-only bypass.",
    );
  }

  const origin = env.ORIGIN?.trim() || (isProduction ? null : "http://localhost:5173");
  if (!origin) {
    throw new Error(
      "ORIGIN is not set. It must be the public HTTPS URL of this instance — SvelteKit needs " +
        "it for CSRF checks and the OIDC redirect URI (ARCHITECTURE §3).",
    );
  }

  const sessionSecret = env.SESSION_SECRET || (isProduction ? null : devRandomSecret());
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is not set. Generate one with: openssl rand -hex 32");
  }

  return {
    isProduction,
    dataDir,
    origin: origin.replace(/\/$/, ""),
    redirectUri: `${origin.replace(/\/$/, "")}/auth/callback`,
    sessionSecret,
    sessionIdleMs: SEVEN_DAYS_MS,
    auth,
    appVersion: env.APP_VERSION?.trim() || "dev",
  };
}

function devRandomSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

let cached: GainConfig | null = null;

/** The process-wide configuration. Throws on first call if the env is invalid. */
export function getConfig(): GainConfig {
  if (!cached) cached = loadConfig(process.env, process.env.NODE_ENV);
  return cached;
}

/** Test hook — drops the cached config so the next getConfig() re-reads env. */
export function resetConfigForTests(): void {
  cached = null;
}
