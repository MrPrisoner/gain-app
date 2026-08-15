/**
 * The message shown on the celebration screen a completed session lands on.
 *
 * Pure and injected-random, like everything else in `$lib/session/` — the runner passes
 * `Math.random`, the tests pass a stub, and the picker is unit-testable without a
 * browser.
 *
 * The messages are deliberately about the session that just happened rather than about
 * the user. This app never sees a goal met, a streak kept or a personal best beaten — the
 * plan is authored elsewhere and progression is the reviewing AI's job — so a message
 * that claims any of those is claiming something GAIN has no way to know. What it does
 * know, always and exactly, is that a session was started and finished. Everything here
 * says that and stops.
 *
 * Nothing here is congratulatory about intensity, either. A session finished after a
 * red-flag stop never reaches this screen at all (the runner routes that case straight
 * home), but a session can still be completed having skipped half of it for symptoms, and
 * "you smashed it" is the wrong thing to say to someone whose back went halfway through.
 */

export const CELEBRATION_MESSAGES: readonly string[] = [
  "Session done. That is the whole job.",
  "Logged and in the bank.",
  "That is another one behind you.",
  "Done. Your next session starts from here.",
  "Finished. The plan moves because you did.",
  "One more session on the board.",
  "That counts. They all count.",
  "Session complete — go and eat something.",
  "Banked. Rest is part of it too.",
  "You turned up and finished. That is the hard part.",
];

/**
 * One message at random. `random` returns a float in `[0, 1)` — `Math.random` in the app,
 * a stub in the tests. Values outside that range are clamped rather than trusted, so a
 * caller passing a badly-behaved generator gets a message rather than `undefined`
 * rendered into the screen the user is looking at.
 */
export function pickCelebrationMessage(random: () => number): string {
  const raw = random();
  const index = Number.isFinite(raw)
    ? Math.floor((Math.abs(raw) % 1) * CELEBRATION_MESSAGES.length)
    : 0;
  return CELEBRATION_MESSAGES[Math.min(index, CELEBRATION_MESSAGES.length - 1)]!;
}
