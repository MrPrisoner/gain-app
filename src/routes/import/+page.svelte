<script lang="ts">
  import { untrack } from "svelte";
  import { enhance } from "$app/forms";
  import { copyText, downloadText } from "$lib/copy";
  import IconCheck from "~icons/lucide/check";
  import IconCircleCheck from "~icons/lucide/circle-check";
  import IconCopy from "~icons/lucide/copy";
  import ImportPlanForm from "./ImportPlanForm.svelte";
  import type { ActionData } from "./$types";

  let { form }: { form: ActionData } = $props();

  // Seeds the no-JS path only: there, the action re-renders the page, and the server's
  // echo of `source` is what puts the pasted document back in the box. Once mounted,
  // `pasted` is the live value (bound into ImportPlanForm) and must never be clobbered by
  // a later `form` update — that would blow away what the user just typed.
  let pasted = $state(untrack(() => form?.source ?? ""));

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined = $state(undefined);

  function flashCopied() {
    copied = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = false), 2000);
  }

  async function copyReport() {
    if (!form?.importFailure) return;
    if (await copyText(form.importFailure.report)) {
      flashCopied();
    } else {
      downloadText("gain-import-report.md", form.importFailure.report);
    }
  }
</script>

<svelte:head>
  <title>Import a plan — GAIN</title>
</svelte:head>

<h1>Import a plan</h1>

<section class="card">
  <p class="muted">
    The whole document — prose and contract block. GAIN checks it before writing anything.
  </p>
  <ImportPlanForm bind:pasted />
</section>

{#if form?.importError}
  <section class="card report-card">
    <h2>Nothing was imported</h2>
    <p>{form.importError}</p>
  </section>
{/if}

{#if form?.importFailure}
  {#if form.importFailure.kind === "export_bundle"}
    <!--
      A pasted bundle is a wrong-document error, not a parse failure
      (UI-DECISIONS §11). The fix belongs to the user, not to the AI, so this
      case gets no field paths and no copy-for-the-AI action — sending a
      bundle back to the chat would only confuse it.
    -->
    <section class="card report-card">
      <h2>That is a GAIN export, not a plan</h2>
      <p>
        Export bundles are what GAIN hands <em>to</em> an AI. Paste what your AI gave you back: the
        prose plus one <code>gain-plan</code> block.
      </p>
    </section>
  {:else}
    <section class="card report-card">
      <h2>Nothing was imported</h2>
      <p class="muted">
        This report is written for your AI, not for you — copy it back into the chat and the AI will
        fix the plan and hand you a new document.
      </p>
      <pre class="report">{form.importFailure.report}</pre>
      <div class="actions">
        <button type="button" class="primary" onclick={copyReport}>
          {#if copied}<IconCheck />{:else}<IconCopy />{/if}
          {copied ? "Copied" : "Copy report for the AI"}
        </button>
      </div>
    </section>
  {/if}
{/if}

{#if form?.firstImport}
  <section class="card">
    <h2>Ready to import</h2>
    <p>
      <strong>{form.firstImport.plan_name}</strong> — version {form.firstImport.version_no}:
      {form.firstImport.counts.sessions} sessions, {form.firstImport.counts.exercises} exercises,
      {form.firstImport.counts.prescriptions} prescriptions.
    </p>
    <form method="POST" action="?/commit" use:enhance>
      <input type="hidden" name="source_md" value={form?.source ?? ""} />
      <div class="actions">
        <button type="submit" class="primary"><IconCircleCheck />Commit import</button>
      </div>
    </form>
  </section>
{/if}

{#if form?.revision}
  <!-- Task 7 replaces this with the dispositions list and change groups. -->
  <section class="card">
    <h2>Ready to import a revision</h2>
    <p>The detailed diff review arrives next; this placeholder stands in until it does.</p>
  </section>
{/if}

<style>
  h1 {
    margin: 1.25rem 0 0;
    font-size: 1.3rem;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1.25rem;
    margin-top: 1.25rem;
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

  .report-card {
    border-color: var(--amber);
  }

  .report {
    font-family: inherit;
    font-size: 0.85rem;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: var(--r-xs);
    padding: 0.75rem;
    margin: 0;
    max-height: 24rem;
    overflow: auto;
  }
</style>
