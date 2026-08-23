<!-- src/routes/plan/[slug]/versions/+page.svelte -->
<script lang="ts">
  import BackLink from "$lib/components/BackLink.svelte";
  import IconCircleDot from "~icons/lucide/circle-dot";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Versions — {data.planName}</title>
</svelte:head>

<h1>{data.planName} — versions</h1>

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

<BackLink href="/" label="← Home" />

<style>
  .muted {
    color: var(--muted);
    font-size: 0.9rem;
    margin: 0 0 1rem;
  }

  .versions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.75rem;
  }

  .versions a {
    display: block;
    padding: 0.85rem 1rem;
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
    gap: 0.5rem;
  }

  .no {
    font-weight: 700;
  }

  .date {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--accent);
    font-size: 0.75rem;
    font-weight: 700;
  }

  .changelog {
    margin: 0.5rem 0 0;
    padding-left: 1.1rem;
    color: var(--muted);
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .changelog-empty {
    margin: 0.5rem 0 0;
    color: var(--dim);
    font-size: 0.85rem;
  }
</style>
