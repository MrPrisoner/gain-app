<script lang="ts">
  import { ulid } from "ulidx";
  import { applyAction, enhance } from "$app/forms";
  import type { ActionResult } from "@sveltejs/kit";
  import type { MetricDef } from "$lib/contract/schema";

  /**
   * One metric prompt (UI-DECISIONS §8), shared by the pre-session gate and the wrap-up
   * sheet — a scale renders as one row of tappable cells (no slider), an enum the same
   * way over its declared options. One tap both selects and submits — there is no
   * separate "save" step and no per-metric skip control, since an untapped metric simply
   * writes nothing. `selected`/`onSelected` are owned by the caller (each scope keeps its
   * own tap-to-select state) rather than by this component, so a pre-session answer and a
   * wrap-up answer for the same metric key never collide.
   *
   * A `fieldset`/`legend` names the group rather than a `<label>` wrapping the whole row
   * of buttons — a label associates with exactly one control, and this row is a group of
   * several independent submit buttons, one per cell. The row is sized to its own cell
   * count (`--cells`) rather than a fixed column count, so an 11-cell 0–10 scale and a
   * 3-option enum each get a grid fit to what they actually render — UI-DECISIONS §8:
   * "a row of tappable cells", not a wrap.
   */
  let {
    metric,
    workoutId,
    selected,
    onSelected,
    onResult,
  }: {
    metric: MetricDef;
    workoutId: string | undefined;
    selected: number | string | undefined;
    onSelected: (value: number | string) => void;
    onResult: (result: ActionResult) => void;
  } = $props();
</script>

{#if metric.type === "scale" || metric.type === "number"}
  {@const cellCount = (metric.max ?? 0) - (metric.min ?? 0) + 1}
  <fieldset class="metric-field">
    <legend>{metric.label}</legend>
    <div class="scale-row" style:--cells={cellCount}>
      {#each Array.from({ length: cellCount }, (_, i) => (metric.min ?? 0) + i) as value (value)}
        <form
          method="POST"
          action="?/logMetric"
          use:enhance={() => {
            return async ({ result }) => {
              await applyAction(result);
              onResult(result);
              if (result.type === "success") onSelected(value);
            };
          }}
        >
          <input type="hidden" name="scope" value="session" />
          <input type="hidden" name="workout_id" value={workoutId ?? ""} />
          <input type="hidden" name="metric_key" value={metric.key} />
          <input type="hidden" name="value_num" {value} />
          <input type="hidden" name="client_id" value={ulid()} />
          <button type="submit" class="scale-cell" class:selected={selected === value}>
            {value}
          </button>
        </form>
      {/each}
    </div>
  </fieldset>
{:else if metric.type === "enum"}
  {@const options = metric.options ?? []}
  <fieldset class="metric-field">
    <legend>{metric.label}</legend>
    <div class="scale-row" style:--cells={options.length}>
      {#each options as option (option)}
        <form
          method="POST"
          action="?/logMetric"
          use:enhance={() => {
            return async ({ result }) => {
              await applyAction(result);
              onResult(result);
              if (result.type === "success") onSelected(option);
            };
          }}
        >
          <input type="hidden" name="scope" value="session" />
          <input type="hidden" name="workout_id" value={workoutId ?? ""} />
          <input type="hidden" name="metric_key" value={metric.key} />
          <input type="hidden" name="value_text" value={option} />
          <input type="hidden" name="client_id" value={ulid()} />
          <button type="submit" class="scale-cell" class:selected={selected === option}>
            {option}
          </button>
        </form>
      {/each}
    </div>
  </fieldset>
{/if}

<style>
  /* Reset the browser's default fieldset chrome — this is a semantic grouping for the
     row of cells below, not a bordered box. */
  .metric-field {
    border: none;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  .metric-field legend {
    padding: 0;
    font: inherit;
    color: var(--text);
  }
  /* UI-DECISIONS §8: "a row of tappable cells — one tap, no slider." A grid sized to
     `--cells` (this instance's own cell count) rather than a fixed column count or
     `flex-wrap`, so an 11-cell 0–10 scale renders as one clean row at 320–360px instead
     of wrapping into ragged rows, and a metric with fewer cells (an enum, a narrower
     scale) gets a grid sized to what it actually renders rather than a hardcoded 11
     columns. Each `<form>` is itself a grid item — there is no extra wrapper — so
     `minmax(0, 1fr)` lets a cell shrink below its button's content width instead of
     forcing the row wider than the viewport. */
  .scale-row {
    display: grid;
    grid-template-columns: repeat(var(--cells, 1), minmax(0, 1fr));
    gap: 0.3rem;
    margin-top: 0.3rem;
  }
  /* Touch-target sweep (UI-DECISIONS §12), ruled on rather than changed further: `min-height`
     alone (not `min-width`) is deliberate here. CONTRACT places no bound on a metric's
     `min`/`max`, and 0-10 scales are standard clinical convention for pain/symptom
     tracking, not test-fixture noise — real plans will keep declaring them. At 360px an
     11-cell row (`--cells: 11`) leaves ~29px per cell, under the 44px square a lone tap
     target would want. Forcing every cell to a true 44×44 square would either force the
     row to wrap across lines (reopening the ragged-wrap bug UI-DECISIONS §8 fixed) or
     need horizontal scroll inside an already-scrolling sheet — both worse than a row of
     adjacent cells sized to the scale's own width. Height is the tap dimension that
     matters for a row of buttons — width is intentionally left to shrink to fit whatever
     width the plan-declared scale needs in one row. */
  .scale-cell {
    width: 100%;
    min-height: 2.75rem;
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    border-radius: var(--r-xs);
    padding: 0.4rem 0.3rem;
  }
  .scale-cell.selected {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
</style>
