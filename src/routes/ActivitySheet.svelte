<script lang="ts">
  import { trapFocus } from "$lib/actions/focus-trap";
  import { slugifyActivityKind } from "$lib/home/activity-kinds";
  import { occurredAtMsFor, type ActivityWhen } from "$lib/home/activity-when";
  import { newOpId } from "$lib/sync/ops";
  import { logWrite } from "$lib/sync/client.svelte";

  /**
   * The activity log sheet (design spec §5, decision 4): asks duration/intensity/note
   * and *when* before writing, rather than one tap that writes immediately and is
   * edited afterwards — the op carries its full payload at write time, so there is no
   * edit window to explain and no undo to build.
   *
   * `logWrite`'s first argument is a plan slug used only to thread retry state
   * (`$lib/sync/client.svelte.ts` never uses it to address or filter anything) — an
   * activity has no owning plan, so this passes the literal string "home" rather than
   * any real plan's slug.
   */
  let {
    initialKind,
    onClose,
    onLogged,
  }: {
    initialKind: string | undefined;
    onClose: () => void;
    onLogged: (kind: string) => void;
  } = $props();

  let kindInput = $state(initialKind ?? "");
  let when = $state<ActivityWhen>("now");
  let durationMin = $state("");
  let intensity = $state("");
  let note = $state("");
  let submitting = $state(false);
  let error = $state<string | undefined>();

  const slug = $derived(slugifyActivityKind(kindInput));

  async function save(): Promise<void> {
    if (submitting || slug.length === 0) return;
    submitting = true;
    try {
      const occurredAt = new Date(occurredAtMsFor(when, Date.now())).toISOString();
      const minutes = durationMin.trim() === "" ? undefined : Number(durationMin);
      // The op's `durationMin` must always be `undefined` or a non-negative integer —
      // `activityOpSchema` requires `z.number().int().nonnegative()`, and `POST
      // /api/sync` validates the whole batch at once, so one op that fails that check
      // 400s the entire batch rather than being quarantined individually. Because the
      // outbox is flushed in ULID order, a bad value here would then sit at the front of
      // every future batch and block everything queued behind it. Rounding and clamping
      // before the op is constructed means an out-of-range value can never reach it.
      const roundedMinutes = Number.isFinite(minutes)
        ? Math.max(0, Math.round(minutes as number))
        : undefined;

      await logWrite("home", {
        kind: "activity",
        id: newOpId(),
        activityKind: slug,
        occurredAt,
        durationMin: roundedMinutes,
        intensity: intensity.trim() || undefined,
        note: note.trim() || undefined,
      });

      onLogged(slug);
    } catch (err) {
      error = err instanceof Error ? err.message : "Something went wrong.";
    } finally {
      submitting = false;
    }
  }
</script>

<div class="sheet-backdrop" onclick={onClose} role="presentation">
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-labelledby="activity-heading"
    onclick={(e) => e.stopPropagation()}
    use:trapFocus={{ onEscape: onClose }}
  >
    <h3 id="activity-heading" tabindex="-1" data-trap-focus-heading>Log activity</h3>

    {#if initialKind === undefined}
      <label>
        What did you do?
        <input type="text" bind:value={kindInput} placeholder="e.g. squash" />
      </label>
    {:else}
      <p class="kind-label">{initialKind}</p>
    {/if}

    <div class="when-row">
      <label><input type="radio" name="when" value="now" bind:group={when} /> Now</label>
      <label
        ><input type="radio" name="when" value="earlier_today" bind:group={when} /> Earlier today</label
      >
      <label><input type="radio" name="when" value="yesterday" bind:group={when} /> Yesterday</label
      >
    </div>

    <div class="row2">
      <label>
        Duration (min)
        <input type="text" inputmode="numeric" bind:value={durationMin} placeholder="Optional" />
      </label>
      <label>
        Intensity
        <input type="text" bind:value={intensity} placeholder="e.g. hard" />
      </label>
    </div>

    <label>
      Note
      <textarea bind:value={note} placeholder="Optional"></textarea>
    </label>

    {#if error}<p class="error">{error}</p>{/if}

    <div class="sheet-actions">
      <button type="button" class="secondary" onclick={onClose}>Cancel</button>
      <button
        type="button"
        class="primary"
        disabled={submitting || slug.length === 0}
        onclick={save}
      >
        Log it
      </button>
    </div>
  </div>
</div>

<style>
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-end;
    z-index: 60;
  }
  .sheet {
    width: 100%;
    max-height: 90dvh;
    overflow-y: auto;
    background: var(--surface);
    border-top-left-radius: var(--r-lg);
    border-top-right-radius: var(--r-lg);
    padding: 1.25rem;
    padding-bottom: calc(1.25rem + env(safe-area-inset-bottom));
    display: grid;
    gap: 0.75rem;
  }
  label {
    display: grid;
    gap: 0.25rem;
    font-size: 0.9rem;
    color: var(--muted);
    min-width: 0;
  }
  .kind-label {
    margin: 0;
    font-weight: 700;
    color: var(--text);
    text-transform: capitalize;
  }
  .when-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    font-size: 0.85rem;
  }
  .when-row label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 2.75rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--line);
    border-radius: var(--r-xs);
    background: var(--raised);
    color: var(--text);
    /* Without this, "Earlier today" wraps onto two lines and the radio input — which has
       no pinned intrinsic width in this flex layout — expands to fill the freed-up
       horizontal space instead of staying at its native size, rendering as an oversized
       oval next to the other two normal-sized radios. */
    white-space: nowrap;
  }
  .row2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    min-width: 0;
  }
  input,
  textarea {
    width: 100%;
    min-height: 2.75rem;
    padding: 0.6rem;
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
  }
  .error {
    background: var(--raised);
    color: var(--text);
    font-weight: 700;
    border-radius: var(--r-xs);
    padding: 0.6rem 0.75rem;
    margin: 0;
  }
  .sheet-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
  }
  .sheet-actions button {
    border: none;
    border-radius: var(--r-sm);
    padding: 0.7rem 1.25rem;
    font-weight: 700;
  }
  .primary {
    background: var(--accent);
    color: var(--accent-in);
  }
  .primary:disabled {
    opacity: 0.45;
  }
  .secondary {
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
  }
</style>
