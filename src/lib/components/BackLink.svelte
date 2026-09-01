<script lang="ts">
  let { href, label }: { href: string; label: string } = $props();
</script>

<p class="back"><a {href}>{label}</a></p>

<style>
  .back {
    margin: 1.25rem 0 0;
    font-size: var(--t-sm);
  }
</style>
