/**
 * The app-shell cache and the offline read path.
 *
 * Runs in the service worker context, not the app: nothing here can be imported by a
 * page, and `$service-worker` exists only in this file. That is why precaching route
 * data is driven by a `postMessage` from the app (see `$lib/sync/precache`) rather than
 * by an exported function — the cache name embeds `version`, and only this file knows it.
 */

/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { build, files, version } from "$service-worker";

const sw = self as unknown as ServiceWorkerGlobalScope;

/**
 * Version-keyed, and this is the load-bearing part. A precached `__data.json` is
 * SvelteKit's own client-navigation payload, so its shape belongs to the build that
 * emitted it; a cache that outlived its build would serve a new app an old payload and
 * fail quietly. Keying on `version` and dropping every other cache on activate means a
 * deploy invalidates the data entries along with the shell.
 */
const CACHE = `gain-${version}`;
const PRECACHED = [...build, ...files];

/**
 * `build`/`files` are the built asset bundle, not a rendered route — `/offline`'s own HTML
 * is nowhere in that list. Without caching it explicitly here, the very first time someone
 * ever goes offline (before they have visited `/offline` once while online, which is the
 * only other way `networkFirst` would have it cached) the navigation fallback below finds
 * nothing and falls through to a bare "Offline" text response instead of the real page.
 */
sw.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([...PRECACHED, "/offline"]))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => sw.clients.claim()),
  );
});

/** The app asks for a plan's session payloads to be cached while it still has a network. */
sw.addEventListener("message", (event) => {
  const data = event.data as { type?: string; urls?: string[] } | undefined;

  if (data?.type === "precache" && Array.isArray(data.urls)) {
    const urls = data.urls;
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(urls)));
    return;
  }

  /**
   * Everything this cache holds *about the user's data* — the precached
   * `/plan/<slug>/session/<key>/__data.json` payloads and every page `networkFirst` kept
   * along the way — describes plans an account reset has just deleted. Left in place, a
   * device that goes offline straight after a reset can still open a session route from
   * cache and start logging against a `planVersionId` that no longer exists, and every op
   * it queues quarantines on the next flush.
   *
   * The shell survives: `PRECACHED` and `/offline` are content-hashed build output with
   * no account data in them, and dropping them would leave a just-reset phone with no
   * offline page at all. The reply is what lets `/account` await this before navigating.
   */
  if (data?.type === "purge-user-data") {
    const port = event.ports[0];
    event.waitUntil(
      purgeUserData()
        .catch(() => undefined)
        .then(() => port?.postMessage({ type: "purged" })),
    );
  }
});

async function purgeUserData(): Promise<void> {
  const cache = await caches.open(CACHE);
  const keep = new Set([...PRECACHED, "/offline"]);
  const requests = await cache.keys();
  await Promise.all(
    requests
      .filter((request) => !keep.has(new URL(request.url).pathname))
      .map((request) => cache.delete(request)),
  );
}

sw.addEventListener("fetch", (event) => {
  const request = event.request;

  /**
   * Never cache a write. A cached `/api/sync` response would ack ops the server never
   * saw, which is the one route by which this design could silently lose a workout.
   */
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;

  // Content-hashed, so a cache hit can never be stale. A precached path can still miss
  // the cache in practice — `cache.addAll` during install is all-or-nothing, so one
  // failed fetch leaves every other precached entry uncached too — and `respondWith`
  // resolving to `undefined` is a hard crash for that request, not a soft failure, so
  // this falls back to the network exactly like an unlisted path rather than trusting
  // the list against what the cache actually holds.
  if (PRECACHED.includes(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => (await cache.match(request)) ?? fetch(request)),
    );
    return;
  }

  event.respondWith(networkFirst(request));
});

/**
 * SvelteKit's client router requests a route's `__data.json` with its own
 * `?x-sveltekit-invalidated=...` query param appended — an internal invalidation-tracking
 * token, not a different resource. `precacheSessions` caches the bare URL with no query
 * string at all, so without `ignoreSearch` a precached session's data is *never* found by
 * the real navigation that asks for it: `cache.match` misses on the query string alone,
 * the fetch fails offline, and the client falls back to a hard navigation that isn't
 * cached either — which is what actually happens if this match is left exact.
 */
function dataCacheOptions(url: URL): CacheQueryOptions | undefined {
  return url.pathname.endsWith("/__data.json") ? { ignoreSearch: true } : undefined;
}

async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const matchOptions = dataCacheOptions(new URL(request.url));

  try {
    const response = await fetch(request);
    // Only a real answer is worth keeping; a 404 or a 500 must not become the cached
    // version of a page that works again tomorrow. Awaited so the write is guaranteed to
    // land before this function's own promise (what `event.respondWith` is waiting on)
    // resolves, rather than racing the service worker's own lifecycle.
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, matchOptions);
    if (cached) return cached;

    if (request.mode === "navigate") {
      const offline = await cache.match("/offline");
      if (offline) return offline;
    }
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

export {};
