<!-- src/routes/plan/[slug]/progress/+page.svelte -->
<script lang="ts">
  import Sparkline from "$lib/components/Sparkline.svelte";
  import BarChart from "$lib/components/BarChart.svelte";
  import ArchivedNote from "$lib/components/ArchivedNote.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import WindowPills from "$lib/components/WindowPills.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const MOVERS_SHOWN = 5;
  let showAllMovers = $state(false);
  const visibleMovers = $derived(showAllMovers ? data.movers : data.movers.slice(0, MOVERS_SHOWN));

  const sessionCaption = $derived(
    `${data.consistency.sessionCount} session${data.consistency.sessionCount === 1 ? "" : "s"}`,
  );

  function windowHref(id: string): string {
    return `/plan/${data.planSlug}/progress?window=${id}`;
  }

  /** Always with its basis, never a bare percentage. */
  function formatDelta(pct: number | undefined): string {
    if (pct === undefined) return "First session in this window";
    const rounded = Math.round(pct * 100);
    return `${rounded >= 0 ? "+" : ""}${rounded}%`;
  }

  /**
   * About this many dated bars, whatever the bucket count. An `MM-DD` label is roughly 25
   * units wide in a 320-unit viewBox, so labelling every bucket collides from about eight
   * bars on — and the strip runs to `MAX_WEEK_BUCKETS`. Every bar still names its own week
   * exactly through the chart's tap-to-reveal readout, so these labels orient the axis
   * rather than being the only way to read a value.
   */
  const MAX_WEEK_LABELS = 6;

  /** Labels are counted back from the LAST bucket, so the most recent week is always the
   * one named — an axis whose right-hand end is unlabelled is the one that misleads. */
  function weekBars(weeks: { weekStart: string; count: number }[]) {
    const step = Math.max(1, Math.ceil(weeks.length / MAX_WEEK_LABELS));
    return weeks.map((w, i) => ({
      value: w.count,
      label: (weeks.length - 1 - i) % step === 0 ? w.weekStart.slice(5) : undefined,
    }));
  }
</script>

<PageHeader title={`${data.planName} — progress`} backHref="/" backLabel="Back to your plans" />

{#if data.planArchived}
  <ArchivedNote />
{/if}

<WindowPills
  options={data.windowOptions}
  selected={data.selectedWindow}
  hrefFor={windowHref}
  caption={sessionCaption}
/>

{#if data.consistency.sessionCount === 0}
  <EmptyState title="Nothing logged in this window" />
  <p class="empty-hint">
    <a href={windowHref("all")}>Look at your full history instead</a>
  </p>
{:else}
  <section class="headline" aria-label="What changed">
    <p class="stat"><strong>{data.headline.newBests}</strong> new bests</p>
    <p class="stat"><strong>{data.headline.readyToIncrease}</strong> ready to go up</p>
    <p class="stat">
      <strong>{data.headline.improved.count} of {data.headline.improved.comparable}</strong>
      movements improved
    </p>
  </section>

  {#if data.ready.length > 0}
    <section aria-labelledby="ready-heading">
      <h2 id="ready-heading">Ready to go up</h2>
      <ul class="ready-list">
        {#each data.ready as row (row.sessionKey + ":" + row.exerciseSlug)}
          <li>
            <a
              href={`/plan/${data.planSlug}/progress/exercises/${row.sessionKey}/${row.exerciseSlug}`}
            >
              <span class="row-name">{row.exerciseName}</span>
              <span class="row-sub">{row.sessionName}</span>
              <span class="row-sub">{row.summary}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section aria-labelledby="movers-heading">
    <h2 id="movers-heading">Where you're moving</h2>
    <ul class="mover-list">
      {#each visibleMovers as mover (mover.exerciseSlug)}
        <li>
          <a
            href={`/plan/${data.planSlug}/progress/exercises/${mover.linkSessionKey}/${mover.exerciseSlug}`}
          >
            <span class="row-name">
              {mover.exerciseName}
              {#if mover.latestIsBreakthrough}<span class="badge">new best</span>{/if}
            </span>
            <span class="row-sub">
              {#if mover.deltaPct === undefined}
                {mover.to} · one session so far
              {:else}
                {mover.from} → {mover.to} · <span class="delta">{formatDelta(mover.deltaPct)}</span>
              {/if}
            </span>
            <Sparkline
              points={mover.points}
              width={320}
              height={48}
              padding={6}
              ariaLabel={`${mover.exerciseName} progress trend chart`}
              formatPointLabel={() => undefined}
              formatReadout={(p) =>
                `${p.y.toFixed(1)} on ${new Date(p.x).toISOString().slice(0, 10)}`}
            />
          </a>
        </li>
      {/each}
    </ul>
    {#if data.movers.length > MOVERS_SHOWN && !showAllMovers}
      <button class="show-all" onclick={() => (showAllMovers = true)}>
        Show all {data.movers.length} movements
      </button>
    {/if}
  </section>

  <section aria-labelledby="consistency-heading">
    <h2 id="consistency-heading">Showing up</h2>
    <BarChart
      data={weekBars(data.consistency.weeks)}
      ariaLabel="sessions per week bar chart"
      formatReadout={(d, i) =>
        `${d.value} session${d.value === 1 ? "" : "s"} in the week of ${
          data.consistency.weeks[i]?.weekStart
        }`}
    />
    <p class="stat-line">
      {sessionCaption} · {data.consistency.streakWeeks}-week streak · {data.consistency
        .deviationCount} deviation{data.consistency.deviationCount === 1 ? "" : "s"}
    </p>
    <table class="session-table">
      <thead>
        <tr><th scope="col">Session</th><th scope="col">Done</th><th scope="col">Deviations</th></tr
        >
      </thead>
      <tbody>
        {#each data.consistency.bySessionType as row (row.key)}
          <tr><td>{row.name}</td><td>{row.finished}</td><td>{row.deviations}</td></tr>
        {/each}
      </tbody>
    </table>
  </section>

  {#if data.metrics.length > 0}
    <section aria-labelledby="metrics-heading">
      <h2 id="metrics-heading">How you've felt</h2>
      {#each data.metrics as metric (metric.scope + ":" + metric.key)}
        <div class="metric-row">
          <p class="row-name">{metric.label}</p>
          <p class="row-sub">{metric.scope} scope · latest {metric.latest?.toFixed(1)}</p>
          <Sparkline
            points={metric.points}
            height={64}
            yDomain={metric.domain}
            ariaLabel={`${metric.label} (${metric.scope}) trend chart`}
            formatPointLabel={(p, i, all) => (i === all.length - 1 ? p.y.toFixed(1) : undefined)}
            formatReadout={(p) =>
              `${p.y.toFixed(1)} on ${new Date(p.x).toISOString().slice(0, 10)}`}
          />
        </div>
      {/each}
    </section>
  {/if}
{/if}

<style>
  .headline {
    display: grid;
    gap: var(--s-2);
    padding: var(--pad-card);
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    margin-bottom: 1.25rem;
  }
  .stat {
    margin: 0;
    color: var(--muted);
    font-size: var(--t-sm);
  }
  .stat strong {
    color: var(--text);
    font-size: var(--t-base);
  }
  h2 {
    font-size: var(--t-base);
    margin: 0 0 0.5rem;
  }
  section {
    margin-bottom: 1.5rem;
  }
  .ready-list,
  .mover-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--s-3);
  }
  .ready-list a,
  .mover-list a {
    display: grid;
    gap: var(--s-1);
    min-height: 2.75rem;
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--line-soft);
    color: var(--text);
    text-decoration: none;
  }
  .row-name {
    font-weight: var(--w-bold);
  }
  .row-sub {
    font-size: var(--t-sm);
    color: var(--muted);
  }
  .delta {
    color: var(--accent);
    font-weight: var(--w-semi);
  }
  .badge {
    margin-left: var(--s-2);
    padding: 0 var(--s-2);
    border-radius: var(--r-xs);
    background: color-mix(in srgb, var(--accent) 22%, var(--surface));
    color: var(--accent);
    font-size: var(--t-sm);
    font-weight: var(--w-semi);
  }
  .show-all {
    margin-top: var(--s-3);
    min-height: 2.75rem;
    padding: var(--s-2) var(--s-4);
    border-radius: var(--r-sm);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
  }
  .stat-line {
    margin: var(--s-3) 0 0;
    color: var(--muted);
    font-size: var(--t-sm);
  }
  .session-table {
    width: 100%;
    margin-top: var(--s-3);
    border-collapse: collapse;
    font-size: var(--t-sm);
  }
  .session-table th,
  .session-table td {
    text-align: left;
    padding: var(--s-2) 0;
    border-bottom: 1px solid var(--line-soft);
    color: var(--muted);
  }
  .session-table td:first-child {
    color: var(--text);
  }
  .metric-row {
    margin-bottom: var(--s-4);
  }
  .metric-row p {
    margin: 0 0 var(--s-1);
  }
  .empty-hint {
    font-size: var(--t-sm);
  }
</style>
