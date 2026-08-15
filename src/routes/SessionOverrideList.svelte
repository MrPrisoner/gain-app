<script lang="ts">
  import IconChevronDown from "~icons/lucide/chevron-down";
  import IconPlay from "~icons/lucide/play";

  /**
   * The Home screen's secondary picker (design spec §4): every declared session,
   * collapsed behind one toggle, each further expandable to the block detail the plan
   * overview used to show above the fold. `scheduling.rules`/`drop_order` render
   * verbatim underneath as the plan's own words, never automated (design spec §2,
   * decision 7).
   */
  let {
    planSlug,
    suggestedKey,
    sessions,
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
    schedulingRules: readonly string[] | undefined;
    dropOrder: readonly string[] | undefined;
  } = $props();

  let listOpen = $state(false);
  let openSession = $state<string | null>(null);

  function toggleSession(key: string): void {
    openSession = openSession === key ? null : key;
  }
</script>

<section class="card override">
  <button
    type="button"
    class="secondary list-toggle"
    aria-expanded={listOpen}
    onclick={() => (listOpen = !listOpen)}
  >
    <span>Choose a different session</span>
    <IconChevronDown class="chevron {listOpen ? 'open' : ''}" />
  </button>

  {#if listOpen}
    <ul class="sessions">
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
            <span class="session-name">
              <span class="key">{session.key}</span>
              {session.name}
              {#if session.key === suggestedKey}<span class="badge">suggested</span>{/if}
            </span>
            {#if session.lastDoneDate}<span class="last">last {session.lastDoneDate}</span>{/if}
            <IconChevronDown class="chevron {isOpen ? 'open' : ''}" />
          </button>
          {#if isOpen}
            <div class="session-summary" id={`override-summary-${planSlug}-${session.key}`}>
              {#if session.note}
                <p class="muted">{session.note}</p>
              {/if}
              {#each session.blocks as block (block.key)}
                <div class="block-summary">
                  <h3>{block.name}</h3>
                  <p>{block.exercises.join(", ")}</p>
                </div>
              {/each}
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
</section>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1.25rem;
    margin-top: 1.25rem;
  }
  .list-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
    border-radius: var(--r-sm);
    padding: 0.7rem 1.25rem;
    font-weight: 700;
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
    gap: 0.35rem;
  }
  .sessions .key {
    display: inline-block;
    min-width: 1.6em;
    font-weight: 800;
  }
  .session-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
    border-radius: var(--r-sm);
    padding: 0.7rem 1.25rem;
  }
  .session-name {
    flex: 1;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .badge {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--accent);
    background: var(--accent-soft);
    border-radius: var(--r-xs);
    padding: 0.1rem 0.35rem;
  }
  .last {
    font-size: 0.8rem;
    color: var(--muted);
    white-space: nowrap;
  }
  .session-toggle :global(.chevron) {
    flex-shrink: 0;
    transition: transform 0.15s ease;
  }
  .session-toggle :global(.chevron.open) {
    transform: rotate(180deg);
  }
  .session-summary {
    padding: 0.85rem 1rem 0.25rem;
    display: grid;
    gap: 0.6rem;
  }
  .block-summary h3 {
    margin: 0 0 0.15rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .block-summary p {
    margin: 0;
    font-size: 0.9rem;
  }
  .session-link {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.7rem 1.25rem;
    border-radius: var(--r-sm);
    background: var(--accent);
    color: var(--accent-in);
    font-weight: 700;
  }
  .session-link:hover {
    text-decoration: none;
  }
  .muted {
    color: var(--muted);
    font-size: 0.9rem;
    margin: 0 0 0.5rem;
  }
  .rule {
    margin: 0.5rem 0 0;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .rules-label {
    margin-top: 0.75rem;
  }
  .rules {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.85rem;
    color: var(--muted);
    display: grid;
    gap: 0.3rem;
  }
</style>
