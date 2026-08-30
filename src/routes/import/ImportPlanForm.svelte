<script lang="ts">
  import { enhance } from "$app/forms";
  import Field from "$lib/components/Field.svelte";
  import IconCheck from "~icons/lucide/check";
  import IconUpload from "~icons/lucide/upload";

  /**
   * The paste-or-upload half of every `?/check` submission — Export offers copy and
   * download, so Import offers paste and upload. A
   * chosen file only fills the same textarea a paste would: both paths go through the
   * identical "Check the plan" review step (UI-DECISIONS §11) rather than one bypassing
   * it, and `use:enhance` is what keeps the pasted text in place across a failed import.
   */
  let { pasted = $bindable() }: { pasted: string } = $props();

  let fileInput: HTMLInputElement | undefined = $state();

  async function onFileChosen(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    pasted = await file.text();
  }
</script>

<form method="POST" action="?/check" use:enhance>
  <Field label="Plan document" id="plan-document">
    <!-- A placeholder is a hint, not an accessible name — it disappears as soon as the
         box has content, which for this box is the entire time it matters. The visible
         label above is the accessible name now. -->
    <textarea
      class="doc"
      name="source_md"
      id="plan-document"
      rows="10"
      placeholder="Paste the plan document here…"
      bind:value={pasted}></textarea>
  </Field>
  <div class="actions">
    <button type="submit" class="primary" disabled={!pasted.trim()}>
      <IconCheck />Check the plan
    </button>
    <button type="button" class="secondary" onclick={() => fileInput?.click()}>
      <IconUpload />Import file
    </button>
    <input
      bind:this={fileInput}
      type="file"
      accept=".md,text/markdown,text/plain"
      class="file-input"
      aria-label="Import a plan from a file"
      onchange={onFileChosen}
    />
  </div>
</form>

<style>
  .doc {
    width: 100%;
    padding: var(--s-3);
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
    font-size: var(--t-sm);
    line-height: 1.45;
    resize: vertical;
  }

  .actions {
    display: flex;
    gap: var(--s-3);
    margin-top: 0.75rem;
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

  button.primary:disabled {
    opacity: 0.45;
    cursor: default;
  }

  button.secondary {
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
  }

  .file-input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
