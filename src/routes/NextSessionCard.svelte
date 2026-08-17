<script lang="ts">
  import IconPlay from "~icons/lucide/play";
  import SessionOverrideList from "./SessionOverrideList.svelte";

  /**
   * The Home screen's primary card (ARCHITECTURE §9, "Home"; design spec §4): the
   * session `suggestNextSession` (`$lib/home/next-session.ts`) picked, with the
   * factual reason for it — never more than GAIN actually knows — plus the "choose a
   * different session" picker folded in underneath (todo.md, "Home page UI tweaks")
   * rather than left as its own separate card.
   */
  let {
    planSlug,
    planName,
    suggestedKey,
    lastSession,
    sessions,
    schedulingRules,
    dropOrder,
  }: {
    planSlug: string;
    planName: string;
    suggestedKey: string;
    lastSession: { key: string; startedAtDate: string } | undefined;
    sessions: readonly {
      key: string;
      name: string;
      note: string | undefined;
      lastDoneDate: string | undefined;
      blocks: readonly { key: string; name: string; exercises: readonly string[] }[];
    }[];
    schedulingRules: readonly string[] | undefined;
    dropOrder: readonly string[] | undefined;
  } = $props();

  const suggestedName = $derived(
    sessions.find((s) => s.key === suggestedKey)?.name ?? suggestedKey,
  );
</script>

<section class="card next-session">
  <h2 class="plan-name">{planName}</h2>
  <p class="last">
    {#if lastSession}
      Last session: {lastSession.key}, {lastSession.startedAtDate}
    {:else}
      First session on this plan.
    {/if}
  </p>
  <p class="suggested"><span class="suggested-key">{suggestedKey}</span>{suggestedName}</p>
  <a class="start-link" href={`/plan/${planSlug}/session/${suggestedKey}`}>
    <IconPlay />Start {suggestedKey}
  </a>

  <SessionOverrideList {planSlug} {suggestedKey} {sessions} {schedulingRules} {dropOrder} />
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
    margin: 0 0 0.2rem;
    font-size: 1.3rem;
    font-weight: 800;
  }
  .last {
    margin: 0 0 0.9rem;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .suggested {
    margin: 0 0 0.9rem;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 1rem;
    font-weight: 700;
  }
  .suggested-key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.8rem;
    padding: 0.1rem 0.4rem;
    border-radius: var(--r-xs);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 0.9rem;
    font-weight: 800;
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
