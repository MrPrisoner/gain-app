<script lang="ts">
  import IconPlay from "~icons/lucide/play";
  import IconChevronDown from "~icons/lucide/chevron-down";
  import SessionOverrideList from "./SessionOverrideList.svelte";
  import SessionSummary from "./SessionSummary.svelte";
  import { lastDoneLabel } from "$lib/home/last-done";

  /**
   * The Home screen's primary card (ARCHITECTURE §9, "Home"): the
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
    padding: var(--pad-card);
    margin-top: 1.25rem;
  }
  .plan-name {
    margin: 0 0 0.2rem;
    font-size: var(--t-lg);
    font-weight: var(--w-display);
  }
  .last {
    margin: 0 0 0.9rem;
    color: var(--muted);
    font-size: var(--t-sm);
  }
  /* Shaped like the picker's own rows below it, so "this is tappable, and it opens" is
     one vocabulary on this card rather than two. */
  .suggested {
    width: 100%;
    margin: 0 0 0.9rem;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    background: var(--raised);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-sm);
    padding: var(--s-3) var(--s-5);
    color: var(--text);
    font-size: var(--t-base);
    font-weight: var(--w-bold);
    text-align: left;
  }
  .suggested-name {
    flex: 1;
  }
  .suggested :global(.chevron) {
    flex-shrink: 0;
    transition: transform var(--dur-base) var(--ease);
  }
  .suggested :global(.chevron.open) {
    transform: rotate(180deg);
  }
  .suggested-key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.8rem;
    padding: var(--s-1) var(--s-2);
    border-radius: var(--r-xs);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--t-sm);
    font-weight: var(--w-display);
  }
  .card :global(.session-summary) {
    margin: -0.4rem 0 0.9rem;
  }
  .start-link {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-5);
    border-radius: var(--r-sm);
    background: var(--accent);
    color: var(--accent-in);
    font-weight: var(--w-bold);
  }
  .start-link:hover {
    text-decoration: none;
  }
</style>
