<script lang="ts">
  import { trapFocus } from "$lib/actions/focus-trap";
  import { pickCelebrationMessage } from "$lib/session/celebration";
  import IconPartyPopper from "~icons/lucide/party-popper";

  /**
   * The screen a completed session lands on before the home screen (UI §5,
   * "Settled 2026-08-15"). It is shown *after* the finish op is already written and the
   * workout's local key cleared, so it is purely a moment — dismissing it, backgrounding
   * the phone or killing the browser here all leave exactly the same finished workout
   * behind. Nothing on this screen can fail in a way that costs data.
   *
   * It renders inside the session route rather than as a route of its own. A route would
   * have to be reachable offline, which means precached, which means one more thing to get
   * wrong in the service worker for a screen that exists to say well done.
   *
   * A red-flag stop never reaches here — the runner routes that case straight home. See
   * `onRedFlagStop` in `+page.svelte`.
   */
  let { onDismiss }: { onDismiss: () => void } = $props();

  // One-shot at mount, deliberately not `$derived`: the message must not change under the
  // user because something unrelated triggered a reactive pass.
  const message = pickCelebrationMessage(Math.random);

  /**
   * The confetti. Each piece gets its horizontal position, a fall duration, a start delay,
   * a spin and a colour, computed once here rather than in the markup — a `$derived` over
   * `Math.random` would re-roll the whole field on every reactive pass and the confetti
   * would visibly teleport.
   *
   * Colours are fixed literals rather than theme tokens because the scrim behind them is
   * dark in both themes, exactly as the runner's sheets already are. They are accent
   * blues, gold and silver: UI §5 reserves green, amber and red for the plan's
   * symptom framework, and a burst of red and green on the screen that immediately
   * follows a session where those colours meant "stop" is the one thing this animation
   * must not do.
   */
  const COLOURS = ["#6b98f1", "#8fb3f5", "#d9b45f", "#f0d78c", "#c9d1d9", "#ffffff"];
  const PIECES = Array.from({ length: 42 }, (_, i) => ({
    key: i,
    left: Math.random() * 100,
    duration: 2.6 + Math.random() * 2.4,
    delay: Math.random() * 1.8,
    drift: Math.random() * 60 - 30,
    spin: Math.random() * 720 - 360,
    size: 6 + Math.random() * 6,
    colour: COLOURS[i % COLOURS.length],
    round: i % 3 === 0,
  }));
</script>

<!-- No tap-to-dismiss on the backdrop. It would need an `onclick` on a non-interactive
     element, which trips `a11y_click_events_have_key_events` — and this repo already has
     one standing instance of that warning it has not decided about, so adding a second is
     how a warning list becomes something everyone skims. The way out is the button below,
     or Escape, which `trapFocus` already handles. -->
<div class="celebrate-backdrop" role="presentation">
  <!-- `aria-hidden`: the confetti is the whole point visually and nothing at all
       otherwise. Under `prefers-reduced-motion` it is not rendered in the first place. -->
  <div class="confetti" aria-hidden="true">
    {#each PIECES as piece (piece.key)}
      <i
        class:round={piece.round}
        style:left="{piece.left}%"
        style:width="{piece.size}px"
        style:height="{piece.size * 1.6}px"
        style:background={piece.colour}
        style:animation-duration="{piece.duration}s"
        style:animation-delay="{piece.delay}s"
        style:--drift="{piece.drift}vw"
        style:--spin="{piece.spin}deg"
      ></i>
    {/each}
  </div>

  <!-- A real dialog for the same reasons the wrap-up sheet is one (UI §8). -->
  <div
    class="celebrate-card"
    role="dialog"
    aria-modal="true"
    aria-labelledby="celebrate-heading"
    use:trapFocus={{ onEscape: onDismiss }}
  >
    <span class="celebrate-icon" aria-hidden="true"><IconPartyPopper /></span>
    <h2 id="celebrate-heading" tabindex="-1" data-trap-focus-heading>{message}</h2>
    <button type="button" class="primary" onclick={onDismiss}>Back to home</button>
  </div>
</div>

<style>
  .celebrate-backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    overflow: hidden;
    /* Heavier than the sheets' scrim on purpose. A sheet sits *over* a session you are
       still in and has to keep it readable; this one arrives after the session is over,
       and at the sheets' 0.5 the log strip behind it stayed bright enough to look
       tappable. No `backdrop-filter` to get there — a full-viewport blur underneath 42
       animating elements is a lot to ask of a mid-range phone for an effect a darker
       flat colour achieves for free. */
    background: rgba(0, 0, 0, 0.88);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--s-5);
  }

  .confetti {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  /* Each piece starts one viewport-height above the top and falls past the bottom, so the
     field is full at every moment of the animation rather than starting empty. `--drift`
     and `--spin` are per-piece, set inline above; everything else is shared. */
  .confetti i {
    position: absolute;
    top: -12vh;
    border-radius: 1px;
    animation-name: fall;
    animation-timing-function: linear;
    animation-iteration-count: infinite;
  }
  .confetti i.round {
    border-radius: 50%;
  }

  @keyframes fall {
    from {
      transform: translate3d(0, 0, 0) rotate(0deg);
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    90% {
      opacity: 1;
    }
    to {
      transform: translate3d(var(--drift), 120vh, 0) rotate(var(--spin));
      opacity: 0;
    }
  }

  .celebrate-card {
    position: relative;
    width: 100%;
    max-width: 22rem;
    background: var(--surface);
    border-radius: var(--r-lg);
    padding: var(--s-6) var(--s-5);
    display: grid;
    justify-items: center;
    gap: var(--s-4);
    text-align: center;
    animation: rise 0.35s var(--ease-out) both;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(0.75rem) scale(0.97);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .celebrate-icon {
    display: inline-flex;
    font-size: var(--t-2xl);
    color: var(--accent);
  }

  .celebrate-card h2 {
    margin: 0;
    font-size: var(--t-lg);
    line-height: 1.35;
  }
  .celebrate-card h2:focus-visible {
    outline: none;
  }

  .primary {
    border: none;
    border-radius: var(--r-sm);
    padding: var(--s-3) var(--s-5);
    font-weight: var(--w-bold);
    background: var(--accent);
    color: var(--accent-in);
    min-height: 2.75rem;
  }

  /* The first reduced-motion handling in the app, and the one screen that most needs it:
     a full-viewport particle field is exactly what the preference is asking not to see.
     The message and the way out stay; only the movement goes. */
  @media (prefers-reduced-motion: reduce) {
    .confetti {
      display: none;
    }
    .celebrate-card {
      animation: none;
    }
  }
</style>
