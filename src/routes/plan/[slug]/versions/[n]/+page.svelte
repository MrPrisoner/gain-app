<!--
  src/routes/plan/[slug]/versions/[n]/+page.svelte

  The document, verbatim, with the same copy-then-download-fallback the bootstrap prompt
  and the export use (UI-DECISIONS §11) — assume a phone with a chat open in another tab.

  The textarea carries the text as a `value` expression rather than as element content,
  which is what keeps it byte-identical: HTML eats a newline immediately after the
  opening tag, and a plan document that happens to start with a blank line would come
  back one byte short of what was imported.
-->
<script lang="ts">
  import { copyText, downloadText } from "$lib/copy";
  import BackLink from "$lib/components/BackLink.svelte";
  import ArchivedNote from "$lib/components/ArchivedNote.svelte";
  import IconCheck from "~icons/lucide/check";
  import IconCopy from "~icons/lucide/copy";
  import IconDownload from "~icons/lucide/download";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined = $state(undefined);

  async function copy() {
    if (data.source === undefined) return;
    if (await copyText(data.source)) {
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 2000);
    } else {
      downloadText(data.filename, data.source);
    }
  }

  function download() {
    if (data.source !== undefined) downloadText(data.filename, data.source);
  }
</script>

<svelte:head>
  <title>v{data.versionNo} — {data.planName}</title>
</svelte:head>

<h1>{data.planName} — v{data.versionNo}</h1>

{#if data.planArchived}
  <ArchivedNote />
{/if}

<p class="muted">
  Imported {data.importedAt}{data.isCurrent ? " · the version in use now" : ""}
</p>

{#if data.source === undefined}
  <p class="missing">
    This version is recorded, but its document is not on disk at <code>{data.sourcePath}</code>.
    Everything logged under it is still intact — only the copy of the plan text is gone, and
    restoring it from a backup of the data volume will bring this page back.
  </p>
{:else}
  <div class="actions">
    <button type="button" class="primary" onclick={copy}>
      {#if copied}<IconCheck />{:else}<IconCopy />{/if}
      {copied ? "Copied" : "Copy document"}
    </button>
    <button type="button" class="secondary" onclick={download}>
      <IconDownload />Download .md
    </button>
  </div>

  <textarea class="doc" readonly rows="24" aria-label="Plan document" value={data.source}
  ></textarea>
{/if}

<BackLink href={`/plan/${data.planSlug}/versions`} label="← All versions" />

<style>
  .muted {
    color: var(--muted);
    font-size: var(--t-sm);
    margin: 0 0 1rem;
  }

  .missing {
    padding: var(--s-3) var(--s-4);
    border: 1px solid var(--amber);
    border-radius: var(--r-sm);
    background: var(--amber-soft);
    font-size: var(--t-sm);
    line-height: 1.5;
  }

  code {
    font-size: var(--t-sm);
    word-break: break-all;
  }

  .actions {
    display: flex;
    gap: var(--s-3);
    margin-bottom: 0.75rem;
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

  button.secondary {
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
  }

  .doc {
    width: 100%;
    padding: var(--s-3);
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
    font-size: var(--t-xs);
    line-height: 1.45;
    resize: vertical;
  }
</style>
