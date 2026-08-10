<script lang="ts">
  import "../app.css";
  import { REPO_URL } from "$lib/repo";
  import type { LayoutData } from "./$types";

  let { data, children }: { data: LayoutData; children: import("svelte").Snippet } = $props();
</script>

<div class="shell">
  <header class="top">
    <a class="wordmark" href="/">G<span class="ai">AI</span>N</a>
    <div class="top-right">
      {#if data.user?.bypass}
        <span class="badge" title="GAIN_DEV_USER is active — development only">dev bypass</span>
      {/if}
      {#if data.user && !data.user.bypass}
        <form method="POST" action="/logout">
          <button class="linklike" type="submit">Sign out</button>
        </form>
      {/if}
    </div>
  </header>

  <main class="content">
    {@render children()}
  </main>

  <footer class="foot">
    <!-- AGPL §13: a running instance must offer its source to its users. -->
    GAIN is free software under AGPL-3.0 —
    <a href={REPO_URL} rel="external">source</a>
  </footer>
</div>

<style>
  .shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.9rem 1.25rem;
    border-bottom: 1px solid var(--line-soft);
    background: var(--surface);
  }

  .wordmark {
    font-size: 1.15rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: var(--text);
    text-decoration: none;
  }

  .wordmark .ai {
    /* matches the "AI" highlight in the app icon (static/gain-blue-steel.svg) */
    color: #6a8098;
  }

  .top-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .badge {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--amber);
    background: var(--amber-soft);
    padding: 0.2rem 0.55rem;
    border-radius: var(--r-xs);
  }

  .linklike {
    background: none;
    border: none;
    padding: 0;
    color: var(--muted);
    font-size: 0.9rem;
  }

  .linklike:hover {
    color: var(--text);
    text-decoration: underline;
  }

  .content {
    flex: 1;
    width: 100%;
    max-width: 46rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
  }

  .foot {
    padding: 1rem 1.25rem 1.5rem;
    border-top: 1px solid var(--line-soft);
    color: var(--dim);
    font-size: 0.8rem;
    text-align: center;
  }
</style>
