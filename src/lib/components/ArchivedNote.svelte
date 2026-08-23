<!--
  The mark an archived plan carries on every screen that still opens for it.

  Archiving is read-only and reversible (`$lib/db/archive.ts`), so this is a statement
  of state, not a warning: deliberately neutral rather than amber, since nothing here
  needs the user's attention and nothing is wrong. It says where the plan went and how
  to get it back, because a screen that only said "Archived" would leave the one
  question it raises unanswered.
-->
<script lang="ts">
  import IconArchive from "~icons/lucide/archive";
</script>

<p class="archived">
  <IconArchive /><span
    >Archived. Everything here still reads; new sessions are off until you unarchive it on the
    <a href="/">home screen</a>.</span
  >
</p>

<style>
  .archived {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin: 0 0 1rem;
    padding: 0.65rem 0.8rem;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--raised);
    color: var(--muted);
    font-size: 0.85rem;
    line-height: 1.45;
  }
</style>
