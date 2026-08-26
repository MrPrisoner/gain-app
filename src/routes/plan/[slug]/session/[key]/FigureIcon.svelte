<script lang="ts">
  /**
   * The reps/time/load glyph shared by `LogStrip`'s dial units and `RestTimer`'s up-next
   * figures (UI-DECISIONS §4/§2) — one mapping so the two can never drift onto different
   * icons for the same figure kind. `aria-hidden` because the figure's own text already
   * carries the unit ("10–14 reps", "10 kg"); the icon is decoration, not information.
   */
  import IconArrowUpDown from "~icons/lucide/arrow-up-down";
  import IconWeight from "~icons/lucide/weight";
  import IconTimer from "~icons/lucide/timer";

  let { kind }: { kind: "reps" | "time" | "load" } = $props();
</script>

{#if kind === "reps"}
  <IconArrowUpDown aria-hidden="true" />
{:else if kind === "time"}
  <IconTimer aria-hidden="true" />
{:else}
  <IconWeight aria-hidden="true" />
{/if}
