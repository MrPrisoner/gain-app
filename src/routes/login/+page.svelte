<script lang="ts">
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Sign in — GAIN</title>
</svelte:head>

<div class="login">
  <h1>GAIN</h1>
  {#if data.loginError}
    <p class="error" role="alert">{data.loginError}</p>
    <a class="button" href="/login">Try again</a>
  {:else}
    <p>Signing you in…</p>
  {/if}
</div>

<style>
  .login {
    min-height: 100dvh;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 1rem;
    padding: 1.5rem;
    text-align: center;
  }

  h1 {
    margin: 0;
    font-size: 2rem;
    font-weight: 800;
    letter-spacing: 0.02em;
  }

  .error {
    max-width: 34rem;
    margin: 0;
    color: var(--muted);
  }

  .button {
    display: inline-block;
    padding: 0.75rem 1.5rem;
    border-radius: var(--r-sm);
    background: var(--accent);
    color: var(--accent-in);
    font-weight: 700;
    text-decoration: none;
  }
</style>
