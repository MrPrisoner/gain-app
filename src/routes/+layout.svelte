<script lang="ts">
  import "../app.css";
  import { REPO_URL } from "$lib/repo";
  import { discardQuarantined, setGeneration, syncStatus } from "$lib/sync/client.svelte";
  import type { LayoutData } from "./$types";

  let { data, children }: { data: LayoutData; children: import("svelte").Snippet } = $props();

  // Seeds the client's belief about its own generation from the server's authoritative
  // value on every load (spec §7) — see `client.svelte.ts`'s comment on why this can't
  // just default to 0 and wait for a 409 to correct it.
  $effect(() => setGeneration(data.dataGeneration));

  /**
   * The one sync banner for the whole app (design spec §3, §8) — a queue can be pending
   * on any screen, and a sync state visible only where it was created is a sync state
   * nobody sees. Nothing renders when there is nothing to say: idle with an empty queue
   * and no quarantined ops.
   */
  const bannerText = $derived.by(() => {
    if (syncStatus.resetNotice) {
      return "Your data was reset by the administrator.";
    }

    const { state, pending, quarantined } = syncStatus;
    const parts: string[] = [];

    switch (state) {
      case "syncing":
        parts.push(`Syncing ${pending} workout${pending === 1 ? "" : "s"}…`);
        break;
      case "offline":
        parts.push(`Offline — ${pending} saved on this device`);
        break;
      case "needs-auth":
        parts.push("Signed out — your workout is saved. Reconnect to sync");
        break;
      case "error":
        parts.push(`Sync failed — ${pending} saved on this device. Retrying`);
        break;
      case "idle":
        if (pending > 0) parts.push(`${pending} saved on this device`);
        break;
    }

    if (quarantined > 0) {
      parts.push(`${quarantined} ${quarantined === 1 ? "entry" : "entries"} could not sync`);
    }

    return parts.join(" — ");
  });
</script>

<div class="shell">
  <header class="top">
    <a class="wordmark" href="/">G<span class="ai">AI</span>N</a>
    <div class="top-right">
      {#if data.user?.bypass}
        <span class="badge" title="GAIN_DEV_USER is active — development only">dev bypass</span>
      {/if}
      {#if data.user?.isAdmin}
        <a class="linklike" href="/admin">Users</a>
      {/if}
      {#if data.user && !data.user.bypass}
        <form method="POST" action="/logout">
          <button class="linklike" type="submit">Sign out</button>
        </form>
      {/if}
    </div>
  </header>

  {#if bannerText}
    <p class="sync-banner" role="status">
      {bannerText}
      {#if syncStatus.state === "needs-auth"}
        <a href="/login">Sign in</a>
      {/if}
      {#if syncStatus.quarantined > 0}
        <button class="linklike" type="button" onclick={() => discardQuarantined()}>
          Discard
        </button>
      {/if}
    </p>
  {/if}

  <main class="content">
    {@render children()}
  </main>

  <footer class="foot">
    <!-- AGPL §13: a running instance must offer its source to its users. -->
    GAIN is free software under AGPL-3.0 —
    <a href={REPO_URL} rel="external">source</a>
    · {data.appVersion}
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

  .sync-banner {
    margin: 0;
    padding: 0.5rem 1.25rem;
    background: var(--amber-soft);
    color: var(--amber);
    font-size: 0.85rem;
    text-align: center;
  }

  .sync-banner a {
    color: inherit;
    text-decoration: underline;
    font-weight: 700;
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
