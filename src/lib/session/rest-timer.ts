/**
 * The rest-timer state machine (UI-DECISIONS §4). Pure and clock-injected: the caller
 * (a Svelte component ticking on `requestAnimationFrame` or `setInterval`) supplies
 * `nowMs`, and this module only ever derives a phase from elapsed time — it owns no
 * timer itself, so it is fully unit-testable without touching a real clock.
 *
 * "Ranged rest is drawn honestly": for `rest_sec: [60, 90]` the timer counts down to
 * 60, then keeps counting *up* inside a shaded 60-90 band, then past it once the band's
 * top is exceeded. A fixed rest (`rest_sec: 45`) has no band to shade — it counts down
 * to zero and then simply keeps counting up as "over".
 */

import type { IntOrRange } from "../contract/schema";

export type RestSpec = { minS: number; maxS: number };

export type RestTimerState = {
  startedAtMs: number;
  spec: RestSpec;
};

export type RestPhase =
  | { phase: "counting_down"; remainingS: number }
  | { phase: "in_band"; elapsedS: number; bandMinS: number; bandMaxS: number }
  | { phase: "over_band"; elapsedS: number; bandMaxS: number };

export function restSpecFrom(sec: IntOrRange): RestSpec {
  return typeof sec === "number" ? { minS: sec, maxS: sec } : { minS: sec[0], maxS: sec[1] };
}

export function startRestTimer(spec: RestSpec, nowMs: number): RestTimerState {
  return { startedAtMs: nowMs, spec };
}

export function restPhaseAt(state: RestTimerState, nowMs: number): RestPhase {
  const elapsedS = Math.floor((nowMs - state.startedAtMs) / 1000);
  const { minS, maxS } = state.spec;

  if (elapsedS < minS) {
    return { phase: "counting_down", remainingS: minS - elapsedS };
  }
  if (minS === maxS || elapsedS >= maxS) {
    return { phase: "over_band", elapsedS, bandMaxS: maxS };
  }
  return { phase: "in_band", elapsedS, bandMinS: minS, bandMaxS: maxS };
}

/** UI-DECISIONS §4's "add 30 seconds" escape: push both targets back, keep the start
 * time — so a rest already in progress simply has more runway before it counts as met. */
export function extendRest(state: RestTimerState, extraSeconds: number): RestTimerState {
  return {
    startedAtMs: state.startedAtMs,
    spec: { minS: state.spec.minS + extraSeconds, maxS: state.spec.maxS + extraSeconds },
  };
}
