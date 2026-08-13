<script lang="ts">
  import { untrack } from "svelte";
  import { enhance } from "$app/forms";
  import { copyText, downloadText } from "$lib/copy";
  import { precacheSessions } from "$lib/sync/precache";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // Ask the service worker to cache every plan's session routes while there is still a
  // network (design spec §7, Task 8) — what makes a session *startable* offline, not only
  // continuable. `data.plans` is `undefined` on the first-run view, so this is a harmless
  // no-op until a plan actually exists, and it deliberately reacts to `data.plans` rather
  // than running once: importing a new plan (or a revision that adds a session) must
  // precache it too, and `precacheSessions`/`cache.addAll` are idempotent, so re-running
  // on an unrelated reactive update costs nothing beyond a cheap re-fetch of what is
  // already cached.
  $effect(() => {
    for (const plan of data.plans ?? []) {
      void precacheSessions(
        plan.slug,
        plan.sessions.map((session) => session.key),
      );
    }
  });

  // Every form here is enhanced, which is what makes the local state work: the
  // component instance survives the action, so `bind:value` keeps the pasted
  // text in place across a failed import (UI-DECISIONS §11). Without
  // `use:enhance` the POST is a full navigation, the component remounts, and
  // the user is staring at an empty box holding the error for a document they
  // now have to paste again.
  //
  // The seed is the no-JS path, and is read once on purpose: there, the action
  // does re-render the page, and the server's echo of `source` is what puts
  // the document back in the box. Once mounted, `pasted` is the live value and
  // must never be clobbered by a later `form` update.
  let pasted = $state(untrack(() => form?.source ?? ""));
  let copied = $state<"prompt" | "report" | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined = $state(undefined);

  // Accordion: at most one session summary open at a time (keyed on
  // `plan.slug:session.key` so two plans sharing a session key, e.g. both
  // using "A", don't open in lockstep).
  let openSession = $state<string | null>(null);

  function toggleSession(id: string) {
    openSession = openSession === id ? null : id;
  }

  function flashCopied(which: "prompt" | "report") {
    copied = which;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = null), 2000);
  }

  async function copyPrompt() {
    if (!form?.prompt) return;
    if (await copyText(form.prompt)) {
      flashCopied("prompt");
    } else {
      downloadText("gain-bootstrap-prompt.md", form.prompt);
    }
  }

  function downloadPrompt() {
    if (form?.prompt) downloadText("gain-bootstrap-prompt.md", form.prompt);
  }

  async function copyReport() {
    if (!form?.importFailure) return;
    if (await copyText(form.importFailure.report)) {
      flashCopied("report");
    } else {
      downloadText("gain-import-report.md", form.importFailure.report);
    }
  }
</script>

<svelte:head>
  <title>GAIN</title>
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

{#snippet checkCircleIcon()}
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
    <path
      d="m8 12 3 3 5-6"
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

{#snippet playIcon()}
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M7 4v16l14-8L7 4z" fill="currentColor" />
  </svg>
{/snippet}

{#snippet chevronIcon(open: boolean)}
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" class="chevron" class:open>
    <path
      d="m6 9 6 6 6-6"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
{/snippet}

{#snippet externalLinkIcon()}
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="M9 15 20 4M20 4h-6M20 4v6"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
{/snippet}

{#if data.displayName}
  <p class="greeting">Hi, {data.displayName}.</p>
{/if}

{#if data.view === "first_run"}
  <section class="hero">
    <h1>GAIN doesn't write plans — an AI does.</h1>
    <p>
      GAIN runs the plan and records what actually happens. To start, copy the prompt below into any
      AI chat. The AI interviews you, writes your first plan, and hands you one document — paste it
      back here and you are training.
    </p>
  </section>

  <section class="card">
    <h2>1 · Give the AI a running start</h2>
    <p class="muted">
      Four optional questions, all skippable — anything you leave out is something the AI will ask
      about. Nothing you write here is stored.
    </p>
    <form method="POST" action="?/generatePrompt" class="questions" use:enhance>
      <label>
        Equipment you have
        <input type="text" name="equipment" placeholder="e.g. two adjustable dumbbells to 24 kg" />
      </label>
      <div class="row2">
        <label>
          Days per week
          <input type="text" name="sessions_per_week" placeholder="e.g. 3" />
        </label>
        <label>
          Minutes per session
          <input type="text" name="session_minutes" placeholder="e.g. 45" />
        </label>
      </div>
      <label>
        What you are training for
        <input type="text" name="goals" placeholder="e.g. general strength, not racing anything" />
      </label>
      <label>
        Anything to work around
        <input type="text" name="constraints" placeholder="e.g. a dodgy lower back" />
      </label>
      <button type="submit" class="primary">{@render sparkleIcon()}Generate the prompt</button>
    </form>
  </section>

  {#if form?.prompt}
    <section class="card">
      <h2>2 · Paste this into your AI chat</h2>
      <p class="muted">
        One document — the AI reads it, interviews you, and returns a plan. Copy the whole thing;
        download is the fallback.
      </p>
      <textarea class="doc" readonly rows="14" value={form.prompt}></textarea>
      <div class="actions">
        <button type="button" class="primary" onclick={copyPrompt}>
          {@render (copied === "prompt" ? checkIcon : copyIcon)()}
          {copied === "prompt" ? "Copied" : "Copy prompt"}
        </button>
        <button type="button" class="secondary" onclick={downloadPrompt}>
          {@render downloadIcon()}Download .md
        </button>
      </div>
    </section>
  {/if}

  <section class="card">
    <h2>
      {form?.prompt ? "3 · Paste the plan your AI gave you" : "Or paste a plan you already have"}
    </h2>
    <p class="muted">
      The whole document — prose and contract block. GAIN checks it before writing anything.
    </p>
    <form method="POST" action="?/import" use:enhance>
      <textarea
        class="doc"
        name="source_md"
        rows="10"
        placeholder="Paste the plan document here…"
        bind:value={pasted}></textarea>
      <div class="actions">
        <button type="submit" class="primary" disabled={!pasted.trim()}>
          {@render checkIcon()}Check the plan
        </button>
      </div>
    </form>
  </section>
{:else}
  {#each data.plans as plan (plan.slug)}
    <section class="card">
      <h2>{plan.name}</h2>
      <p class="muted">
        version {plan.version_no} · imported {plan.imported_at} ·
        {plan.counts.sessions} sessions, {plan.counts.exercises} exercises,
        {plan.counts.prescriptions} prescriptions
      </p>
      <ul class="sessions">
        {#each plan.sessions as session (session.key)}
          {@const id = `${plan.slug}:${session.key}`}
          {@const isOpen = openSession === id}
          <li>
            <button
              type="button"
              class="secondary session-toggle"
              aria-expanded={isOpen}
              aria-controls={`session-summary-${plan.slug}-${session.key}`}
              onclick={() => toggleSession(id)}
            >
              <span class="session-name">
                <span class="key">{session.key}</span>
                {session.name}
              </span>
              {@render chevronIcon(isOpen)}
            </button>
            {#if isOpen}
              <div class="session-summary" id={`session-summary-${plan.slug}-${session.key}`}>
                {#if session.note}
                  <p class="muted">{session.note}</p>
                {/if}
                {#each session.blocks as block (block.key)}
                  <div class="block-summary">
                    <h3>{block.name}</h3>
                    <p>{block.exercises.join(", ")}</p>
                  </div>
                {/each}
                <a class="session-link" href={`/plan/${plan.slug}/session/${session.key}`}>
                  {@render playIcon()}Start session
                </a>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
      <a class="export-link" href={`/plan/${plan.slug}/export`}>
        {@render externalLinkIcon()}Export for review
      </a>
    </section>
  {/each}

  <section class="card">
    <h2>Import a plan</h2>
    <p class="muted">
      Paste a new plan or a revised version. GAIN checks it and shows what would change before
      writing anything.
    </p>
    <form method="POST" action="?/import" use:enhance>
      <textarea
        class="doc"
        name="source_md"
        rows="10"
        placeholder="Paste the plan document here…"
        bind:value={pasted}></textarea>
      <div class="actions">
        <button type="submit" class="primary" disabled={!pasted.trim()}>
          {@render checkIcon()}Check the plan
        </button>
      </div>
    </form>
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
          {@render (copied === "report" ? checkIcon : copyIcon)()}
          {copied === "report" ? "Copied" : "Copy report for the AI"}
        </button>
      </div>
    </section>
  {/if}
{/if}

{#if form?.importError}
  <section class="card report-card">
    <h2>Nothing was imported</h2>
    <p>{form.importError}</p>
  </section>
{/if}

{#if form?.review}
  <section class="card">
    {#if form.review.kind === "first_import"}
      <h2>Ready to import</h2>
      <p>
        <strong>{form.review.plan_name}</strong> — version {form.review.version_no}:
        {form.review.counts.sessions} sessions, {form.review.counts.exercises} exercises,
        {form.review.counts.prescriptions} prescriptions.
      </p>
    {:else}
      <h2>Ready to import a revision</h2>
      <p>
        <strong>{form.review.plan_slug}</strong> — version {form.review.previous_version} →
        {form.review.new_version}. The detailed diff review arrives in a later phase; committing
        writes the new version and keeps the old one.
      </p>
    {/if}
    <form method="POST" action="?/confirmImport" use:enhance>
      <input type="hidden" name="source_md" value={form.source ?? ""} />
      <div class="actions">
        <button type="submit" class="primary">{@render checkCircleIcon()}Commit import</button>
      </div>
    </form>
  </section>
{/if}

<style>
  .greeting {
    margin: 0;
    color: var(--muted);
    font-weight: 700;
  }

  .hero {
    padding: 1.5rem 0 0.5rem;
  }

  .hero h1 {
    margin: 0 0 0.75rem;
    font-size: 1.6rem;
    line-height: 1.25;
  }

  .hero p {
    margin: 0;
    color: var(--muted);
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

  .questions {
    display: grid;
    gap: 0.75rem;
  }

  .questions label {
    display: grid;
    gap: 0.25rem;
    font-size: 0.9rem;
    color: var(--muted);
    min-width: 0;
  }

  .row2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    min-width: 0;
  }

  input {
    width: 100%;
    min-width: 0;
    padding: 0.65rem 0.75rem;
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
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

  button.primary:disabled {
    opacity: 0.45;
    cursor: default;
  }

  button.secondary {
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
  }

  .sessions {
    list-style: none;
    margin: 0 0 0.75rem;
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
  }

  .session-name {
    flex: 1;
    text-align: left;
  }

  .chevron {
    flex-shrink: 0;
    transition: transform 0.15s ease;
  }

  .chevron.open {
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

  .export-link {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.7rem 1.25rem;
    border-radius: var(--r-sm);
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
    font-weight: 700;
  }

  .export-link:hover {
    text-decoration: none;
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
