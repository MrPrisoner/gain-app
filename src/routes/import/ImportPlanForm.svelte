<script lang="ts">
  import { enhance } from "$app/forms";
  import IconCheck from "~icons/lucide/check";
  import IconUpload from "~icons/lucide/upload";

  /**
   * The paste-or-upload half of every `?/check` submission (todo.md, "Home page UI
   * tweaks" — Export offers copy and download, so Import offers paste and upload). A
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
  <textarea
    class="doc"
    name="source_md"
    rows="10"
    placeholder="Paste the plan document here…"
    bind:value={pasted}></textarea>
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
    padding: 0.75rem;
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    line-height: 1.45;
    resize: vertical;
  }

  .actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.75rem;
    flex-wrap: wrap;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    border: none;
    border-radius: var(--r-sm);
    padding: 0.7rem 1.25rem;
    font-weight: 700;
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
