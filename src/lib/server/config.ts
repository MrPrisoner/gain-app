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
  /**
   * Who may use this instance: verified email addresses, lower-cased. The gate (§4)
   * compares the ID token's `email` against this set at login and on every refresh.
   */
  allowedEmails: ReadonlySet<string>;
};

export type AuthConfig =
  | { mode: "oidc"; oidc: OidcConfig }
  /** Dev-only bypass (`GAIN_DEV_USER`); refused on any non-loopback ORIGIN. */
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
  /** `${origin}/auth/callback` — registered with the IdP as this client's redirect URI. */
  redirectUri: string;
  /** HMAC key for the session cookie. Random per boot in dev. */
  sessionSecret: string;
  /** Sliding session idle timeout. */
  sessionIdleMs: number;
  auth: AuthConfig;
  /**
   * The verified email addresses that are operators, lower-cased — always a subset of
   * `allowedEmails`. `null` means this instance has no admin at all and `/admin` 404s for
   * everyone — an operator who has not opted in has no admin surface.
   */
  adminEmails: ReadonlySet<string> | null;
  /**
   * Dev-only: the single `GAIN_DEV_USER`-style name that is treated as an operator.
   * A name rather than a flag, so an e2e run can drive an admin and a non-admin at
   * once through the `x-gain-e2e-user` header. Refused on a non-loopback ORIGIN, like
   * the bypass itself.
   */
  devAdmin: string | null;
  /** Release tag baked into the image at build time (`APP_VERSION`); `"dev"` outside CI. */
  appVersion: string;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
/** `openssl rand -hex 32` produces 64; this is a floor well below that, not the target. */
const MIN_SESSION_SECRET_LENGTH = 32;

export function loadConfig(
  env: Record<string, string | undefined>,
  nodeEnv: string | undefined,
): GainConfig {
  const isProduction = nodeEnv === "production";
  const dataDir = env.DATA_DIR ?? "./data";

  const origin = env.ORIGIN?.trim() || (isProduction ? null : "http://localhost:5173");
  if (!origin) {
    throw new Error(
      "ORIGIN is not set. It must be the public HTTPS URL of this instance — SvelteKit needs " +
        "it for CSRF checks and the OIDC redirect URI (ARCHITECTURE §3).",
    );
  }
  // Both dev-only variables are refused on anything that looks like a real deployment.
  // The signal is ORIGIN, not NODE_ENV: `node build` sets NODE_ENV to nothing and neither
  // does adapter-node, so keying on it meant a production bundle started outside the
  // container served every request unauthenticated — while logging that production builds
  // refuse to do so (review 2026-08-27, E1). ORIGIN is the one variable a real deployment
  // cannot avoid setting correctly: SvelteKit rejects cross-origin form posts against it
  // and it forms the OIDC redirect URI, so an instance reachable by anyone but the machine
  // it runs on has a non-loopback ORIGIN by construction.
  const localOrigin = isLoopbackOrigin(origin);
  /**
   * Does this look like an instance somebody other than the operator can reach? Every
   * check below that exists to protect a real deployment keys on this rather than on
   * `isProduction`, for the reason the comment above gives — and that reasoning is not
   * specific to the two dev-only variables. A short signing key, a missing one, and a
   * plaintext ORIGIN are all just as wrong on a `node build` with NODE_ENV unset.
   */
  const looksDeployed = isProduction || !localOrigin;
  const devUser = env.GAIN_DEV_USER?.trim() || null;
  if (devUser && looksDeployed) {
    throw new Error(
      `GAIN_DEV_USER is set on what looks like a real deployment (ORIGIN=${origin}` +
        `${isProduction ? ", NODE_ENV=production" : ""}) — the auth bypass serves every ` +
        "request unauthenticated and is a development tool. Unset GAIN_DEV_USER, or point " +
        "ORIGIN at localhost if this is a development server.",
    );
  }

  const devAdmin = env.GAIN_DEV_ADMIN?.trim() || null;
  if (devAdmin && looksDeployed) {
    throw new Error(
      `GAIN_DEV_ADMIN is set on what looks like a real deployment (ORIGIN=${origin}` +
        `${isProduction ? ", NODE_ENV=production" : ""}) — it is a development tool. ` +
        "Use OIDC_ADMIN_EMAILS instead.",
    );
  }

  if (looksDeployed && !origin.startsWith("https://")) {
    // The session cookie is always issued Secure (§3), so an http:// ORIGIN and the
    // cookie silently disagree: the browser never sends the cookie back, and login
    // fails with no diagnostic pointing at why. Checked after the two
    // guards above deliberately — when a deployment has both problems, "you shipped an
    // auth bypass" is the one to say first.
    throw new Error(
      `ORIGIN must be an https:// URL on a deployed instance, got "${origin}". The session ` +
        "cookie is issued Secure regardless, so an http:// origin fails login without " +
        "explaining why.",
    );
  }

  // The group gate these replaced read a `groups` claim, which an IdP that only brokers a
  // social login (Google, via Tinyauth) never sends. A deployment whose environment
  // still carries either old variable — a Portainer stack, a `docker run -e` — gets told
  // what replaced it, rather than only that OIDC is incomplete. (The shipped
  // compose.yaml names its variables explicitly, so there the old ones never arrive and
  // the "Partial OIDC configuration" error below is what fires instead.)
  for (const retired of ["OIDC_REQUIRED_GROUP", "OIDC_ADMIN_GROUP"] as const) {
    if (env[retired]?.trim()) {
      throw new Error(
        `${retired} is no longer read: access is now an email allowlist. Replace ` +
          "OIDC_REQUIRED_GROUP with OIDC_ALLOWED_EMAILS and OIDC_ADMIN_GROUP with " +
          "OIDC_ADMIN_EMAILS (comma-separated addresses), then unset the old variable.",
      );
    }
  }

  const allowedEmails = parseEmailList("OIDC_ALLOWED_EMAILS", env.OIDC_ALLOWED_EMAILS);
  const oidcEnv = {
    issuer: env.OIDC_ISSUER?.trim() || null,
    clientId: env.OIDC_CLIENT_ID?.trim() || null,
    clientSecret: env.OIDC_CLIENT_SECRET || null,
  };
  const oidcPartials = [oidcEnv.issuer, oidcEnv.clientId, oidcEnv.clientSecret, allowedEmails];
  const oidcComplete = oidcPartials.every((v) => v !== null && v !== "");

  let auth: AuthConfig;
  if (oidcComplete) {
    auth = {
      mode: "oidc",
      oidc: {
        issuer: oidcEnv.issuer as string,
        clientId: oidcEnv.clientId as string,
        clientSecret: oidcEnv.clientSecret as string,
        allowedEmails: allowedEmails as ReadonlySet<string>,
      },
    };
  } else if (oidcPartials.some((v) => v !== null && v !== "")) {
    throw new Error(
      "Partial OIDC configuration: OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and " +
        "OIDC_ALLOWED_EMAILS must all be set together. For local development without an IdP, " +
        "set GAIN_DEV_USER instead.",
    );
  } else if (devUser) {
    auth = { mode: "bypass", devUser };
  } else if (isProduction) {
    throw new Error(
      "No auth configuration: set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and " +
        "OIDC_ALLOWED_EMAILS.",
    );
  } else {
    throw new Error(
      "No auth configuration: set the OIDC_* variables, or set GAIN_DEV_USER for the " +
        "dev-only bypass.",
    );
  }

  const adminEmails = parseEmailList("OIDC_ADMIN_EMAILS", env.OIDC_ADMIN_EMAILS);
  if (adminEmails && auth.mode !== "oidc") {
    throw new Error(
      "OIDC_ADMIN_EMAILS is set but OIDC is not configured. A variable that looks like " +
        "it grants access and silently does nothing is worse than a startup error. " +
        "For local development, set GAIN_DEV_ADMIN to a GAIN_DEV_USER name instead.",
    );
  }
  if (adminEmails && auth.mode === "oidc") {
    // An admin who cannot get past the access gate is never an admin, so an address
    // listed only here is a typo or a half-finished edit — say so rather than ignore it.
    const allowed = auth.oidc.allowedEmails;
    const stranded = [...adminEmails].filter((email) => !allowed.has(email));
    if (stranded.length > 0) {
      throw new Error(
        `OIDC_ADMIN_EMAILS lists ${stranded.join(", ")}, ` +
          `which ${stranded.length === 1 ? "is" : "are"} ` +
          "not in OIDC_ALLOWED_EMAILS. An operator must also be allowed in; add the address " +
          "to both.",
      );
    }
  }

  const sessionSecret = env.SESSION_SECRET || (looksDeployed ? null : devRandomSecret());
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is not set. Generate one with: openssl rand -hex 32");
  }
  if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH && looksDeployed) {
    throw new Error(
      `SESSION_SECRET is only ${sessionSecret.length} characters — a short secret is ` +
        `brute-forceable and every session is signed with it. Generate one with: ` +
        "openssl rand -hex 32",
    );
  }

  return {
    isProduction,
    dataDir,
    origin: origin.replace(/\/$/, ""),
    redirectUri: `${origin.replace(/\/$/, "")}/auth/callback`,
    sessionSecret,
    sessionIdleMs: SEVEN_DAYS_MS,
    auth,
    adminEmails,
    devAdmin: auth.mode === "bypass" ? devAdmin : null,
    appVersion: env.APP_VERSION?.trim() || "dev",
  };
}

/**
 * A comma- or whitespace-separated list of email addresses, lower-cased and de-duplicated.
 * `null` when the variable is unset or holds nothing, so "not configured" stays one case.
 *
 * Lower-casing is the whole of the normalisation. Gmail treats dots and `+tags` as the
 * same mailbox, but that is one provider's rule rather than an address's, and folding them
 * here would let an allowlist entry admit addresses nobody wrote down.
 */
export function parseEmailList(name: string, raw: string | undefined): ReadonlySet<string> | null {
  const entries = (raw ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
  if (entries.length === 0) return null;
  for (const entry of entries) {
    // Deliberately loose — the IdP has already verified the real address; this only
    // catches a pasted group name, a value that lost its domain, or the quotes and
    // brackets a copy from a UI or a mail client brings along. Each of those would
    // otherwise parse, never match, and refuse that user with no hint why.
    if (!/^[^@\s"'<>;]+@[^@\s"'<>;]+$/.test(entry) || entry.startsWith("mailto:")) {
      throw new Error(`${name} contains "${entry}", which is not an email address.`);
    }
  }
  return new Set(entries);
}

/**
 * Is this ORIGIN a loopback address — i.e. reachable only from the machine serving it?
 *
 * Deliberately narrow: a hostname that merely *resolves* to 127.0.0.1 today (a `.local`
 * name, a hosts-file entry) is not accepted, because the question is whether an operator
 * has published this instance, not what DNS currently says.
 */
function isLoopbackOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    // An unparseable ORIGIN is not a loopback one. adapter-node reports the malformed
    // value itself; this only decides whether the bypass is allowed, and "no" is right.
    return false;
  }
  // URL normalises an IPv6 literal to bracketed lowercase, so `[::1]` is what lands here.
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
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
