/**
 * The one `localStorage` prefix the session runner writes, and the two operations that
 * need to agree on it.
 *
 * The runner stores a workout's client id under `gain:workout:<planSlug>:<sessionKey>`
 * so a reload resumes the workout it already wrote to rather than starting a second one.
 * That makes the key a small piece of shared state between the runner and anything that
 * wipes an account, and getting the two out of step is not a cosmetic problem: after a
 * reset, a surviving key points at a workout that no longer exists, and if a later
 * re-import reuses the same plan slug and session key, the runner reads it back as
 * "already started" and never writes the new workout's `start` op at all. Under lazy
 * start this failure mode is sharper still: a stale key means no start is even armed, so
 * the first set logged against it strands rather than merely resuming the wrong workout.
 *
 * A stored pointer is no longer honoured unconditionally. The runner age-gates it — and a
 * `?resume=` link from Home's unfinished-session card — against the twelve-hour resume
 * window in `$lib/session/workout-age.ts`, so a key surviving here past that window is
 * read back as "too old to resume" rather than silently reattached to. This module still
 * only stores and enumerates the pointer; it carries no opinion about its age.
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

/**
 * The inverse of `workoutStorageKey`. Neither a plan slug nor a session key may contain
 * a colon, so a well-formed key is exactly four segments and anything else is a key that
 * is not ours, or one a future format wrote. Both get `undefined` rather than a guess —
 * a wrongly-parsed key would render a card pointing at a session that does not exist.
 */
export function parseWorkoutStorageKey(
  key: string,
): { planSlug: string; sessionKey: string } | undefined {
  if (!key.startsWith(WORKOUT_KEY_PREFIX)) return undefined;
  const parts = key.split(":");
  if (parts.length !== 4) return undefined;
  const [, , planSlug, sessionKey] = parts;
  if (!planSlug || !sessionKey) return undefined;
  return { planSlug, sessionKey };
}

/**
 * Every workout this device has a resume pointer for. Home's fallback for the case the
 * server cannot see: a session logged offline whose ops have not synced yet, which is
 * this app's core scenario rather than an edge one.
 *
 * Iterates upwards — unlike `clearWorkoutStorage`, nothing is removed here, so the
 * reindexing that forces that function to count down does not apply.
 */
export function listStoredWorkouts(
  storage: Storage | undefined = globalThis.localStorage,
): { planSlug: string; sessionKey: string; workoutClientId: string }[] {
  if (!storage) return [];
  const found: { planSlug: string; sessionKey: string; workoutClientId: string }[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key === null) continue;
    const parsed = parseWorkoutStorageKey(key);
    if (!parsed) continue;
    const workoutClientId = storage.getItem(key);
    if (!workoutClientId) continue;
    found.push({ ...parsed, workoutClientId });
  }
  return found;
}
