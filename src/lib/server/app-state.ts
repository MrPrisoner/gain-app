/**
 * Process-wide singletons for server state: the `control.db` handle, the
 * per-user `gain.db` cache, and the OIDC endpoint discovery result.
 *
 * User databases stay open for the life of the process — better-sqlite3 is
 * synchronous and cheap to hold, and reopening per request would pay the
 * migration check every time.
 */

import { openUserDb, type UserDb } from "../db/user-db";
import { defaultInstructionsTemplate } from "./assets";
import { getConfig } from "./config";
import { openControlDb, type ControlDb } from "./control-db";
import { createJwks, discoverEndpoints, type JwksResolver, type OidcEndpoints } from "./oidc";

let controlDb: ControlDb | null = null;

/** The shared `control.db`, opened and migrated on first use. */
export function getControlDb(): ControlDb {
  if (!controlDb) {
    controlDb = openControlDb(getConfig().dataDir, new Date());
  }
  return controlDb;
}

const userDbs = new Map<string, UserDb>();

/**
 * This user's `gain.db`, provisioning it on first touch (ARCHITECTURE §4):
 * the directory tree, the migrations, and the default AI-instruction template
 * seeded from `templates/default-ai-instructions.md`.
 */
export function getUserDbFor(userId: string): UserDb {
  if (resetting.has(userId)) {
    throw new Error(`User ${userId} is being reset; their database is unavailable.`);
  }

  const cached = userDbs.get(userId);
  if (cached) return cached;

  const userDb = openUserDb(getConfig().dataDir, userId, {
    now: new Date(),
    seedTemplates: [
      {
        name: "Default revision instructions",
        body_md: defaultInstructionsTemplate,
        is_default: true,
      },
    ],
  });
  userDbs.set(userId, userDb);
  return userDb;
}

/**
 * Close this user's `gain.db` and forget it. Called before a reset unlinks the file:
 * `better-sqlite3` holds it open, and on Linux the unlink then leaves this process
 * writing to a deleted inode — the reset appears to work and silently does not.
 */
export function evictUserDb(userId: string): void {
  const db = userDbs.get(userId);
  if (db) {
    db.close();
    userDbs.delete(userId);
  }
}

/**
 * Users currently mid-reset. Their sessions are already gone by the time the directory
 * is unlinked, so no *authenticated* request can arrive — but one already in flight can,
 * and would re-open the handle between the eviction and the re-provision.
 */
const resetting = new Set<string>();

export function beginReset(userId: string): void {
  resetting.add(userId);
}

export function endReset(userId: string): void {
  resetting.delete(userId);
}

let endpointsCache: OidcEndpoints | null = null;
let endpointsInFlight: Promise<OidcEndpoints> | null = null;

/**
 * OIDC discovery, cached after the first success. A failed discovery is not
 * cached, so a transient IdP outage recovers on the next request.
 */
export function getOidcEndpoints(): Promise<OidcEndpoints> {
  if (endpointsCache) return Promise.resolve(endpointsCache);
  if (endpointsInFlight) return endpointsInFlight;

  const config = getConfig();
  if (config.auth.mode !== "oidc") {
    return Promise.reject(new Error("OIDC is not configured"));
  }

  endpointsInFlight = discoverEndpoints(config.auth.oidc.issuer).then(
    (endpoints) => {
      endpointsCache = endpoints;
      endpointsInFlight = null;
      return endpoints;
    },
    (err) => {
      endpointsInFlight = null;
      throw err;
    },
  );
  return endpointsInFlight;
}

const jwksByUri = new Map<string, JwksResolver>();

/**
 * The JWKS resolver for this issuer, created once. The resolver owns the key
 * cache, so a fresh one per verification would turn every login and every
 * token refresh into a JWKS fetch.
 */
export function getJwksFor(jwksUri: string): JwksResolver {
  let jwks = jwksByUri.get(jwksUri);
  if (!jwks) {
    jwks = createJwks(jwksUri);
    jwksByUri.set(jwksUri, jwks);
  }
  return jwks;
}

/** Test hook — close handles and drop every cache. */
export function resetAppStateForTests(): void {
  for (const userDb of userDbs.values()) userDb.close();
  userDbs.clear();
  resetting.clear();
  controlDb?.close();
  controlDb = null;
  endpointsCache = null;
  endpointsInFlight = null;
  jwksByUri.clear();
}
