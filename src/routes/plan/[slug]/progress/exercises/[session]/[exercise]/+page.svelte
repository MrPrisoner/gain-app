<!-- src/routes/plan/[slug]/progress/exercises/[session]/[exercise]/+page.svelte -->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import Sparkline from "$lib/components/Sparkline.svelte";
  import BarChart from "$lib/components/BarChart.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  function difficultyBars(counts: { easy: number; medium: number; hard: number }) {
    return [
      { value: counts.easy, label: "Easy" },
      { value: counts.medium, label: "Medium" },
      { value: counts.hard, label: "Hard" },
    ];
  }

  const DIFFICULTY_FILLS = [
    "color-mix(in srgb, var(--accent) 35%, var(--surface))",
    "color-mix(in srgb, var(--accent) 65%, var(--surface))",
    "var(--accent)",
  ];
  function difficultyFill(_datum: unknown, index: number) {
    // `difficultyBars` always returns exactly three data points (easy/medium/hard), so
    // `index` is always in range for this three-entry palette.
    return DIFFICULTY_FILLS[index]!;
  }
</script>

<PageHeader
  title={data.exerciseName}
  subtitle={data.sessionName}
  backHref={`/plan/${data.planSlug}/progress/exercises`}
  backLabel="Back to exercises"
/>

<label class="window-picker">
  Window
  <select
    value={data.selectedWindow}
    onchange={(e) =>
      goto(
        resolve(
          `/plan/[slug]/progress/exercises/[session]/[exercise]?window=${e.currentTarget.value}`,
          {
            slug: page.params.slug!,
            session: page.params.session!,
            exercise: page.params.exercise!,
          },
        ),
        { invalidateAll: true },
      )}
  >
    {#each data.windowOptions as option (option.id)}
      <option value={option.id}>{option.label}</option>
    {/each}
  </select>
</label>

{#each data.charts as chart (chart.side ?? "none")}
  <section class="card">
    {#if chart.side}
      <h2>{chart.side === "left" ? "Left" : "Right"}</h2>
    {/if}
    {#if chart.readiness}
      <p class="readiness">{chart.readiness}</p>
    {/if}

    <h3>{chart.effortHeading}</h3>
    <Sparkline
      points={chart.loadReps}
      ariaLabel={`${chart.side ? `${chart.side === "left" ? "Left" : "Right"} ` : ""}${chart.effortHeading} trend chart`}
      formatPointLabel={(p, i, all) =>
        chart.plots === "load" ? p.label : i === all.length - 1 ? String(p.y) : undefined}
      formatReadout={(p) =>
        `${p.y} ${chart.effortUnit} on ${new Date(p.x).toISOString().slice(0, 10)}${
          p.label ? ` × ${p.label} ${chart.effortLabelUnit}` : ""
        }`}
    />

    {#if chart.volume && chart.volumeDates}
      <h3>Volume</h3>
      <BarChart
        data={chart.volume}
        ariaLabel={chart.side
          ? `${chart.side === "left" ? "Left" : "Right"} volume bar chart`
          : "volume bar chart"}
        formatReadout={(d, i) => `${d.value.toFixed(1)} kg on ${chart.volumeDates?.[i]}`}
      />
    {/if}

    <h3>Difficulty</h3>
    <BarChart
      data={difficultyBars(chart.difficulty)}
      ariaLabel={chart.side
        ? `${chart.side === "left" ? "Left" : "Right"} difficulty bar chart`
        : "difficulty bar chart"}
      formatReadout={(d) => `${d.label}: ${d.value}`}
      barFill={difficultyFill}
    />
  </section>
{/each}

<style>
  .window-picker {
    display: block;
    margin-bottom: 1rem;
    font-size: var(--t-sm);
    color: var(--muted);
  }
  .window-picker select {
    display: block;
    margin-top: 0.25rem;
    width: 100%;
    padding: var(--s-3) var(--s-3);
    border-radius: var(--r-xs);
    border: 1px solid var(--line-strong);
    background: var(--raised);
    color: var(--text);
    font: inherit;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: var(--pad-card);
    margin-bottom: 1rem;
  }
  .card h2 {
    margin: 0 0 0.5rem;
    font-size: var(--t-base);
  }
  .card h3 {
    margin: 1rem 0 0.4rem;
    font-size: var(--t-sm);
    color: var(--muted);
  }
  .readiness {
    font-weight: var(--w-bold);
    margin: 0;
  }
</style>
