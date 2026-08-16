<!-- src/lib/components/Sparkline.svelte -->
<script lang="ts">
  import { layoutLineChart, type ChartPoint } from "$lib/progress/chart-geometry";

  /**
   * A single-series line chart (spec §9: one accent hue, one axis, touch-first). Callers
   * supply both formatters rather than one raw-value formatter, because different
   * callers plot different quantities through the same shape — the load-x-reps chart
   * labels every point with reps while plotting weight; a metric trend labels only its
   * last point, in the metric's own unit.
   *
   * No hover tooltip: this is a phone app. Each mark is its own tap/focus target (the
   * dot IS the hit target, matching how a bar chart's mark already has to work), and the
   * tapped value renders in a caption below the chart rather than a floating layer a
   * thumb would cover.
   */
  let {
    points,
    width = 320,
    height = 120,
    ariaLabel = "trend chart",
    formatPointLabel,
    formatReadout,
    emptyLabel = "No data yet",
  }: {
    points: ChartPoint[];
    width?: number;
    height?: number;
    /** Every chart on a screen says what it is; two charts labelled alike are one
     * chart as far as a screen reader (and a Playwright locator) is concerned. */
    ariaLabel?: string;
    formatPointLabel: (point: ChartPoint, index: number, all: ChartPoint[]) => string | undefined;
    formatReadout: (point: ChartPoint) => string;
    emptyLabel?: string;
  } = $props();

  const padding = 20;
  const layout = $derived(layoutLineChart(points, width, height, padding));
  let tapped = $state<number | undefined>(undefined);
  /**
   * The window picker re-renders this component in place with a different series, so a
   * held index can outlive the point it named — `points[tapped]` would then be
   * `undefined` and `formatReadout` would throw inside the template. Deriving the
   * readout instead of storing it means a stale index simply shows nothing.
   */
  const readout = $derived(
    tapped !== undefined && points[tapped] ? formatReadout(points[tapped]!) : undefined,
  );
</script>

<figure class="sparkline">
  <!-- `role="group"`, not `role="img"`: an image's children are hidden from assistive
       tech, and every point below is a real focusable control with its own label. -->
  <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={ariaLabel}>
    {#if layout.plotted.length > 0}
      <path d={layout.path} class="line" />
      {#each layout.plotted as point, i (i)}
        {@const pointLabel = formatPointLabel(points[i]!, i, points)}
        <!-- Two circles: the visible 8px mark (spec §9) and a transparent 24px hit
             target over it, because a thumb is not 8px wide. -->
        <circle cx={point.cx} cy={point.cy} r="4" class="dot" />
        <circle
          cx={point.cx}
          cy={point.cy}
          r="12"
          class="hit"
          role="button"
          tabindex="0"
          aria-label={formatReadout(points[i]!)}
          onclick={() => (tapped = i)}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              tapped = i;
            }
          }}
        />
        {#if pointLabel !== undefined}
          <text x={point.cx} y={point.cy - 10} text-anchor="middle" class="point-label"
            >{pointLabel}</text
          >
        {/if}
      {/each}
    {:else}
      <text x={width / 2} y={height / 2} text-anchor="middle" class="empty">{emptyLabel}</text>
    {/if}
  </svg>
  {#if readout !== undefined}
    <figcaption class="readout">{readout}</figcaption>
  {/if}
</figure>

<style>
  .sparkline {
    margin: 0;
    width: 100%;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
  }
  .line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .dot {
    fill: var(--accent);
    pointer-events: none;
  }
  .hit {
    fill: transparent;
    cursor: pointer;
  }
  .point-label {
    font-size: 10px;
    fill: var(--muted);
  }
  .empty {
    font-size: 12px;
    fill: var(--dim);
  }
  .readout {
    margin-top: 0.35rem;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text);
    text-align: center;
  }
</style>
