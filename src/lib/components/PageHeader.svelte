<script lang="ts">
  import BackLink from "./BackLink.svelte";

  let {
    title,
    subtitle,
    backHref,
    backLabel = "Back to your plans",
  }: {
    title: string;
    subtitle?: string;
    backHref?: string;
    backLabel?: string;
  } = $props();
</script>

<header class="page-head">
  <h1>{title}</h1>
  {#if subtitle}<p class="sub">{subtitle}</p>{/if}
  {#if backHref}<BackLink href={backHref} label={backLabel} />{/if}
</header>

<style>
  .page-head {
    margin: 0 0 var(--s-5);
  }

  /* `--t-lg` rather than the browser's 2em. Nine of the nineteen h1 rules in this app
     set no size at all, which is why a plan name plus " — progress" wrapped to two lines
     on a 390px phone. */
  h1 {
    margin: 0;
    font-size: var(--t-lg);
    font-weight: var(--w-display);
    line-height: 1.2;
  }

  .sub {
    margin: var(--s-1) 0 0;
    color: var(--muted);
    font-size: var(--t-sm);
  }
</style>
