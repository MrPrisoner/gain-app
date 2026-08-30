/**
 * The one `localStorage` prefix the session runner writes, and the two operations that
 * need to agree on it.
 *
 * The runner stores a workout's client id under `gain:workout:<planSlug>:<sessionKey>`
 * so a reload resumes the workout it already created rather than starting a second one.
 * That makes the key a small piece of shared state between the runner and anything that
 * wipes an account, and getting the two out of step is not a cosmetic problem: after a
 * reset, a surviving key points at a workout that no longer exists, and if a later
 * re-import reuses the same plan slug and session key, the runner reads it back as
 * "already started" and never writes the new workout's `start` op at all.
 *
 * Both functions no-op where `localStorage` is unavailable (SSR, and a browser with
 * storage disabled) rather than throwing, because the callers are render paths.
 */

const WORKOUT_KEY_PREFIX = "gain:workout:";

/** The runner's storage key for one plan/session pair. */
export function workoutStorageKey(planSlug: string, sessionKey: string): string {
  return `${WORKOUT_KEY_PREFIX}${planSlug}:${sessionKey}`;
}

/**
 * Drop every stored workout key. Called after an account reset wipes the plans those
 * keys refer to — clearing the whole prefix rather than leaving it to rot is what keeps
 * a later re-import from resuming a workout that was deleted.
 *
 * Iterates downwards because `removeItem` reindexes `localStorage.key(i)` as it goes.
 */
export function clearWorkoutStorage(storage: Storage | undefined = globalThis.localStorage): void {
  if (!storage) return;
  for (let i = storage.length - 1; i >= 0; i -= 1) {
    const key = storage.key(i);
    if (key?.startsWith(WORKOUT_KEY_PREFIX)) storage.removeItem(key);
  }
}
