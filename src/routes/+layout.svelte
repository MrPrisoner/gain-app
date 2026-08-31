<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
  import { REPO_URL } from "$lib/repo";
  import { discardQuarantined, setGeneration, syncStatus } from "$lib/sync/client.svelte";
  import { bannerText } from "$lib/sync/banner";
  import { createBannerGate } from "$lib/sync/banner-gate";
  import type { LayoutData } from "./$types";

  let { data, children }: { data: LayoutData; children: import("svelte").Snippet } = $props();

  // Read routes — the paste box, the export bundle, a plan version — get the wide
  // measure (`app.css`'s `--measure-wide`); every other route, including the versions
  // *list*, keeps the phone measure. Matched on `route.id` rather than the resolved
  // pathname so it tracks the route pattern, not a particular `slug`/`n`.
  const wideRoutes = new Set(["/import", "/plan/[slug]/export", "/plan/[slug]/versions/[n]"]);
  let wide = $derived(page.route.id !== null && wideRoutes.has(page.route.id));

  // Seeds the client's belief about its own generation from the server's authoritative
  // value on every load — see `client.svelte.ts`'s comment on why this can't
  // just default to 0 and wait for a 409 to correct it.
  $effect(() => setGeneration(data.dataGeneration));

  /**
   * The one sync banner for the whole app — a queue can be pending
   * on any screen, and a sync state visible only where it was created is a sync state
   * nobody sees. Nothing renders when there is nothing to say: idle with an empty queue
   * and no quarantined ops.
   *
   * What it says lives in `$lib/sync/banner.ts` and when it may say it in
   * `$lib/sync/banner-gate.ts`, both pure and both unit-tested. The gate is why a
   * healthy write is now silent: the banner reflows the page, and a sync that starts and
   * finishes inside 100ms was mounting and unmounting one under the user's thumb
   * mid-session. See that module for the full reasoning.
   */
  let banner = $state("");

  $effect(() => {
    const gate = createBannerGate({
      appearAfterMs: 700,
      minVisibleMs: 1_500,
      onChange: (text) => (banner = text),
    });

    // Nested `$effect` so the gate itself is created once per mount while this inner
    // pass re-runs on every status change. Reading `syncStatus` here rather than in the
    // outer effect is what keeps the gate — and with it the elapsed time a message has
    // been up — from being torn down and rebuilt by the very changes it exists to damp.
    $effect(() => gate.update(bannerText(syncStatus)));

    return () => gate.dispose();
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

  {#if banner}
    <p class="sync-banner" role="status">
      {banner}
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

  <main class="content" class:wide>
    {@render children()}
  </main>

  <footer class="foot">
    <!-- AGPL §13: a running instance must offer its source to its users. -->
    GAIN is free software under AGPL-3.0 —
    <a href={REPO_URL} rel="external">source</a>
    · {data.appVersion}
    {#if data.user}
      · <a href="/account">Account</a>
    {/if}
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
    padding: var(--s-4) var(--s-5);
    border-bottom: 1px solid var(--line-soft);
    background: var(--surface);
  }

  .wordmark {
    display: inline-flex;
    align-items: center;
    /* Blockified by `.top`'s flex layout, so this is a real control per
       `e2e/touch-targets.spec.ts` — the same 44px floor `Button` holds for its own
       controls (UI §12 names the layout chrome alongside the four routes
       that gap was closed on). */
    min-height: 2.75rem;
    font-size: var(--t-md);
    font-weight: var(--w-display);
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
    gap: var(--s-3);
  }

  .badge {
    font-size: var(--t-2xs);
    font-weight: var(--w-bold);
    color: var(--amber);
    background: var(--amber-soft);
    padding: var(--s-1) var(--s-2);
    border-radius: var(--r-xs);
  }

  .linklike {
    background: none;
    border: none;
    padding: 0;
    color: var(--muted);
    font-size: var(--t-sm);
  }

  .linklike:hover {
    color: var(--text);
    text-decoration: underline;
  }

  .sync-banner {
    margin: 0;
    padding: var(--s-2) var(--s-5);
    background: var(--amber-soft);
    color: var(--amber);
    font-size: var(--t-sm);
    text-align: center;
  }

  .sync-banner a {
    color: inherit;
    text-decoration: underline;
    font-weight: var(--w-bold);
  }

  .content {
    flex: 1;
    width: 100%;
    max-width: var(--measure);
    margin: 0 auto;
    padding: var(--s-5) var(--s-5) var(--s-7);
  }

  /* Read routes — the paste box, the export bundle, a plan version — get the wide
     measure over tapped ones. Still one centred column: wider, not multi-column. */
  .content.wide {
    max-width: var(--measure-wide);
  }

  .foot {
    padding: var(--s-4) var(--s-5) var(--s-5);
    border-top: 1px solid var(--line-soft);
    color: var(--dim);
    font-size: var(--t-xs);
    text-align: center;
  }
</style>
