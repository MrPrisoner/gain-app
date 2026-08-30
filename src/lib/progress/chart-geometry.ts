/**
 * Pure SVG layout math for the hand-rolled charts (one accent hue, no charting
 * dependency). Kept separate from any `.svelte` file so it is unit-testable with exact,
 * hand-calculated pixel expectations rather than a DOM snapshot.
 */

export type ChartPoint = { x: number; y: number; label?: string };
export type PlottedPoint = { cx: number; cy: number; label: string | undefined; value: number };

export function layoutLineChart(
  points: readonly ChartPoint[],
  width: number,
  height: number,
  padding: number,
): { plotted: PlottedPoint[]; path: string } {
  if (points.length === 0) return { plotted: [], path: "" };

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;

  const plotted = points.map((p) => {
    const cx =
      points.length === 1 ? width / 2 : padding + ((p.x - xMin) / xSpan) * (width - 2 * padding);
    const cy = height - padding - ((p.y - yMin) / ySpan) * (height - 2 * padding);
    return { cx, cy, label: p.label, value: p.y };
  });

  const path = plotted
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.cx.toFixed(1)} ${pt.cy.toFixed(1)}`)
    .join(" ");

  return { plotted, path };
}

export type BarDatum = { value: number; label?: string };
export type PlottedBar = {
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
  const barWidth = (plotWidth - gap * (data.length - 1)) / data.length;

  return data.map((d, i) => {
    const barHeight = (d.value / max) * plotHeight;
    return {
      x: padding + i * (barWidth + gap),
      y: height - padding - barHeight,
      barWidth,
      barHeight,
      label: d.label,
      value: d.value,
    };
  });
}
