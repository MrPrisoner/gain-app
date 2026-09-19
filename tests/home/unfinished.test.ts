/**
 * The merge of the server's view of unfinished sessions (`openWorkoutsForPlan`) with the
 * device's `localStorage` resume pointers (`listStoredWorkouts`) — the fallback for a
 * workout logged entirely offline, which the server-rendered Home cannot see at all.
 */

import { describe, expect, it } from "vitest";
import { mergeUnfinished, partitionUnfinished } from "../../src/lib/home/unfinished";
import { ulidAt } from "../helpers/ulid-at";

const NOW = new Date("2026-09-19T20:00:00.000Z");
const FRESH = ulidAt(NOW.getTime() - 60 * 60 * 1000);
const STALE = ulidAt(NOW.getTime() - 30 * 60 * 60 * 1000);

describe("mergeUnfinished", () => {
  it("marks a workout inside the window resumable", () => {
    const merged = mergeUnfinished({
      server: [
        {
          workoutClientId: FRESH,
          planSlug: "p",
          sessionKey: "A",
          startedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
          setCount: 2,
        },
      ],
      local: [],
      pendingDiscards: [],
      now: NOW,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.resumable).toBe(true);
  });

  it("marks a workout past the window not resumable", () => {
    const merged = mergeUnfinished({
      server: [
        {
          workoutClientId: STALE,
          planSlug: "p",
          sessionKey: "A",
          startedAt: new Date(NOW.getTime() - 30 * 60 * 60 * 1000).toISOString(),
          setCount: 2,
        },
      ],
      local: [],
      pendingDiscards: [],
      now: NOW,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.resumable).toBe(false);
  });

  it("includes a local-only workout the server has never seen", () => {
    // Logged offline, not yet synced. Without this the first load after a garage
    // session shows nothing, which is the whole scenario the card exists for.
    const merged = mergeUnfinished({
      server: [],
      local: [{ planSlug: "p", sessionKey: "A", workoutClientId: FRESH }],
      pendingDiscards: [],
      now: NOW,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.setCount).toBeUndefined();
  });

  it("prefers the server's record when both sources have the same workout", () => {
    // The server knows the set count; the pointer does not.
    const merged = mergeUnfinished({
      server: [
        {
          workoutClientId: FRESH,
          planSlug: "p",
          sessionKey: "A",
          startedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
          setCount: 3,
        },
      ],
      local: [{ planSlug: "p", sessionKey: "A", workoutClientId: FRESH }],
      pendingDiscards: [],
      now: NOW,
    });
    expect(merged[0]?.setCount).toBe(3);
  });

  it("does not duplicate a workout present in both sources", () => {
    const merged = mergeUnfinished({
      server: [
        {
          workoutClientId: FRESH,
          planSlug: "p",
          sessionKey: "A",
          startedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
          setCount: 3,
        },
      ],
      local: [{ planSlug: "p", sessionKey: "A", workoutClientId: FRESH }],
      pendingDiscards: [],
      now: NOW,
    });
    expect(merged).toHaveLength(1);
  });

  it("omits a workout with a discard still queued", () => {
    // The op has not synced, so the server still reports the row. Rendering a card for
    // a workout the user already discarded would look like the discard failed.
    const open = {
      workoutClientId: FRESH,
      planSlug: "p",
      sessionKey: "A",
      startedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
      setCount: 3,
    };
    expect(
      mergeUnfinished({
        server: [open],
        local: [],
        pendingDiscards: [open.workoutClientId],
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("orders newest first", () => {
    const older = ulidAt(NOW.getTime() - 2 * 60 * 60 * 1000);
    const newer = ulidAt(NOW.getTime() - 60 * 60 * 1000);
    const merged = mergeUnfinished({
      server: [
        {
          workoutClientId: older,
          planSlug: "p",
          sessionKey: "A",
          startedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(),
          setCount: 1,
        },
        {
          workoutClientId: newer,
          planSlug: "p",
          sessionKey: "B",
          startedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
          setCount: 1,
        },
      ],
      local: [],
      pendingDiscards: [],
      now: NOW,
    });
    expect(merged.map((m) => m.workoutClientId)).toEqual([newer, older]);
  });

  it("drops a local pointer whose client id is not a ULID", () => {
    // Nothing can be said about its age, so nothing honest can be rendered for it.
    expect(
      mergeUnfinished({
        server: [],
        local: [{ planSlug: "p", sessionKey: "A", workoutClientId: "junk" }],
        pendingDiscards: [],
        now: NOW,
      }),
    ).toEqual([]);
  });
});

describe("partitionUnfinished", () => {
  // Two different session keys on one plan, both started inside the twelve-hour window:
  // session A this morning, abandoned, then session B started directly tonight before
  // A's window expired. Nothing in `startWorkout` prevents this. The regression this
  // guards: only one workout was ever promoted, and the second resumable one was
  // filtered out of the notice list too (it isn't `!resumable`), so it vanished from
  // Home entirely.
  it("promotes only the newest of two simultaneously-resumable workouts, and keeps the other visible as a notice", () => {
    const older = ulidAt(NOW.getTime() - 6 * 60 * 60 * 1000);
    const newer = ulidAt(NOW.getTime() - 60 * 60 * 1000);
    const merged = mergeUnfinished({
      server: [
        {
          workoutClientId: older,
          planSlug: "p",
          sessionKey: "A",
          startedAt: new Date(NOW.getTime() - 6 * 60 * 60 * 1000).toISOString(),
          setCount: 2,
        },
        {
          workoutClientId: newer,
          planSlug: "p",
          sessionKey: "B",
          startedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
          setCount: 1,
        },
      ],
      local: [],
      pendingDiscards: [],
      now: NOW,
    });
    // Both genuinely resumable — the bug's precondition.
    expect(merged.every((u) => u.resumable)).toBe(true);

    const { promoted, rest } = partitionUnfinished(merged);
    expect(promoted?.workoutClientId).toBe(newer);
    expect(rest.map((u) => u.workoutClientId)).toEqual([older]);
    // The demoted one is still marked resumable in the data even though it renders as a
    // notice — promotion is a layout decision, not a restatement of resumability.
    expect(rest[0]?.resumable).toBe(true);
  });

  it("promotes nothing and treats every workout as a notice when none is resumable", () => {
    const stale = ulidAt(NOW.getTime() - 30 * 60 * 60 * 1000);
    const merged = mergeUnfinished({
      server: [
        {
          workoutClientId: stale,
          planSlug: "p",
          sessionKey: "A",
          startedAt: new Date(NOW.getTime() - 30 * 60 * 60 * 1000).toISOString(),
          setCount: 2,
        },
      ],
      local: [],
      pendingDiscards: [],
      now: NOW,
    });
    const { promoted, rest } = partitionUnfinished(merged);
    expect(promoted).toBeUndefined();
    expect(rest.map((u) => u.workoutClientId)).toEqual([stale]);
  });

  it("promotes the sole resumable workout and leaves rest empty", () => {
    const merged = mergeUnfinished({
      server: [
        {
          workoutClientId: FRESH,
          planSlug: "p",
          sessionKey: "A",
          startedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
          setCount: 2,
        },
      ],
      local: [],
      pendingDiscards: [],
      now: NOW,
    });
    const { promoted, rest } = partitionUnfinished(merged);
    expect(promoted?.workoutClientId).toBe(FRESH);
    expect(rest).toEqual([]);
  });
});
