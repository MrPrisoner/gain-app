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

/**
 * The mirror of `precacheSessions`, for the device that just reset its own account
 * (`/account`). The service worker owns the cache name, so it also owns the purge; this
 * only asks, and waits for the reply so the reset can finish clearing local state before
 * navigating rather than racing the worker.
 *
 * The wait is bounded. A worker that is installed but wedged must not be able to hold a
 * reset open indefinitely — a purge that never happened is a stale cache the next online
 * load repairs, whereas a promise that never settles is a button stuck on "Resetting…".
 */
export async function purgeCachedUserData(timeoutMs = 3_000): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  const registration = await navigator.serviceWorker.ready;
  const worker = registration.active;
  if (!worker) return;

  const channel = new MessageChannel();
  const replied = new Promise<void>((resolve) => {
    channel.port1.onmessage = () => resolve();
    setTimeout(resolve, timeoutMs);
  });

  worker.postMessage({ type: "purge-user-data" }, [channel.port2]);
  await replied;
}
