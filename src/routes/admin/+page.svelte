<script lang="ts">
  import { enhance } from "$app/forms";
  import IconTriangleAlert from "~icons/lucide/triangle-alert";
  import Button from "$lib/components/Button.svelte";
  import Card from "$lib/components/Card.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  /** Which card has its confirmation open. One at a time, by construction. */
  let openFor = $state<string | null>(null);
  let typed = $state("");

  function open(userId: string): void {
    openFor = userId;
    typed = "";
  }

  function close(): void {
    openFor = null;
    typed = "";
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["kB", "MB", "GB"];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
  }

  /** ISO everywhere the app shows an absolute date (`history/+page.svelte`). */
  function isoDate(iso: string): string {
    return iso.slice(0, 10);
  }
</script>

<svelte:head><title>Users — GAIN</title></svelte:head>

<PageHeader
  title="Users"
  subtitle="Counts only. Plans, workouts and notes stay private to the person who wrote them."
/>

{#if form?.resetLabel}
  <p class="done" role="status">Reset {form.resetLabel}'s data.</p>
{/if}

{#if data.users.length === 0}
  <p class="empty">No one has signed in yet. Users appear here after their first sign-in.</p>
{/if}

<ul class="users">
  {#each data.users as user (user.userId)}
    <li class="card">
      <Card>
        <h2>{user.displayLabel ?? "No name yet"}</h2>
        <p class="status">{user.status}</p>

        <p class="counts tabular">
          {user.plans}
          {user.plans === 1 ? "plan" : "plans"} ·
          {user.workoutsFinished} of {user.workoutsStarted} finished ·
          {user.setLogs}
          {user.setLogs === 1 ? "set" : "sets"}
        </p>
        <p class="meta tabular">
          Joined {isoDate(user.createdAt)} · last seen {isoDate(user.lastLoginAt)} ·
          {formatBytes(user.diskBytes)}
        </p>
        <p class="meta identity">{user.oidcSub}</p>
        {#if user.schemaNote}
          <p class="schema-note">{user.schemaNote}</p>
        {/if}

        {#if openFor === user.userId}
          <form
            method="POST"
            action="?/reset"
            class="danger-panel"
            use:enhance={() => {
              return async ({ update }) => {
                await update();
                close();
              };
            }}
          >
            <input type="hidden" name="userId" value={user.userId} />

            <p class="warning" id="warn-{user.userId}">
              <IconTriangleAlert aria-hidden="true" />
              <span>
                This permanently erases every plan, workout and log for
                <strong>{user.confirmation}</strong>. They keep their account and can start again
                from an empty GAIN.
              </span>
            </p>

            <label for="confirm-{user.userId}">Type {user.confirmation} to confirm</label>
            <input
              id="confirm-{user.userId}"
              name="confirmLabel"
              bind:value={typed}
              aria-describedby="warn-{user.userId}"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
            />

            {#if form?.actionError && form?.userId === user.userId}
              <p class="action-error" role="alert">{form.actionError}</p>
            {/if}

            <div class="row">
              <Button variant="danger" type="submit" disabled={typed !== user.confirmation}>
                Reset {user.confirmation}'s data
              </Button>
              <Button variant="quiet" type="button" onclick={close}>Cancel</Button>
            </div>
          </form>
        {:else}
          <div class="trigger-row">
            <Button variant="danger" type="button" onclick={() => open(user.userId)}>
              Reset data…
            </Button>
          </div>
        {/if}
      </Card>
    </li>
  {/each}
</ul>

<style>
  .done {
    color: var(--text);
    background: var(--accent-soft);
    border-radius: var(--r-sm);
    padding: var(--s-3) var(--s-3);
    margin-top: 1rem;
  }

  .empty {
    color: var(--muted);
    margin-top: 1.5rem;
  }

  .users {
    list-style: none;
    padding: 0;
    margin: 1.5rem 0 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    gap: var(--s-4);
  }

  .card h2 {
    font-size: var(--t-base);
    font-weight: var(--w-semi);
    margin: 0;
  }

  .status {
    color: var(--text);
    font-size: var(--t-base);
    margin: 0.15rem 0 0.75rem;
  }

  .counts {
    color: var(--muted);
    font-size: var(--t-sm);
    margin: 0;
  }

  .meta {
    color: var(--dim);
    font-size: var(--t-xs);
    margin: 0.15rem 0 0;
  }

  .identity {
    overflow-wrap: anywhere;
  }

  .schema-note {
    color: var(--amber);
    font-size: var(--t-xs);
    margin: 0.35rem 0 0;
  }

  .trigger-row {
    margin-top: 1rem;
  }

  .danger-panel {
    margin-top: 1rem;
    padding: var(--s-4);
    border-radius: var(--r-sm);
    border: 1px solid var(--red);
    background: color-mix(in srgb, var(--red) 10%, transparent);
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

  .warning {
    display: flex;
    gap: var(--s-2);
    align-items: start;
    margin: 0;
    color: var(--text);
  }

  .danger-panel label {
    font-size: var(--t-sm);
    color: var(--text);
  }

  .danger-panel input {
    width: 100%;
  }

  .action-error {
    color: var(--text);
    margin: 0;
  }

  .row {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
</style>
