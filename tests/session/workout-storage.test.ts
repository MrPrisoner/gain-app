/**
 * The runner's `localStorage` key and the reset that clears it. These lived in two
 * components that had to agree on a string literal; the hazard is in
 * `workout-storage.ts`'s own comment — a key surviving a reset makes the runner skip
 * writing a new workout's `start` op.
 */

import { describe, expect, it } from "vitest";
import { clearWorkoutStorage, workoutStorageKey } from "../../src/lib/session/workout-storage";

/** Enough of the `Storage` interface for the prefix sweep, backed by a Map. */
function fakeStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe("workoutStorageKey", () => {
  it("namespaces on plan slug and session key", () => {
    expect(workoutStorageKey("home-training", "a")).toBe("gain:workout:home-training:a");
  });

  it("gives two sessions of one plan distinct keys", () => {
    expect(workoutStorageKey("p", "a")).not.toBe(workoutStorageKey("p", "b"));
  });
});

describe("clearWorkoutStorage", () => {
  it("removes every workout key", () => {
    const storage = fakeStorage({
      [workoutStorageKey("p", "a")]: "01H",
      [workoutStorageKey("p", "b")]: "01J",
      [workoutStorageKey("q", "a")]: "01K",
    });
    clearWorkoutStorage(storage);
    expect(storage.length).toBe(0);
  });

  it("leaves unrelated keys alone", () => {
    const storage = fakeStorage({
      [workoutStorageKey("p", "a")]: "01H",
      "gain:theme": "dark",
      other: "x",
    });
    clearWorkoutStorage(storage);
    expect(storage.getItem("gain:theme")).toBe("dark");
    expect(storage.getItem("other")).toBe("x");
    expect(storage.getItem(workoutStorageKey("p", "a"))).toBeNull();
  });

  it("no-ops rather than throwing when storage is unavailable", () => {
    expect(() => clearWorkoutStorage(undefined)).not.toThrow();
  });

  it("removes every key regardless of iteration reindexing", () => {
    // removeItem reindexes key(i); a forward loop would skip every other entry.
    const many = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [workoutStorageKey("p", String(i)), "x"]),
    );
    const storage = fakeStorage(many);
    clearWorkoutStorage(storage);
    expect(storage.length).toBe(0);
  });
});
