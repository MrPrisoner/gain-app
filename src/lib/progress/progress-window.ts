/**
 * The Progress screen's own time control, deliberately separate from
 * `export/windows.ts`.
 *
 * The export windows exist to serve the reviewing AI: `since_version` is the span it has
 * not seen yet, and every label is prose written into the bundle's H1. Progress has a
 * different reader and a different question. Defaulting it to `since_version` meant a user
 * who revised their plan on Tuesday opened Progress on Wednesday, saw one data point, and
 * read it as "you have made no progress" rather than "you changed the window".
 *
 * `1w` is deliberately not offered. Most plans run a given session once or twice a week,
 * so a one-week window renders one point per session type and an empty movers list — and
 * it is the pill a user reaches for first. A default that can legitimately render nothing
 * is a broken default.
 *
 * There is no notion of a preceding period. An earlier draft carried one so a volume delta
 * could compare the window against the equal-length span before it; volume was cut from
 * the headline (it falls when a double-progression load increase succeeds), which removed
 * the only caller and with it a class of wrong answers — a user five weeks in, on `4w`,
 * would have been compared against a period holding one week of work. Every comparison
 * this screen makes is now within one window.
 *
 * Pure, with the clock injected, like everything else under `src/lib/progress/`.
 */

export type ProgressWindowId = "4w" | "12w" | "26w" | "all";

/** Structurally assignable to `export/bundle.ts`'s `ExportWindow`, which is what lets
 * `filterLogsToWindow` take one of these unchanged. */
export type ProgressWindow = {
  id: ProgressWindowId;
  /** UI label. `26w` reads as arithmetic homework, so it shows as `6m`; the shorter spans
   * stay in weeks, which is how training cadence is actually counted. */
  label: string;
  /** ISO 8601. Absent for `all`. */
  start?: string;
};

/** Long enough to hold ~24 occurrences of a twice-weekly movement, recent enough to be
 * about the user now. */
export const DEFAULT_PROGRESS_WINDOW: ProgressWindowId = "12w";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const SPANS: { id: ProgressWindowId; label: string; weeks: number | null }[] = [
  { id: "4w", label: "4w", weeks: 4 },
  { id: "12w", label: "12w", weeks: 12 },
  { id: "26w", label: "6m", weeks: 26 },
  { id: "all", label: "All", weeks: null },
];

export function progressWindowOptions(now: Date): ProgressWindow[] {
  return SPANS.map(({ id, label, weeks }) =>
    weeks === null
      ? { id, label }
      : { id, label, start: new Date(now.getTime() - weeks * WEEK_MS).toISOString() },
  );
}

/**
 * Never undefined. A hand-edited `?window=` resolves to the default rather than erroring.
 */
export function resolveProgressWindow(id: string | null, now: Date): ProgressWindow {
  const options = progressWindowOptions(now);
  // `SPANS` always contains DEFAULT_PROGRESS_WINDOW, so the fallback is never undefined —
  // the assertion documents that invariant rather than papering over a real gap.
  return options.find((o) => o.id === id) ?? options.find((o) => o.id === DEFAULT_PROGRESS_WINDOW)!;
}
