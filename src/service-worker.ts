/**
 * The app-shell cache and the offline read path (design spec §7).
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
 * deploy invalidates the data entries along with the shell (design spec §2, decision 7).
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
  if (data?.type !== "precache" || !Array.isArray(data.urls)) return;
  const urls = data.urls;
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(urls)));
});

sw.addEventListener("fetch", (event) => {
  const request = event.request;

  /**
   * Never cache a write. A cached `/api/sync` response would ack ops the server never
   * saw, which is the one route by which this design could silently lose a workout.
   */
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;

  // Content-hashed, so a cache hit can never be stale.
  if (PRECACHED.includes(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then((cache) => cache.match(request) as Promise<Response>),
    );
    return;
  }

  event.respondWith(networkFirst(request));
});

async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);

  try {
    const response = await fetch(request);
    // Only a real answer is worth keeping; a 404 or a 500 must not become the cached
    // version of a page that works again tomorrow. Awaited so the write is guaranteed to
    // land before this function's own promise (what `event.respondWith` is waiting on)
    // resolves, rather than racing the service worker's own lifecycle.
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (request.mode === "navigate") {
      const offline = await cache.match("/offline");
      if (offline) return offline;
    }
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

export {};
