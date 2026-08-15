<script lang="ts">
  import IconPlay from "~icons/lucide/play";

  /**
   * The Home screen's primary action (ARCHITECTURE §9, "Home"; design spec §4): the
   * session `suggestNextSession` (`$lib/home/next-session.ts`) picked, with the
   * factual reason for it — never more than GAIN actually knows.
   */
  let {
    planSlug,
    planName,
    suggestedKey,
    lastSession,
    sessions,
  }: {
    planSlug: string;
    planName: string;
    suggestedKey: string;
    lastSession: { key: string; startedAtDate: string } | undefined;
    sessions: readonly { key: string; name: string }[];
  } = $props();

  const suggestedName = $derived(
    sessions.find((s) => s.key === suggestedKey)?.name ?? suggestedKey,
  );
</script>

<section class="card next-session">
  <p class="plan-name">{planName}</p>
  <h2><span class="key">{suggestedKey}</span>{suggestedName}</h2>
  <p class="reason">
    {#if lastSession}
      Last session: {lastSession.key}, {lastSession.startedAtDate}
    {:else}
      First session on this plan.
    {/if}
  </p>
  <a class="start-link" href={`/plan/${planSlug}/session/${suggestedKey}`}>
    <IconPlay />Start {suggestedKey}
  </a>
</section>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1.25rem;
    margin-top: 1.25rem;
  }
  .plan-name {
    margin: 0 0 0.15rem;
    font-size: 0.8rem;
    color: var(--muted);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  h2 {
    margin: 0 0 0.35rem;
    font-size: 1.3rem;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.8rem;
    padding: 0.1rem 0.4rem;
    border-radius: var(--r-xs);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 1rem;
    font-weight: 800;
  }
  .reason {
    margin: 0 0 0.9rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .start-link {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.8rem 1.25rem;
    border-radius: var(--r-sm);
    background: var(--accent);
    color: var(--accent-in);
    font-weight: 700;
  }
  .start-link:hover {
    text-decoration: none;
  }
</style>
