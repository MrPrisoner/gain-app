<script lang="ts">
  import { untrack } from "svelte";
  import { enhance } from "$app/forms";
  import { copyText, downloadText } from "$lib/copy";
  import BackLink from "$lib/components/BackLink.svelte";
  import ArchivedNote from "$lib/components/ArchivedNote.svelte";
  import Button from "$lib/components/Button.svelte";
  import Card from "$lib/components/Card.svelte";
  import Field from "$lib/components/Field.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import IconCheck from "~icons/lucide/check";
  import IconCopy from "~icons/lucide/copy";
  import IconDownload from "~icons/lucide/download";
  import IconSparkles from "~icons/lucide/sparkles";
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

{#if data.planArchived}
  <ArchivedNote />
{/if}

<div class="card">
  <Card>
    <PageHeader title="Export for review" />
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
      <Field label="How much history to include" id="export-window" asGroup>
        <fieldset>
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
      </Field>

      {#if data.totalWorkouts === 0}
        <p class="note">
          Nothing is logged yet, so this exports the plan and an empty summary. That is a fine way
          to ask for a revision, just not a progress review.
        </p>
      {/if}

      <div class="actions">
        {#snippet sparklesIcon()}<IconSparkles />{/snippet}
        <Button variant="primary" type="submit" icon={sparklesIcon}>Generate the export</Button>
      </div>
    </form>

    {#if form?.actionError}
      <p class="action-error">{form.actionError}</p>
    {/if}
  </Card>
</div>

{#if form?.bundle}
  <div class="card">
    <Card>
      <h2>Paste this into your AI chat</h2>
      <p class="muted">
        {form.windowLabel} · {form.bundle.length.toLocaleString()} characters. Copy the whole thing; download
        is the fallback.
      </p>
      <textarea class="doc" readonly rows="14" aria-label="Export bundle" value={form.bundle}
      ></textarea>
      <div class="actions">
        {#snippet copyIcon()}
          {#if copied}<IconCheck />{:else}<IconCopy />{/if}
        {/snippet}
        <Button variant="primary" type="button" onclick={copyBundle} icon={copyIcon}>
          {copied ? "Copied" : "Copy export"}
        </Button>
        {#snippet downloadIcon()}<IconDownload />{/snippet}
        <Button variant="secondary" type="button" onclick={download} icon={downloadIcon}>
          Download .md
        </Button>
      </div>
    </Card>
  </div>
{/if}

<BackLink href="/" label="Back to your plans" />

<style>
  .card {
    margin-top: 1.25rem;
  }

  .card h2 {
    margin: 0 0 0.5rem;
    font-size: var(--t-base);
  }

  .muted {
    color: var(--muted);
    font-size: var(--t-sm);
    margin: 0 0 0.75rem;
  }

  fieldset {
    border: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--s-2);
    min-width: 0;
  }

  .window {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--raised);
    min-width: 0;
  }

  /* A native radio's own box is what `e2e/touch-targets.spec.ts` measures, not the label
     that wraps it — sized to the same 44px floor `Button` holds for its own controls. */
  .window input[type="radio"] {
    flex: 0 0 auto;
    min-width: 2.75rem;
    min-height: 2.75rem;
    accent-color: var(--accent);
  }

  .window-label {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: var(--w-bold);
    overflow-wrap: anywhere;
  }

  .window-count {
    flex: 0 0 auto;
    color: var(--muted);
    font-size: var(--t-sm);
  }

  .note {
    margin: 0.75rem 0 0;
    color: var(--muted);
    font-size: var(--t-sm);
  }

  /* Next to the control that failed, legible at arm's length — never in var(--red),
     which belongs to the plan's symptom framework (UI §5). */
  .action-error {
    margin: 0.75rem 0 0;
    padding: var(--s-3);
    border: 1px solid var(--amber);
    border-radius: var(--r-sm);
    font-weight: var(--w-bold);
  }

  .doc {
    width: 100%;
    padding: var(--s-3);
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
    font-size: var(--t-sm);
    line-height: 1.45;
    resize: vertical;
  }

  .actions {
    display: flex;
    gap: var(--s-3);
    margin-top: 0.75rem;
    flex-wrap: wrap;
  }
</style>
