<!-- src/routes/plan/[slug]/versions/+page.svelte -->
<script lang="ts">
  import ArchivedNote from "$lib/components/ArchivedNote.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import IconCircleDot from "~icons/lucide/circle-dot";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Versions — {data.planName}</title>
</svelte:head>

<PageHeader title={`${data.planName} — versions`} backHref="/" backLabel="← Home" />

{#if data.planArchived}
  <ArchivedNote />
{/if}

<p class="muted">
  Every revision your AI has handed back, newest first. Each one opens as the document that was
  imported, word for word.
</p>

<ul class="versions">
  {#each data.versions as version (version.versionNo)}
    <li class:current={version.isCurrent}>
      <a href={`/plan/${data.planSlug}/versions/${version.versionNo}`}>
        <span class="line">
          <span class="no">v{version.versionNo}</span>
          <span class="date">imported {version.importedAt}</span>
          {#if version.isCurrent}
            <span class="badge"><IconCircleDot />current</span>
          {/if}
        </span>
        {#if version.changelog.length > 0}
          <ul class="changelog">
            {#each version.changelog as line, i (i)}
              <li>{line}</li>
            {/each}
          </ul>
        {:else}
          <p class="changelog-empty">
            {version.basedOnVersion === null
              ? "The first version of this plan."
              : "No changelog was included with this version."}
          </p>
        {/if}
      </a>
    </li>
  {/each}
</ul>

<style>
  .muted {
    color: var(--muted);
    font-size: var(--t-sm);
    margin: 0 0 1rem;
  }

  .versions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--s-3);
  }

  .versions a {
    display: block;
    padding: var(--s-3) var(--s-4);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-sm);
    background: var(--surface);
    color: var(--text);
  }

  .versions a:hover {
    text-decoration: none;
    background: var(--hover);
  }

  li.current a {
    border-color: var(--accent);
  }

  .line {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--s-2);
  }

  .no {
    font-weight: var(--w-bold);
  }

  .date {
    color: var(--muted);
    font-size: var(--t-sm);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    color: var(--accent);
    font-size: var(--t-2xs);
    font-weight: var(--w-bold);
  }

  .changelog {
    margin: 0.5rem 0 0;
    padding-left: var(--s-4);
    color: var(--muted);
    font-size: var(--t-sm);
    line-height: 1.5;
  }

  .changelog-empty {
    margin: 0.5rem 0 0;
    color: var(--dim);
    font-size: var(--t-sm);
  }
</style>
