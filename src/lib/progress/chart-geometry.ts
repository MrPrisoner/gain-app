/**
 * Pure SVG layout math for the hand-rolled charts (one accent hue, no charting
 * dependency). Kept separate from any `.svelte` file so it is unit-testable with exact,
 * hand-calculated pixel expectations rather than a DOM snapshot.
 *
 * Every mark also carries a **hit band** — the full-height column of the chart that
 * belongs to it — because the mark itself is far too small to tap. A line chart's dot is
 * 8 viewBox units across and a bar's height is its own datum, so a low bar is a sliver;
 * both scale down further, since the charts render `width: 100%` inside a viewBox. The
 * bands tile the plot edge to edge, so every tap anywhere in the chart selects the
 * nearest mark and there are no dead zones between them. See UI §12 for the residual
 * limit: past roughly six marks a band is still under the app's own 44px floor, which no
 * per-mark geometry can fix on a 360px phone.
 */

export type ChartPoint = { x: number; y: number; label?: string };
/** `bandX`/`bandWidth` describe the mark's hit band; its height is the chart's own. */
export type HitBand = { bandX: number; bandWidth: number };
export type PlottedPoint = HitBand & {
  cx: number;
  cy: number;
  label: string | undefined;
  value: number;
};

/**
 * Boundaries between `n` marks at the given centres, tiling `[0, width]`: each interior
 * edge sits midway between two neighbours, and the outer two are the chart's own edges.
 */
function hitBands(centres: readonly number[], width: number): HitBand[] {
  return centres.map((cx, i) => {
    const previous = centres[i - 1];
    const next = centres[i + 1];
    const left = previous === undefined ? 0 : (previous + cx) / 2;
    const right = next === undefined ? width : (cx + next) / 2;
    return { bandX: left, bandWidth: right - left };
  });
}

export function layoutLineChart(
  points: readonly ChartPoint[],
  width: number,
  height: number,
  padding: number,
  /** Bounds the plot must at least span. A plan-declared `scale` metric passes its
   * declared min/max, so a 2-to-3 movement on a 0-10 scale renders as the near-flat line
   * it is rather than as a climb. Omitted everywhere else, which preserves the
   * auto-scaling every other chart relies on.
   *
   * It widens the domain rather than replacing it, because an SVG clips to its viewBox: a
   * point outside these bounds would be plotted off-canvas and vanish silently, dot, hit
   * band and line segment together, and the chart would read as though those sessions
   * were never logged. That is reachable without anything being wrong — a plan revision
   * narrowing a scale from 0-10 to 0-5 leaves older values above the new max. Widening
   * keeps the declared range as the floor, which is the whole point of passing one, while
   * never dropping a real observation. */
  yDomain?: readonly [number, number],
): { plotted: PlottedPoint[]; path: string } {
  if (points.length === 0) return { plotted: [], path: "" };

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys, ...(yDomain ? [yDomain[0]] : []));
  const yMax = Math.max(...ys, ...(yDomain ? [yDomain[1]] : []));
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;

  const placed = points.map((p) => {
    const cx =
      points.length === 1 ? width / 2 : padding + ((p.x - xMin) / xSpan) * (width - 2 * padding);
    const cy = height - padding - ((p.y - yMin) / ySpan) * (height - 2 * padding);
    return { cx, cy, label: p.label, value: p.y };
  });

  const bands = hitBands(
    placed.map((p) => p.cx),
    width,
  );
  const plotted = placed.map((p, i) => ({ ...p, ...bands[i]! }));

  const path = plotted
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.cx.toFixed(1)} ${pt.cy.toFixed(1)}`)
    .join(" ");

  return { plotted, path };
}

export type BarDatum = { value: number; label?: string };
export type PlottedBar = HitBand & {
  x: number;
  y: number;
  barWidth: number;
  barHeight: number;
  label: string | undefined;
  value: number;
};

export function layoutBarChart(
  data: readonly BarDatum[],
  width: number,
  height: number,
  padding: number,
  gap: number,
): PlottedBar[] {
  if (data.length === 0) return [];

  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  const plotWidth = width - 2 * padding;
  const plotHeight = height - 2 * padding;
  // The gap yields before the bars do. At the caller's gap, `barWidth` reaches zero at
  // around 71 bars in the hub's own geometry and goes negative past it — and an SVG `rect`
  // with a non-positive width renders nothing at all, so the chart empties out silently
  // rather than looking cramped. Capping the gap at half a bar's share of the plot keeps
  // every bar at least `plotWidth / 2n` wide for any n, and is a no-op at the bar counts
  // every caller actually renders. The legibility fix is upstream, in how many buckets a
  // caller hands over; this is the floor under it.
  const effectiveGap = Math.min(gap, plotWidth / (2 * data.length));
  const barWidth = (plotWidth - effectiveGap * (data.length - 1)) / data.length;

  const placed = data.map((d, i) => {
    const barHeight = (d.value / max) * plotHeight;
    return {
      x: padding + i * (barWidth + effectiveGap),
      y: height - padding - barHeight,
      barWidth,
      barHeight,
      label: d.label,
      value: d.value,
    };
  });

  const bands = hitBands(
    placed.map((b) => b.x + b.barWidth / 2),
    width,
  );
  return placed.map((b, i) => ({ ...b, ...bands[i]! }));
}
