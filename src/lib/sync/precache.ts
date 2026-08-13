/**
 * Ask the service worker to cache a plan's session payloads while a network still exists
 * (design spec §7).
 *
 * `/plan/<slug>/session/<key>/__data.json` is exactly what SvelteKit fetches on a
 * client-side navigation to that route, so caching it makes the session *startable*
 * offline rather than only continuable — and it requires no change to `+page.server.ts`.
 */
export async function precacheSessions(
  planSlug: string,
  sessionKeys: readonly string[],
): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  const registration = await navigator.serviceWorker.ready;
  const worker = registration.active;
  if (!worker) return;

  worker.postMessage({
    type: "precache",
    urls: sessionKeys.map((key) => `/plan/${planSlug}/session/${key}/__data.json`),
  });
}
