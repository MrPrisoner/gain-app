<script lang="ts">
  import { trapFocus } from "$lib/actions/focus-trap";
  import type { SymptomGuideLevel } from "$lib/session/symptom-guide";

  /**
   * The symptom guide (UI §5): the plan's own
   * `safety.symptom_framework`, rendered rather than only exported. Read-only — there is
   * nothing here to submit, unlike every other sheet in the runner, so it carries no
   * `onApplied`/`onError` and no write path.
   */
  let {
    levels,
    escalation,
    onClose,
  }: {
    levels: SymptomGuideLevel[];
    escalation: string | undefined;
    onClose: () => void;
  } = $props();
</script>

<div
  class="sheet-backdrop"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
>
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-labelledby="symptom-guide-heading"
    use:trapFocus={{ onEscape: onClose }}
  >
    <h3 id="symptom-guide-heading" tabindex="-1" data-trap-focus-heading>Symptom guide</h3>

    <ul class="levels">
      {#each levels as level (level.level)}
        <li class="level">
          <div class="level-head">
            <span class="swatch" style:background={`var(${level.token})`} aria-hidden="true"></span>
            <span class="action">{level.actionLabel}</span>
            <span class="label">{level.label}</span>
          </div>
          {#if level.modifications.length > 0}
            <ul class="modifications">
              {#each level.modifications as modification (modification)}
                <li>{modification}</li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>

    {#if escalation}
      <p class="escalation">{escalation}</p>
    {/if}

    <div class="sheet-actions">
      <button type="button" class="primary" onclick={onClose}>Close</button>
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
    padding: var(--s-5);
    padding-bottom: calc(var(--s-5) + env(safe-area-inset-bottom));
    display: grid;
    gap: var(--s-3);
  }
  .levels {
    display: grid;
    gap: var(--s-4);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .level-head {
    display: flex;
    align-items: baseline;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .swatch {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    flex-shrink: 0;
    align-self: center;
  }
  .action {
    font-weight: var(--w-semi);
  }
  .label {
    color: var(--muted);
  }
  .modifications {
    margin: 0.35rem 0 0;
    padding-left: var(--s-5);
    font-size: var(--t-sm);
    color: var(--muted);
  }
  .escalation {
    font-size: var(--t-sm);
    color: var(--muted);
    margin: 0.25rem 0 0;
  }
  .sheet-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-3);
    margin-top: 0.5rem;
  }
  .sheet-actions button {
    min-height: 2.75rem;
    padding: 0 var(--s-5);
    border-radius: var(--r-sm);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font-size: var(--t-base);
  }
  .sheet-actions .primary {
    background: var(--accent);
    color: var(--accent-in);
    border-color: var(--accent);
  }
</style>
