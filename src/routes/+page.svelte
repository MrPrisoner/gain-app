<script lang="ts">
  import { untrack } from "svelte";
  import { enhance } from "$app/forms";
  import { copyText, downloadText } from "$lib/copy";
  import { precacheSessions } from "$lib/sync/precache";
  import NextSessionCard from "./NextSessionCard.svelte";
  import ActivityStrip from "./ActivityStrip.svelte";
  import NextMorningPrompt from "./NextMorningPrompt.svelte";
  import { dueNextMorningPrompts } from "$lib/home/next-morning";
  import { startSyncLoop } from "$lib/sync/client.svelte";
  import Button from "$lib/components/Button.svelte";
  import Card from "$lib/components/Card.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import IconArchive from "~icons/lucide/archive";
  import IconArchiveRestore from "~icons/lucide/archive-restore";
  import IconCheck from "~icons/lucide/check";
  import IconCopy from "~icons/lucide/copy";
  import IconDownload from "~icons/lucide/download";
  import IconExternalLink from "~icons/lucide/external-link";
  import IconFileClock from "~icons/lucide/file-clock";
  import IconHistory from "~icons/lucide/history";
  import IconSparkles from "~icons/lucide/sparkles";
  import IconTrendingUp from "~icons/lucide/trending-up";
  import IconUpload from "~icons/lucide/upload";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // Ask the service worker to cache every plan's session routes while there is still a
  // network — what makes a session *startable* offline, not only
  // continuable. `data.plans` is `undefined` on the first-run view, so this is a harmless
  // no-op until a plan actually exists, and it deliberately reacts to `data.plans` rather
  // than running once: importing a new plan (or a revision that adds a session) must
  // precache it too, and `precacheSessions`/`cache.addAll` are idempotent, so re-running
  // on an unrelated reactive update costs nothing beyond a cheap re-fetch of what is
  // already cached.
  $effect(() => {
    for (const plan of data.plans ?? []) {
      void precacheSessions(
        plan.slug,
        plan.sessions.map((session) => session.key),
      );
    }
  });

  // The bootstrap-prompt form is enhanced so the generated prompt renders without a full
  // navigation. The import flow itself — paste box, parse-error report, review — lives at
  // `/import` (src/routes/import/+page.svelte) and is out of scope here.
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined = $state(undefined);

  // The next-morning prompt's dismissal is local and permanent for that workout (design
  // not synced, and not re-derived from server data, so a dismissal survives
  // even if the answer op never syncs.
  const DISMISS_KEY = "gain:next-morning-dismissed";

  function readDismissed(): string[] {
    if (typeof localStorage === "undefined") return [];
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  }

  let dismissed = $state<string[]>(untrack(() => readDismissed()));

  function dismissNextMorning(workoutClientId: string): void {
    if (dismissed.includes(workoutClientId)) return;
    dismissed = [...dismissed, workoutClientId];
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(dismissed));
    }
  }

  // `nowMs` is read only after mount (never at module/SSR eval time), so the server-
  // rendered markup never has to agree with a client-only clock — the next-morning
  // card simply does not render until this effect has run once.
  let nowMs = $state<number | undefined>(undefined);

  $effect(() => {
    nowMs = Date.now();
    const onVisible = () => {
      if (document.visibilityState === "visible") nowMs = Date.now();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  });

  const dueNextMorning = $derived(
    nowMs === undefined || data.view !== "plan"
      ? []
      : dueNextMorningPrompts(data.nextMorningCandidates, nowMs, dismissed),
  );

  // Activities have no owning plan and this route otherwise never
  // registers the reconnect/visibility listeners `startSyncLoop` provides (only the
  // session runner does today) — without this, an activity op queued while offline
  // would only retry via its own internal backoff timer, never immediately on
  // reconnect. "home" is inert here for the same reason ActivitySheet's logWrite call
  // is: `$lib/sync/client.svelte.ts` never uses this argument to address or filter
  // anything.
  $effect(() => startSyncLoop("home"));

  function flashCopied() {
    copied = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = false), 2000);
  }

  async function copyPrompt() {
    if (!form?.prompt) return;
    if (await copyText(form.prompt)) {
      flashCopied();
    } else {
      downloadText("gain-bootstrap-prompt.md", form.prompt);
    }
  }

  function downloadPrompt() {
    if (form?.prompt) downloadText("gain-bootstrap-prompt.md", form.prompt);
  }
</script>

<svelte:head>
  <title>GAIN</title>
</svelte:head>

{#if data.displayName}
  <p class="greeting">Hi, {data.displayName}.</p>
{/if}

{#if data.view === "first_run"}
  <section class="hero">
    <h1>GAIN doesn't write plans — an AI does.</h1>
    <p>
      GAIN runs the plan and records what actually happens. To start, copy the prompt below into any
      AI chat. The AI interviews you, writes your first plan, and hands you one document — paste it
      back here and you are training.
    </p>
  </section>

  <div class="card">
    <Card>
      <h2>1 · Give the AI a running start</h2>
      <p class="muted">
        Four optional questions, all skippable — anything you leave out is something the AI will ask
        about. Nothing you write here is stored.
      </p>
      <form method="POST" action="?/generatePrompt" class="questions" use:enhance>
        <label>
          Equipment you have
          <input
            type="text"
            name="equipment"
            placeholder="e.g. two adjustable dumbbells to 24 kg"
          />
        </label>
        <div class="row2">
          <label>
            Days per week
            <input type="text" name="sessions_per_week" placeholder="e.g. 3" />
          </label>
          <label>
            Minutes per session
            <input type="text" name="session_minutes" placeholder="e.g. 45" />
          </label>
        </div>
        <label>
          What you are training for
          <input
            type="text"
            name="goals"
            placeholder="e.g. general strength, not racing anything"
          />
        </label>
        <label>
          Anything to work around
          <input type="text" name="constraints" placeholder="e.g. a dodgy lower back" />
        </label>
        <button type="submit" class="primary"><IconSparkles />Generate the prompt</button>
      </form>
    </Card>
  </div>

  {#if form?.prompt}
    <div class="card">
      <Card>
        <h2>2 · Paste this into your AI chat</h2>
        <p class="muted">
          One document — the AI reads it, interviews you, and returns a plan. Copy the whole thing;
          download is the fallback.
        </p>
        <textarea class="doc" readonly rows="14" aria-label="Bootstrap prompt" value={form.prompt}
        ></textarea>
        <div class="actions">
          <button type="button" class="primary" onclick={copyPrompt}>
            {#if copied}<IconCheck />{:else}<IconCopy />{/if}
            {copied ? "Copied" : "Copy prompt"}
          </button>
          <button type="button" class="secondary" onclick={downloadPrompt}>
            <IconDownload />Download .md
          </button>
        </div>
      </Card>
    </div>
  {/if}

  <div class="card">
    <Card>
      <h2>{form?.prompt ? "3 · Bring back the plan" : "Already have a plan?"}</h2>
      <p class="muted">
        {form?.prompt
          ? "Once your AI hands you a document, bring it here."
          : "Skip the interview and bring a plan document you already have."}
      </p>
      <a class="primary-link" href="/import"><IconUpload />Paste the plan your AI gave you</a>
    </Card>
  </div>
{:else}
  <PageHeader title="GAIN" />

  {#each dueNextMorning as candidate (candidate.workoutClientId)}
    <NextMorningPrompt
      planSlug={candidate.planSlug}
      sessionKey={candidate.sessionKey}
      workoutClientId={candidate.workoutClientId}
      metrics={candidate.metrics}
      onDismiss={dismissNextMorning}
    />
  {/each}

  {#each data.plans as plan (plan.slug)}
    <NextSessionCard
      planSlug={plan.slug}
      planName={plan.name}
      suggestedKey={plan.suggestion.suggestedKey}
      lastSession={plan.suggestion.lastSession}
      sessions={plan.sessions}
      todayDate={data.todayDate}
      schedulingRules={plan.schedulingRules}
      dropOrder={plan.dropOrder}
    />
  {/each}

  <ActivityStrip kinds={data.activityKinds} />

  {#each data.plans as plan (plan.slug)}
    <section class="card plan-admin">
      <Card>
        <h2>{plan.name}</h2>
        <p class="muted">
          version {plan.version_no} · imported {plan.imported_at} ·
          {plan.counts.sessions} sessions, {plan.counts.exercises} exercises,
          {plan.counts.prescriptions} prescriptions
        </p>
        <nav class="plan-links">
          <a class="export-link" href={`/plan/${plan.slug}/export`}>
            <IconExternalLink />Export for review
          </a>
          <a class="export-link" href={`/plan/${plan.slug}/progress`}>
            <IconTrendingUp />Progress
          </a>
          <a class="export-link" href={`/plan/${plan.slug}/history`}>
            <IconHistory />History
          </a>
          <a class="export-link" href={`/plan/${plan.slug}/versions`}>
            <IconFileClock />Plan versions
          </a>
          <a class="export-link" href="/import">
            <IconUpload />Import a revised plan
          </a>
        </nav>

        <!--
          Archiving is reversible and read-only (`$lib/db/archive.ts`), so it gets a plain
          button and no type-to-confirm: the plan reappears one tap away in the Archived
          group directly below, and nothing it has logged is at risk. The line above it
          says so, because "archive" reads as "delete" to most people until told otherwise.
        -->
        <form method="POST" action="?/archive" class="archive-form" use:enhance>
          <input type="hidden" name="slug" value={plan.slug} />
          <p class="muted archive-hint">
            Finished with this plan? Archiving hides it here and stops new sessions. History,
            progress, export and versions all stay open, and you can bring it back any time.
          </p>
          {#snippet archiveIcon()}<IconArchive />{/snippet}
          <Button variant="quiet" type="submit" icon={archiveIcon}>Archive plan</Button>
        </form>
      </Card>
    </section>
  {/each}

  {#if data.plans.length === 0}
    <div class="card">
      <Card>
        <h2>Everything is archived</h2>
        <p class="muted">
          Every plan on this account is put away. Open one below to read its history, bring it back,
          or start something new.
        </p>
        <a class="primary-link" href="/import"><IconUpload />Paste a new plan</a>
      </Card>
    </div>
  {/if}

  {#if form?.planError}
    <p class="plan-error">{form.planError}</p>
  {/if}

  {#if data.archived.length > 0}
    <details class="archived-group">
      <summary>Archived <span class="count">{data.archived.length}</span></summary>
      {#each data.archived as plan (plan.slug)}
        <div class="archived-plan">
          <h3>{plan.name}</h3>
          <p class="muted">archived {plan.archivedAt}</p>
          <nav class="plan-links">
            <a class="export-link" href={`/plan/${plan.slug}/history`}>
              <IconHistory />History
            </a>
            <a class="export-link" href={`/plan/${plan.slug}/progress`}>
              <IconTrendingUp />Progress
            </a>
            <a class="export-link" href={`/plan/${plan.slug}/export`}>
              <IconExternalLink />Export for review
            </a>
            <a class="export-link" href={`/plan/${plan.slug}/versions`}>
              <IconFileClock />Plan versions
            </a>
          </nav>
          <form method="POST" action="?/unarchive" use:enhance>
            <input type="hidden" name="slug" value={plan.slug} />
            {#snippet unarchiveIcon()}<IconArchiveRestore />{/snippet}
            <Button variant="quiet" type="submit" icon={unarchiveIcon}>Unarchive</Button>
          </form>
        </div>
      {/each}
    </details>
  {/if}
{/if}

<style>
  .greeting {
    margin: 0;
    color: var(--muted);
    font-weight: var(--w-bold);
  }

  .hero {
    padding: var(--s-5) 0 var(--s-2);
  }

  .hero h1 {
    margin: 0 0 0.75rem;
    font-size: var(--t-xl);
    line-height: 1.25;
  }

  .hero p {
    margin: 0;
    color: var(--muted);
  }

  .card {
    margin-top: 1.25rem;
  }

  .card h2 {
    margin: 0 0 0.5rem;
    font-size: var(--t-base);
  }

  .muted {
    color: var(--muted);
    font-size: var(--t-sm);
    margin: 0 0 0.75rem;
  }

  .questions {
    display: grid;
    gap: var(--s-3);
  }

  .questions label {
    display: grid;
    gap: var(--s-1);
    font-size: var(--t-sm);
    color: var(--muted);
    min-width: 0;
  }

  .row2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-3);
    min-width: 0;
  }

  input {
    width: 100%;
    min-width: 0;
    padding: var(--s-3) var(--s-3);
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
  }

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

  .primary-link {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    border-radius: var(--r-sm);
    padding: var(--s-3) var(--s-5);
    font-weight: var(--w-bold);
    background: var(--accent);
    color: var(--accent-in);
  }

  .primary-link:hover {
    text-decoration: none;
  }

  .plan-links {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-2);
  }

  .export-link {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-5);
    border-radius: var(--r-sm);
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
    font-weight: var(--w-bold);
  }

  .export-link:hover {
    text-decoration: none;
  }

  .archive-form {
    margin-top: 1rem;
    border-top: 1px solid var(--line-soft);
    padding-top: var(--s-4);
  }

  .archive-hint {
    margin-bottom: 0.6rem;
  }

  .plan-error {
    margin: 1rem 0 0;
    padding: var(--s-3) var(--s-3);
    border: 1px solid var(--red);
    border-radius: var(--r-sm);
    font-size: var(--t-sm);
  }

  .archived-group {
    margin-top: 1.25rem;
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: var(--s-4) var(--s-5);
  }

  .archived-group summary {
    font-weight: var(--w-bold);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }

  .archived-group .count {
    color: var(--muted);
    font-weight: var(--w-body);
    font-size: var(--t-sm);
  }

  .archived-plan {
    margin-top: 1rem;
    padding-top: var(--s-4);
    border-top: 1px solid var(--line-soft);
    display: grid;
    gap: var(--s-3);
    justify-items: start;
  }

  .archived-plan h3 {
    margin: 0;
    font-size: var(--t-base);
  }

  .archived-plan .muted {
    margin: 0;
  }
</style>
