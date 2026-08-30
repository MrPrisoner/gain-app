<script lang="ts">
  import { untrack } from "svelte";
  import { enhance } from "$app/forms";
  import { copyText, downloadText } from "$lib/copy";
  import { blockingReport } from "$lib/import/blocking-report";
  import { refreshCounts, syncStatus } from "$lib/sync/client.svelte";
  import IconCheck from "~icons/lucide/check";
  import IconCircleCheck from "~icons/lucide/circle-check";
  import IconCopy from "~icons/lucide/copy";
  import IconTriangleAlert from "~icons/lucide/triangle-alert";
  import DiffGroups from "./DiffGroups.svelte";
  import DispositionList from "./DispositionList.svelte";
  import ImportPlanForm from "./ImportPlanForm.svelte";
  import type { ActionData } from "./$types";

  let { form }: { form: ActionData } = $props();

  // Seeds the no-JS path only: there, the action re-renders the page, and the server's
  // echo of `source` is what puts the pasted document back in the box. Once mounted,
  // `pasted` is the live value (bound into ImportPlanForm) and must never be clobbered by
  // a later `form` update — that would blow away what the user just typed.
  let pasted = $state(untrack(() => form?.source ?? ""));

  // `syncStatus.pending` is only kept current by `logWrite`, `discardQuarantined` and
  // the flush loop — none of which this route ever calls, since there is no plan slug
  // here to pass `startSyncLoop`. Without this, the outbox note below reads whatever
  // the module's `$state` happened to hold (zero on a hard load; stale on an SPA
  // navigation from Home) rather than the actual current count.
  $effect(() => {
    void refreshCounts();
  });

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

  // A departed slug's disposition choice: `"rename:<slug>"` or `"removed"`. Starts empty;
  // `DispositionList` seeds each row's suggestion in once, on its own mount — see the
  // comment there for why that has to happen in the child rather than up here.
  let choices: Record<string, string> = $state({});

  // Every departed slug needs an explicit answer and nothing may be blocking — an
  // untouched row is never implicit acceptance. `choices[d.slug] ?? ""` covers
  // a disposition the seeding above never touched (no suggestion, nothing chosen yet).
  let ready = $derived(
    form?.revision !== undefined &&
      form.revision.blocking.length === 0 &&
      form.revision.dispositions.every((d) => (choices[d.slug] ?? "") !== ""),
  );

  // A rename quarantines any already-queued op that still names the old slug.
  // Only the user can tell whether those particular queued entries matter, so this is a
  // note, never a block on commit.
  let hasRename = $derived(Object.values(choices).some((choice) => choice.startsWith("rename:")));
  let outboxNote = $derived(syncStatus.pending > 0 && hasRename);

  let copiedBlocking = $state(false);
  let copyBlockingTimer: ReturnType<typeof setTimeout> | undefined = $state(undefined);

  function flashCopiedBlocking() {
    copiedBlocking = true;
    clearTimeout(copyBlockingTimer);
    copyBlockingTimer = setTimeout(() => (copiedBlocking = false), 2000);
  }

  async function copyBlocking() {
    if (!form?.revision) return;
    const report = blockingReport(form.revision);
    if (await copyText(report)) {
      flashCopiedBlocking();
    } else {
      downloadText("gain-import-blocking.md", report);
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
  <section class="card">
    <h2>Review the revision</h2>
    <p class="muted">
      Version {form.revision.fromVersion} → {form.revision.toVersion} of {form.revision.planSlug}.
      Nothing is written until you commit.
    </p>

    {#if form.revision.blocking.length > 0}
      <div class="blocking">
        <p class="section-label"><IconTriangleAlert />This revision cannot be imported yet</p>
        <ul>
          {#each form.revision.blocking as problem (problem)}
            <li>{problem}</li>
          {/each}
        </ul>
        <div class="actions">
          <button type="button" class="secondary" onclick={copyBlocking}>
            {#if copiedBlocking}<IconCheck />{:else}<IconCopy />{/if}
            {copiedBlocking ? "Copied" : "Copy for the AI"}
          </button>
        </div>
      </div>
    {/if}

    <form method="POST" action="?/commit" use:enhance>
      <input type="hidden" name="source_md" value={form?.source ?? ""} />

      {#if form.revision.dispositions.length > 0}
        <div class="block">
          <p class="section-label">What happened to these exercises?</p>
          <DispositionList dispositions={form.revision.dispositions} bind:choices />
        </div>
      {/if}

      {#if form.revision.changelog.length > 0}
        <div class="block">
          <p class="section-label">What the AI says changed</p>
          <ul>
            {#each form.revision.changelog as line, i (i)}
              <li>{line}</li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if form.revision.groups.length > 0}
        <div class="block">
          <p class="section-label">Everything that changed</p>
          <DiffGroups groups={form.revision.groups} />
        </div>
      {/if}

      {#if form.revision.warnings.length > 0}
        <div class="block warnings">
          <p class="section-label"><IconTriangleAlert />Worth a look</p>
          <ul>
            {#each form.revision.warnings as warning, i (i)}
              <li>{warning}</li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if outboxNote}
        <p class="outbox-note">
          {syncStatus.pending}
          {syncStatus.pending === 1 ? "entry is" : "entries are"} still waiting to sync. A rename can
          leave one naming the old exercise — check the sync banner once this commits, and discard it
          there if it no longer applies.
        </p>
      {/if}

      <div class="actions">
        <button type="submit" class="primary" disabled={!ready}>
          <IconCircleCheck />Commit revision
        </button>
      </div>
    </form>
  </section>
{/if}

<style>
  h1 {
    margin: 1.25rem 0 0;
    font-size: var(--t-lg);
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: var(--pad-card);
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

  .actions {
    display: flex;
    gap: var(--s-3);
    margin-top: 0.75rem;
    flex-wrap: wrap;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    border: none;
    border-radius: var(--r-sm);
    padding: var(--s-3) var(--s-5);
    font-weight: var(--w-bold);
  }

  button.primary {
    background: var(--accent);
    color: var(--accent-in);
  }

  button.primary:disabled {
    opacity: 0.45;
    cursor: default;
  }

  button.secondary {
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
  }

  .report-card {
    border-color: var(--amber);
  }

  .report {
    font-family: inherit;
    font-size: var(--t-sm);
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: var(--r-xs);
    padding: var(--s-3);
    margin: 0;
    max-height: 24rem;
    overflow: auto;
  }

  /* Every section of the review is its own block, in a fixed order: blocking
     problems, dispositions, the AI's changelog, the change groups, then warnings. */
  .block {
    margin-top: 1.25rem;
  }

  .section-label {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin: 0 0 0.5rem;
    font-weight: var(--w-bold);
    font-size: var(--t-base);
  }

  /* `--red` here is ordinary error colour, not the runner's symptom triad — this screen
     is outside the session runner (CLAUDE.md, "Correct CLAUDE.md's colour rule"). */
  .blocking {
    margin-top: 1rem;
    padding: var(--s-4);
    border-radius: var(--r-sm);
    border: 1px solid var(--red);
    background: color-mix(in srgb, var(--red) 10%, transparent);
  }

  .blocking .section-label {
    color: var(--red);
  }

  .block ul,
  .blocking ul {
    margin: 0;
    padding: 0 0 0 var(--s-4);
    display: grid;
    gap: var(--s-2);
    font-size: var(--t-sm);
  }

  .warnings .section-label {
    color: var(--amber);
  }

  .outbox-note {
    margin: 1.25rem 0 0;
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-sm);
    background: var(--amber-soft);
    color: var(--text);
    font-size: var(--t-sm);
  }
</style>
