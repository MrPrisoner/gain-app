<!--
  src/routes/plan/[slug]/versions/[n]/+page.svelte

  The document, verbatim, with the same copy-then-download-fallback the bootstrap prompt
  and the export use (UI §11) — assume a phone with a chat open in another tab.

  The textarea carries the text as a `value` expression rather than as element content,
  which is what keeps it byte-identical: HTML eats a newline immediately after the
  opening tag, and a plan document that happens to start with a blank line would come
  back one byte short of what was imported.
-->
<script lang="ts">
  import { copyText, downloadText } from "$lib/copy";
  import ArchivedNote from "$lib/components/ArchivedNote.svelte";
  import Button from "$lib/components/Button.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
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

<PageHeader
  title={`${data.planName} — v${data.versionNo}`}
  backHref={`/plan/${data.planSlug}/versions`}
  backLabel="← All versions"
/>

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
    {#snippet copyIcon()}
      {#if copied}<IconCheck />{:else}<IconCopy />{/if}
    {/snippet}
    <Button variant="primary" type="button" onclick={copy} icon={copyIcon}>
      {copied ? "Copied" : "Copy document"}
    </Button>
    {#snippet downloadIcon()}<IconDownload />{/snippet}
    <Button variant="secondary" type="button" onclick={download} icon={downloadIcon}>
      Download .md
    </Button>
  </div>

  <textarea class="doc" readonly rows="24" aria-label="Plan document" value={data.source}
  ></textarea>
{/if}

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

  .doc {
    width: 100%;
    padding: var(--s-3);
    border-radius: var(--r-xs);
    border: 1px solid var(--line-strong);
    background: var(--raised);
    color: var(--text);
    font: inherit;
    font-size: var(--t-xs);
    line-height: 1.45;
    resize: vertical;
  }
</style>
