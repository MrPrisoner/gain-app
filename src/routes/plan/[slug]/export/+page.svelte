<script lang="ts">
  import { untrack } from "svelte";
  import { enhance } from "$app/forms";
  import { copyText, downloadText } from "$lib/copy";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // A one-shot seed from `data` at mount, the same pattern the home screen documents
  // with `untrack()`: the default window is read once, not kept in sync with `data` on
  // every reactive pass, so a user's in-progress radio selection is never clobbered.
  let selected = $state(untrack(() => data.options[0]?.id ?? "full"));
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined = $state(undefined);

  async function copyBundle() {
    if (!form?.bundle) return;
    if (await copyText(form.bundle)) {
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 2000);
    } else {
      downloadText(form.filename, form.bundle);
    }
  }

  function download() {
    if (form?.bundle) downloadText(form.filename, form.bundle);
  }
</script>

<svelte:head>
  <title>Export — {data.planName}</title>
</svelte:head>

{#snippet sparkleIcon()}
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linejoin="round"
    />
  </svg>
{/snippet}

{#snippet copyIcon()}
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <rect
      x="9"
      y="9"
      width="11"
      height="11"
      rx="2"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    />
    <path
      d="M5 15V5a2 2 0 0 1 2-2h10"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
{/snippet}

{#snippet checkIcon()}
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="M20 6 9 17l-5-5"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
{/snippet}

{#snippet downloadIcon()}
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
{/snippet}

<section class="card">
  <h1>Export for review</h1>
  <p class="muted">
    One document for your AI chat: the plan as it stands, what you have logged, and the rules for
    handing a revision back. Paste the whole thing.
  </p>

  <!--
    A plain custom callback, `reset: false` only: the default `use:enhance` behaviour
    calls `form.reset()` on a successful submission, which sets every radio's DOM
    `checked` property directly and bypasses Svelte's reactivity — the bound `selected`
    value stays "since_version" internally, but the visible radio reverts to
    unchecked, right as the user is looking at the bundle it produced. `reset: false`
    is the documented escape from that, not a workaround for anything else.
  -->
  <form
    method="POST"
    action="?/generate"
    use:enhance={() => {
      return async ({ update }) => {
        await update({ reset: false });
      };
    }}
  >
    <fieldset>
      <legend>How much history to include</legend>
      {#each data.options as option (option.id)}
        <label class="window">
          <input type="radio" name="window" value={option.id} bind:group={selected} />
          <span class="window-label">{option.label}</span>
          <span class="window-count">
            {option.workouts}
            {option.workouts === 1 ? "workout" : "workouts"}
          </span>
        </label>
      {/each}
    </fieldset>

    {#if data.totalWorkouts === 0}
      <p class="note">
        Nothing is logged yet, so this exports the plan and an empty summary. That is a fine way to
        ask for a revision, just not a progress review.
      </p>
    {/if}

    <div class="actions">
      <button type="submit" class="primary">{@render sparkleIcon()}Generate the export</button>
    </div>
  </form>

  {#if form?.actionError}
    <p class="action-error">{form.actionError}</p>
  {/if}
</section>

{#if form?.bundle}
  <section class="card">
    <h2>Paste this into your AI chat</h2>
    <p class="muted">
      {form.windowLabel} · {form.bundle.length.toLocaleString()} characters. Copy the whole thing; download
      is the fallback.
    </p>
    <textarea class="doc" readonly rows="14" value={form.bundle}></textarea>
    <div class="actions">
      <button type="button" class="primary" onclick={copyBundle}>
        {@render (copied ? checkIcon : copyIcon)()}
        {copied ? "Copied" : "Copy export"}
      </button>
      <button type="button" class="secondary" onclick={download}>
        {@render downloadIcon()}Download .md
      </button>
    </div>
  </section>
{/if}

<p class="back"><a href="/">Back to your plans</a></p>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1.25rem;
    margin-top: 1.25rem;
  }

  h1 {
    margin: 0 0 0.5rem;
    font-size: 1.3rem;
  }

  .card h2 {
    margin: 0 0 0.5rem;
    font-size: 1.05rem;
  }

  .muted {
    color: var(--muted);
    font-size: 0.9rem;
    margin: 0 0 0.75rem;
  }

  fieldset {
    border: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
    min-width: 0;
  }

  legend {
    padding: 0;
    color: var(--muted);
    font-size: 0.9rem;
    margin-bottom: 0.5rem;
  }

  .window {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.7rem 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--raised);
    min-width: 0;
  }

  .window-label {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .window-count {
    flex: 0 0 auto;
    color: var(--muted);
    font-size: 0.85rem;
  }

  .note {
    margin: 0.75rem 0 0;
    color: var(--muted);
    font-size: 0.9rem;
  }

  /* Next to the control that failed, legible at arm's length — never in var(--red),
     which belongs to the plan's symptom framework (UI-DECISIONS §5). */
  .action-error {
    margin: 0.75rem 0 0;
    padding: 0.7rem 0.75rem;
    border: 1px solid var(--amber);
    border-radius: var(--r-sm);
    font-weight: 700;
  }

  .doc {
    width: 100%;
    padding: 0.75rem;
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    line-height: 1.45;
    resize: vertical;
  }

  .actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.75rem;
    flex-wrap: wrap;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    border: none;
    border-radius: var(--r-sm);
    padding: 0.7rem 1.25rem;
    font-weight: 700;
  }

  button.primary {
    background: var(--accent);
    color: var(--accent-in);
  }

  button.secondary {
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
  }

  .back {
    margin: 1.25rem 0 0;
    font-size: 0.9rem;
  }
</style>
