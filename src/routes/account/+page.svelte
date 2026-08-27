<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { enhance } from "$app/forms";
  import IconTriangleAlert from "~icons/lucide/triangle-alert";
  import { clearAfterReset, setGeneration } from "$lib/sync/client.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let open = $state(false);
  let typed = $state("");
  let resetting = $state(false);

  /**
   * `gain:workout:<planSlug>:<sessionKey>` (session runner `+page.svelte`) is the one
   * localStorage prefix the runner writes. A reset erases every plan, so a key surviving
   * it points at data that no longer exists — and if a later re-import reuses the same
   * slug and session key, the runner would read it back as "already started" and never
   * write the new workout's `start` op at all. Clearing the whole prefix here, rather
   * than leaving it to rot, is what keeps that resumption from misfiring.
   */
  function clearWorkoutStorage(): void {
    if (typeof localStorage === "undefined") return;
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith("gain:workout:")) localStorage.removeItem(key);
    }
  }
</script>

<svelte:head><title>Account — GAIN</title></svelte:head>

<h1>Account</h1>

<p class="identity">
  Signed in as <strong>{data.displayName ?? "you"}</strong>.
  {#if data.bypass}(development bypass){/if}
</p>

{#if !open}
  <section class="section">
    <h2>Reset your data</h2>
    <p>
      Erases every plan, workout and log in this account permanently. Your account itself survives —
      signing in afterwards starts from an empty GAIN, the same as a brand-new user. Every other
      device you are signed in on is signed out; this one stays signed in.
    </p>
    <button class="trigger" type="button" onclick={() => (open = true)}> Reset my data… </button>
  </section>
{:else}
  <form
    method="POST"
    action="?/reset"
    class="danger-panel"
    use:enhance={() => {
      resetting = true;
      return async ({ result }) => {
        resetting = false;
        if (result.type === "success" && (result.data as { reset?: boolean })?.reset) {
          const { generation } = result.data as { generation: number };
          await clearAfterReset();
          clearWorkoutStorage();
          // The next full load would re-seed this from the server's own read anyway,
          // but this tab's in-memory copy (`client.svelte.ts`) must not wait for that:
          // any write attempted between now and then has to be judged against the
          // generation this reset just produced, not the stale one seeded on page load.
          setGeneration(generation);
          await goto(resolve("/", {}), { replaceState: true });
          return;
        }
        if (result.type === "failure") {
          form = result.data as ActionData;
        }
      };
    }}
  >
    <p class="warning" id="reset-warning">
      <IconTriangleAlert aria-hidden="true" />
      <span>
        This permanently erases every plan, workout and log in your account. You keep your account
        and can start again from an empty GAIN.
      </span>
    </p>

    <label for="confirm">Type RESET to confirm</label>
    <input
      id="confirm"
      name="confirm"
      bind:value={typed}
      aria-describedby="reset-warning"
      autocomplete="off"
      autocapitalize="none"
      spellcheck="false"
    />

    {#if form?.actionError}
      <p class="action-error" role="alert">{form.actionError}</p>
    {/if}

    <div class="row">
      <button
        class="danger"
        type="submit"
        disabled={typed.trim().toUpperCase() !== "RESET" || resetting}
      >
        {resetting ? "Resetting…" : "Reset my data"}
      </button>
      <button class="quiet" type="button" onclick={() => (open = false)} disabled={resetting}>
        Cancel
      </button>
    </div>
  </form>
{/if}

<style>
  .identity {
    color: var(--muted);
    margin-top: 0.25rem;
  }

  .section {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1.25rem;
    margin-top: 1.5rem;
  }

  .section h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin: 0 0 0.5rem;
  }

  .section p {
    color: var(--muted);
    font-size: 0.9rem;
    margin: 0;
  }

  .trigger {
    background: transparent;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    color: var(--muted);
    padding: 0.5rem 0.85rem;
    margin-top: 1rem;
    width: 100%;
  }

  .danger-panel {
    margin-top: 1.5rem;
    padding: 1.25rem;
    border-radius: var(--r-md);
    border: 1px solid var(--red);
    background: color-mix(in srgb, var(--red) 10%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .warning {
    display: flex;
    gap: 0.5rem;
    align-items: start;
    margin: 0;
    color: var(--text);
  }

  .danger-panel label {
    font-size: 0.875rem;
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
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .danger {
    background: var(--red);
    color: #fff;
    border: 0;
    border-radius: var(--r-sm);
    padding: 0.5rem 0.85rem;
  }

  .danger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .quiet {
    background: transparent;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    color: var(--muted);
    padding: 0.5rem 0.85rem;
  }
</style>
