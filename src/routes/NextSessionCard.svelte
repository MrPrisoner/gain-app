<script lang="ts">
  import IconPlay from "~icons/lucide/play";
  import IconChevronDown from "~icons/lucide/chevron-down";
  import SessionOverrideList from "./SessionOverrideList.svelte";
  import SessionSummary from "./SessionSummary.svelte";
  import { lastDoneLabel } from "$lib/home/last-done";

  /**
   * The Home screen's primary card (ARCHITECTURE §9, "Home"; design spec §4): the
   * session `suggestNextSession` (`$lib/home/next-session.ts`) picked, with the
   * factual reason for it — never more than GAIN actually knows — plus the "choose a
   * different session" picker folded in underneath rather than left as its own
   * separate card.
   */
  let {
    planSlug,
    planName,
    suggestedKey,
    lastSession,
    sessions,
    todayDate,
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
    todayDate: string;
    schedulingRules: readonly string[] | undefined;
    dropOrder: readonly string[] | undefined;
  } = $props();

  const suggested = $derived(sessions.find((s) => s.key === suggestedKey));
  const suggestedName = $derived(suggested?.name ?? suggestedKey);

  /**
   * Whether the suggested session's block detail is showing. Collapsed by default: this
   * card exists to make starting the next session one tap, and the fixture's four blocks
   * are enough to push "Start B" off a 320px screen. Expanding is a deliberate act by a
   * user who wants to know what they are in for, and it puts that answer one tap away
   * instead of three — before this, the only way to read it was to open "choose a
   * different session" and expand the session the card was already suggesting.
   */
  let detailOpen = $state(false);
</script>

<section class="card next-session">
  <h2 class="plan-name">{planName}</h2>
  <p class="last">
    {#if lastSession}
      Last session: {lastSession.key}, {lastDoneLabel(lastSession.startedAtDate, todayDate)}
    {:else}
      First session on this plan.
    {/if}
  </p>

  <button
    type="button"
    class="secondary suggested"
    aria-expanded={detailOpen}
    aria-controls={`suggested-summary-${planSlug}`}
    onclick={() => (detailOpen = !detailOpen)}
  >
    <span class="suggested-key">{suggestedKey}</span>
    <span class="suggested-name">{suggestedName}</span>
    <IconChevronDown class="chevron {detailOpen ? 'open' : ''}" />
  </button>

  {#if detailOpen && suggested}
    <SessionSummary
      id={`suggested-summary-${planSlug}`}
      note={suggested.note}
      blocks={suggested.blocks}
    />
  {/if}

  <a class="start-link" href={`/plan/${planSlug}/session/${suggestedKey}`}>
    <IconPlay />Start {suggestedKey}
  </a>

  <SessionOverrideList
    {planSlug}
    {suggestedKey}
    {sessions}
    {todayDate}
    {schedulingRules}
    {dropOrder}
  />
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
  /* Shaped like the picker's own rows below it, so "this is tappable, and it opens" is
     one vocabulary on this card rather than two. */
  .suggested {
    width: 100%;
    margin: 0 0 0.9rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: 0.7rem 1.25rem;
    color: var(--text);
    font-size: 1rem;
    font-weight: 700;
    text-align: left;
  }
  .suggested-name {
    flex: 1;
  }
  .suggested :global(.chevron) {
    flex-shrink: 0;
    transition: transform 0.15s ease;
  }
  .suggested :global(.chevron.open) {
    transform: rotate(180deg);
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
  .card :global(.session-summary) {
    margin: -0.4rem 0 0.9rem;
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
