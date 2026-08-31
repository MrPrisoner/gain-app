<script lang="ts">
  import IconChevronDown from "~icons/lucide/chevron-down";
  import IconPlay from "~icons/lucide/play";
  import SessionSummary from "./SessionSummary.svelte";
  import { lastDoneLabel } from "$lib/home/last-done";

  /**
   * The Home screen's secondary picker: every declared session, collapsed behind one
   * toggle, each further expandable to the block detail the plan overview used to show
   * above the fold. `scheduling.rules`/`drop_order` render verbatim underneath as the
   * plan's own words, never automated — GAIN acts automatically on
   * `scheduling.sequence` alone. Nested inside `NextSessionCard`'s `.next-session` card
   * rather than a card of its own, so it renders no background or border of its own —
   * only a divider to separate it from the start button above.
   */
  let {
    planSlug,
    suggestedKey,
    sessions,
    todayDate,
    schedulingRules,
    dropOrder,
  }: {
    planSlug: string;
    suggestedKey: string;
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

  let listOpen = $state(false);
  let openSession = $state<string | null>(null);

  function toggleSession(key: string): void {
    openSession = openSession === key ? null : key;
  }
</script>

<div class="override">
  <button
    type="button"
    class="secondary list-toggle"
    aria-expanded={listOpen}
    aria-controls={listOpen ? `override-sessions-${planSlug}` : undefined}
    onclick={() => (listOpen = !listOpen)}
  >
    <span>Choose a different session</span>
    <IconChevronDown class="chevron {listOpen ? 'open' : ''}" />
  </button>

  {#if listOpen}
    <ul class="sessions" id={`override-sessions-${planSlug}`}>
      {#each sessions as session (session.key)}
        {@const isOpen = openSession === session.key}
        <li>
          <button
            type="button"
            class="secondary session-toggle"
            aria-expanded={isOpen}
            aria-controls={`override-summary-${planSlug}-${session.key}`}
            onclick={() => toggleSession(session.key)}
          >
            <span class="key">{session.key}</span>
            <span class="session-name">
              {session.name}
              {#if session.key === suggestedKey}<span class="badge">suggested</span>{/if}
            </span>
            <IconChevronDown class="chevron {isOpen ? 'open' : ''}" />
            <span class="last">{lastDoneLabel(session.lastDoneDate, todayDate)}</span>
          </button>
          {#if isOpen}
            <div class="session-detail">
              <SessionSummary
                id={`override-summary-${planSlug}-${session.key}`}
                note={session.note}
                blocks={session.blocks}
              />
              <a class="session-link" href={`/plan/${planSlug}/session/${session.key}`}>
                <IconPlay />Start session
              </a>
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    {#if dropOrder && dropOrder.length > 0}
      <p class="rule">If a session has to be dropped, in this order: {dropOrder.join(", ")}.</p>
    {/if}
    {#if schedulingRules && schedulingRules.length > 0}
      <p class="muted rules-label">The plan's own scheduling notes:</p>
      <ul class="rules">
        {#each schedulingRules as rule (rule)}<li>{rule}</li>{/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .override {
    margin-top: 1rem;
    padding-top: var(--s-4);
    border-top: 1px solid var(--line-soft);
  }
  .list-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--raised);
    border: 1px solid var(--line-strong);
    color: var(--text);
    border-radius: var(--r-sm);
    padding: var(--s-3) var(--s-5);
    font-weight: var(--w-bold);
  }
  .list-toggle :global(.chevron) {
    flex-shrink: 0;
    transition: transform 0.15s ease;
  }
  .list-toggle :global(.chevron.open) {
    transform: rotate(180deg);
  }
  .sessions {
    list-style: none;
    margin: 0.9rem 0 0.75rem;
    padding: 0;
    display: grid;
    gap: var(--s-2);
  }
  .sessions .key {
    font-weight: var(--w-display);
    line-height: 1.2;
  }
  /**
   * Two rows, not one. As a single flex row the name shared its line with the last-done
   * text, which is `white-space: nowrap`, so at 320px the name lost the space it needed
   * and wrapped underneath the key badge — the key on one line and "Squat, Press & Row"
   * on the next. Giving the meta its own row hands the name the full width, which is
   * what actually stops the wrap; shortening the date alone only moved the break.
   */
  .session-toggle {
    width: 100%;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    column-gap: var(--s-2);
    row-gap: var(--s-1);
    text-align: left;
    background: var(--raised);
    border: 1px solid var(--line-strong);
    color: var(--text);
    border-radius: var(--r-sm);
    padding: var(--s-3) var(--s-5);
  }
  .session-name {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex-wrap: wrap;
    line-height: 1.2;
  }
  .badge {
    font-size: var(--t-2xs);
    font-weight: var(--w-bold);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--accent);
    background: var(--accent-soft);
    border-radius: var(--r-xs);
    padding: var(--s-1) var(--s-2);
  }
  /* Row 2, under the name — column 2 so it lines up with it rather than with the key. */
  .last {
    grid-column: 2;
    font-size: var(--t-xs);
    color: var(--muted);
  }
  .session-toggle :global(.chevron) {
    flex-shrink: 0;
    transition: transform 0.15s ease;
  }
  .session-toggle :global(.chevron.open) {
    transform: rotate(180deg);
  }
  .session-detail {
    display: grid;
    gap: var(--s-3);
    padding-bottom: var(--s-1);
  }
  .session-link {
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
  .session-link:hover {
    text-decoration: none;
  }
  .muted {
    color: var(--muted);
    font-size: var(--t-sm);
    margin: 0 0 0.5rem;
  }
  .rule {
    margin: 0.5rem 0 0;
    font-size: var(--t-sm);
    color: var(--muted);
  }
  .rules-label {
    margin-top: 0.75rem;
  }
  .rules {
    margin: 0;
    padding-left: var(--s-4);
    font-size: var(--t-sm);
    color: var(--muted);
    display: grid;
    gap: var(--s-1);
  }
</style>
