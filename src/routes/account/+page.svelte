<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { enhance } from "$app/forms";
  import IconTriangleAlert from "~icons/lucide/triangle-alert";
  import { clearAfterReset, setGeneration } from "$lib/sync/client.svelte";
  import { purgeCachedUserData } from "$lib/sync/precache";
  import { clearWorkoutStorage } from "$lib/session/workout-storage";
  import Button from "$lib/components/Button.svelte";
  import Card from "$lib/components/Card.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let open = $state(false);
  let typed = $state("");
  let resetting = $state(false);
</script>

<svelte:head><title>Account — GAIN</title></svelte:head>

<PageHeader title="Account" />

<p class="identity">
  Signed in as <strong>{data.displayName ?? "you"}</strong>.
  {#if data.bypass}(development bypass){/if}
</p>

{#if !open}
  <div class="section">
    <Card>
      <h2>Reset your data</h2>
      <p>
        Erases every plan, workout and log in this account permanently. Your account itself survives
        — signing in afterwards starts from an empty GAIN, the same as a brand-new user. Every other
        device you are signed in on is signed out; this one stays signed in.
      </p>
      <div class="trigger-row">
        <Button variant="danger" type="button" onclick={() => (open = true)}>Reset my data…</Button>
      </div>
    </Card>
  </div>
{:else}
  <form
    method="POST"
    action="?/reset"
    class="danger-panel"
    use:enhance={() => {
      resetting = true;
      return async ({ result, update }) => {
        if (result.type === "success" && (result.data as { reset?: boolean })?.reset) {
          const { generation } = result.data as { generation: number };
          await clearAfterReset();
          clearWorkoutStorage();
          await purgeCachedUserData();
          // The next full load would re-seed this from the server's own read anyway,
          // but this tab's in-memory copy (`client.svelte.ts`) must not wait for that:
          // any write attempted between now and then has to be judged against the
          // generation this reset just produced, not the stale one seeded on page load.
          setGeneration(generation);
          // Deliberately still `resetting` on the way out: clearing it before the awaits
          // above re-enables the button with RESET still typed, and a second tap fires a
          // second reset. The component leaves with the navigation instead.
          await goto(resolve("/", {}), { replaceState: true });
          return;
        }

        resetting = false;
        if (result.type === "failure") {
          form = result.data as ActionData;
          return;
        }
        // `error` and `redirect`, which are exactly the results that mean the wipe may
        // have happened and the re-mint may not have. Swallowing them here would leave
        // the user looking at an unchanged page after a destructive action; `update()`
        // renders the error boundary or follows the redirect, as `/admin`'s does.
        await update();
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
      <Button
        variant="danger"
        type="submit"
        disabled={typed.trim().toUpperCase() !== "RESET"}
        pending={resetting}
        pendingLabel="Resetting…"
      >
        Reset my data
      </Button>
      <Button variant="quiet" type="button" onclick={() => (open = false)} disabled={resetting}>
        Cancel
      </Button>
    </div>
  </form>
{/if}

<style>
  .identity {
    color: var(--muted);
    margin-top: 0.25rem;
  }

  .section {
    margin-top: 1.5rem;
  }

  .section h2 {
    font-size: var(--t-base);
    font-weight: var(--w-semi);
    margin: 0 0 0.5rem;
  }

  .section p {
    color: var(--muted);
    font-size: var(--t-sm);
    margin: 0;
  }

  .trigger-row {
    margin-top: 1rem;
  }

  .danger-panel {
    margin-top: 1.5rem;
    padding: var(--s-5);
    border-radius: var(--r-md);
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
