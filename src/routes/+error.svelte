<script lang="ts">
  import { page } from "$app/state";
</script>

<svelte:head>
  <title>{page.status} — GAIN</title>
</svelte:head>

<div class="error-page">
  <p class="status">{page.status}</p>

  {#if page.status === 403}
    <h1>Access denied</h1>
    <p class="explain">{page.error?.message ?? "You do not have access to this GAIN instance."}</p>
  {:else}
    <h1>Something went wrong</h1>
    <p class="explain">
      {page.error?.message ?? "An unexpected error occurred."}
    </p>
  {/if}

  <p><a href="/">Back to GAIN</a></p>
</div>

<style>
  .error-page {
    padding-top: 3rem;
    text-align: center;
  }

  .status {
    margin: 0;
    font-size: 3.5rem;
    font-weight: 800;
    color: var(--dim);
  }

  h1 {
    margin: 0.5rem 0 1rem;
    font-size: 1.4rem;
  }

  .explain {
    max-width: 34rem;
    margin: 0 auto 1.5rem;
    color: var(--muted);
  }
</style>
