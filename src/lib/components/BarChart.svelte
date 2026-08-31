<!-- src/lib/components/BarChart.svelte -->
<script lang="ts">
  import { layoutBarChart, type BarDatum } from "$lib/progress/chart-geometry";

  /**
   * A single-series bar chart. `barFill` defaults to one flat accent fill (volume,
   * duration); the difficulty distribution passes a 3-step sequential accent tint
   * instead, since easy/medium/hard is an ordinal scale, not an identity (dataviz:
   * sequential is the default for a magnitude/ordinal job) — never green/amber/red,
   * which CLAUDE.md reserves for the symptom framework.
   */
  let {
    data,
    width = 320,
    height = 120,
    ariaLabel = "bar chart",
    formatReadout,
    barFill,
    emptyLabel = "No data yet",
  }: {
    data: BarDatum[];
    width?: number;
    height?: number;
    /** See Sparkline: two charts on one screen must not answer to the same name. */
    ariaLabel?: string;
    formatReadout: (datum: BarDatum, index: number) => string;
    barFill?: (datum: BarDatum, index: number) => string;
    emptyLabel?: string;
  } = $props();

  const padding = 20;
  const gap = 4;
  const layout = $derived(layoutBarChart(data, width, height, padding, gap));
  let tapped = $state<number | undefined>(undefined);
  /** A held index can outlive the datum it named when the window picker swaps the
   * series — same reasoning as Sparkline's. */
  const readout = $derived(
    tapped !== undefined && data[tapped] ? formatReadout(data[tapped]!, tapped) : undefined,
  );
  const fillOf = (datum: BarDatum, index: number) =>
    barFill ? barFill(datum, index) : "var(--accent)";
</script>

<figure class="bar-chart">
  <!-- `role="group"`, not `role="img"`: the bars below are real focusable controls. -->
  <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={ariaLabel}>
    {#if layout.length > 0}
      {#each layout as bar, i (i)}
        <rect
          x={bar.x}
          y={bar.y}
          width={bar.barWidth}
          height={Math.max(bar.barHeight, 1)}
          fill={fillOf(data[i]!, i)}
          role="button"
          tabindex="0"
          aria-label={formatReadout(data[i]!, i)}
          onclick={() => (tapped = i)}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              tapped = i;
            }
          }}
        />
        {#if bar.label !== undefined}
          <text x={bar.x + bar.barWidth / 2} y={height - 4} text-anchor="middle" class="bar-label"
            >{bar.label}</text
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
  .bar-chart {
    margin: 0;
    width: 100%;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
  }
  rect {
    cursor: pointer;
  }
  .bar-label {
    /* Fixed px, not a token — see Sparkline's `.point-label` for why SVG `viewBox` text
       can't follow the rem-based type scale. design-scale.test.ts exempts this file. */
    font-size: 10px;
    fill: var(--muted);
  }
  .empty {
    font-size: 12px;
    fill: var(--dim);
  }
  .readout {
    margin-top: 0.35rem;
    font-size: var(--t-sm);
    font-weight: var(--w-bold);
    color: var(--text);
    text-align: center;
  }
</style>
