<svelte:head>
  <title>Offline — GAIN</title>
</svelte:head>

<div class="offline-page">
  <p class="status">Offline</p>
  <h1>GAIN needs a connection for this</h1>
  <p class="explain">
    This screen isn't cached for offline use. Anything you've already logged is saved on this device
    and will sync the next time you're online — nothing is lost by being here.
  </p>
  <p><a href="/">Back to GAIN</a></p>
</div>

<style>
  .offline-page {
    padding-top: 3rem;
    text-align: center;
  }

  .status {
    margin: 0;
    font-size: 3.5rem;
    font-weight: 800;
    color: var(--dim);
  }

  h1 {
    margin: 0.5rem 0 1rem;
    font-size: 1.4rem;
  }

  .explain {
    max-width: 34rem;
    margin: 0 auto 1.5rem;
    color: var(--muted);
  }
</style>
