<script lang="ts">
  import IconPlay from "~icons/lucide/play";
  import IconTrash2 from "~icons/lucide/trash-2";
  import Button from "$lib/components/Button.svelte";
  import { lastDoneLabel } from "$lib/home/last-done";
  import type { UnfinishedSession } from "$lib/home/unfinished";

  /**
   * One unfinished session, on Home.
   *
   * `promoted` — set by the parent, never derived from `session.resumable` in here — is
   * what chooses the shape. The parent promotes at most one open workout per plan (the
   * most recently started one still inside the resume window, via
   * `partitionUnfinished`): that one replaces `NextSessionCard` entirely, carries the
   * plan name and the override picker ("I abandoned A this morning, I will do B tonight"
   * must not be a dead end), and gets a Resume link. Every other open workout for the
   * plan renders as a slim notice here — no plan name, no picker, no Resume link — even
   * when it is itself still individually resumable: a plan can have two workouts open at
   * once for two different session keys, and only one of them is ever the primary card —
   * every other open workout renders as an aged-out notice above it. Outside the window
   * Resume is gone for the same reason regardless of promotion: appending today's sets to
   * a days-old workout puts a multi-day duration in the export
   * (`$lib/session/workout-age.ts`) — but promotion already implies resumability, since
   * the parent only ever promotes a resumable one.
   *
   * `--amber` rather than the accent: this is outside the session runner, where UI §5's
   * accent-only rule does not apply and amber carries its ordinary "warning" sense.
   * Muted, not an alarm. `--red` belongs on the confirmation, not here.
   */
  let {
    session,
    promoted,
    planName,
    todayDate,
    onDiscard,
    picker,
  }: {
    session: UnfinishedSession;
    promoted: boolean;
    planName: string | undefined;
    todayDate: string;
    onDiscard: () => void;
    picker?: import("svelte").Snippet;
  } = $props();

  const setLabel = $derived(
    session.setCount === undefined
      ? "not yet synced"
      : `${session.setCount} ${session.setCount === 1 ? "set" : "sets"} logged`,
  );
</script>

{#snippet discardIcon()}<IconTrash2 />{/snippet}

<section class="card unfinished" class:slim={!promoted}>
  {#if promoted && planName}
    <h2 class="plan-name">{planName}</h2>
  {/if}

  <div class="status-row">
    <span class="suggested-key">{session.sessionKey}</span>
    <span class="status-label">{promoted ? "in progress" : "left unfinished"}</span>
  </div>

  <p class="last">
    {setLabel} · {lastDoneLabel(session.startedAt.slice(0, 10), todayDate)}
  </p>

  {#if promoted}
    <a
      class="start-link"
      href={`/plan/${session.planSlug}/session/${session.sessionKey}?resume=${session.workoutClientId}`}
    >
      <IconPlay />Resume {session.sessionKey}
    </a>
  {/if}

  <Button variant="quiet" onclick={onDiscard} icon={discardIcon}>Discard</Button>

  {#if promoted}
    {@render picker?.()}
  {/if}
</section>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: var(--pad-card);
    margin-top: 1.25rem;
  }
  /* Outside the resume window there is no picker, no plan name and no Resume link — the
     card is one status row, one line of detail and a Discard button, so it does not need
     the full card's breathing room. */
  .card.slim {
    padding: var(--s-4) var(--pad-card);
  }
  .plan-name {
    margin: 0 0 0.2rem;
    font-size: var(--t-lg);
    font-weight: var(--w-display);
  }
  .status-row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin-bottom: 0.4rem;
  }
  .status-label {
    font-size: var(--t-sm);
    font-weight: var(--w-semi);
    color: var(--amber);
  }
  .last {
    margin: 0 0 0.9rem;
    color: var(--muted);
    font-size: var(--t-sm);
  }
  .slim .last {
    margin-bottom: 0.75rem;
  }
  .suggested-key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.8rem;
    padding: var(--s-1) var(--s-2);
    border-radius: var(--r-xs);
    background: var(--amber-soft);
    color: var(--amber);
    font-size: var(--t-sm);
    font-weight: var(--w-display);
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
    margin-bottom: 0.75rem;
  }
  .start-link:hover {
    text-decoration: none;
  }
</style>
