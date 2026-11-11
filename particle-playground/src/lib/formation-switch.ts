import {
  FORMATION_NAMES,
  type FormationName,
} from "@/lib/formations";
import {
  formationSwitchConfig,
  type FormationSwitchConfig,
} from "@/lib/formation-switch-config";
import type { GrabState } from "@/lib/grab-interaction";
import type { TwoHandState } from "@/lib/two-hand-transform";
import type { HandInteractionSample } from "@/types/hand-interaction";

/**
 * Cycles the particle formation with a deliberate V-sign.
 *
 * Classification stays in `detectGesture`. This module only decides *when* a
 * classified `v_sign` should advance the formation: hold, fire once, wait for
 * release, then cool down. One shared latch covers both hands, so two V-signs
 * at once still produce a single switch. Grabbing or a two-hand transform
 * blocks the charge entirely. Pure and three-free; nothing allocates after
 * construction.
 *
 * The actual React formation state is owned by the scene. When a switch fires,
 * `requested` is set for one frame and drained into `setFormation`.
 */

export type FormationSwitchPhase =
  | "idle"
  | "holding"
  | "fired"
  | "cooldown";

export type FormationSwitchState = {
  config: FormationSwitchConfig;
  phase: FormationSwitchPhase;
  /** Accumulated hold time while a V-sign is present. */
  holdTime: number;
  /** Time spent in cooldown after a release. */
  cooldownTime: number;
  /** How long the V-sign has been missing during a hold or after a fire. */
  absentTime: number;
  /** 0..1 charge progress for visual feedback. */
  progress: number;
  /** Key of a hand currently showing a V-sign (for the indicator). */
  activeKey: string | null;
  /** True on the frame a switch fires. */
  fired: boolean;
  /**
   * Formation to apply this frame, or null. Cleared by the drain after React
   * consumes it (or by the next step if nothing read it).
   */
  requested: FormationName | null;
};

export type FormationSwitchRequest = {
  pending: FormationName | null;
};

export function createFormationSwitchRequest(): FormationSwitchRequest {
  return { pending: null };
}

export function createFormationSwitchState(
  config: FormationSwitchConfig = formationSwitchConfig,
): FormationSwitchState {
  return {
    config,
    phase: "idle",
    holdTime: 0,
    cooldownTime: 0,
    absentTime: 0,
    progress: 0,
    activeKey: null,
    fired: false,
    requested: null,
  };
}

/** Resets every transient (unmount, camera off for good). */
export function resetFormationSwitch(state: FormationSwitchState): void {
  state.phase = "idle";
  state.holdTime = 0;
  state.cooldownTime = 0;
  state.absentTime = 0;
  state.progress = 0;
  state.activeKey = null;
  state.fired = false;
  state.requested = null;
}

/** The next name in toolbar order, wrapping at the end. */
export function nextFormationName(current: FormationName): FormationName {
  const index = FORMATION_NAMES.indexOf(current);
  const from = index < 0 ? 0 : index;
  return FORMATION_NAMES[(from + 1) % FORMATION_NAMES.length];
}

function isBlocked(grab: GrabState, two: TwoHandState): boolean {
  return grab.phase === "grabbing" || two.phase === "active";
}

/**
 * Finds a usable V-sign among the samples. Pinched hands and invalid samples
 * are ignored so a half-pinch cannot start a charge.
 */
function findVSign(
  samples: readonly HandInteractionSample[],
): HandInteractionSample | null {
  for (const sample of samples) {
    if (
      sample.valid &&
      sample.palmValid &&
      sample.gesture === "v_sign"
    ) {
      return sample;
    }
  }

  return null;
}

/**
 * Advances the switcher by one frame.
 *
 * `current` is the formation React currently shows. When a hold completes,
 * `requested` becomes `nextFormationName(current)` for this frame and
 * `fired` is true. Callers that own a `FormationSwitchRequest` should copy
 * `requested` into it so React can drain the change once.
 */
export function stepFormationSwitch(
  state: FormationSwitchState,
  samples: readonly HandInteractionSample[],
  grab: GrabState,
  two: TwoHandState,
  current: FormationName,
  delta: number,
): void {
  const { config } = state;
  const step = Math.min(
    Number.isFinite(delta) && delta > 0 ? delta : 0,
    config.maxStepSeconds,
  );

  state.fired = false;
  // A previous request that nobody drained is dropped; the next fire replaces it.
  state.requested = null;

  const blocked = isBlocked(grab, two);
  const sign = blocked ? null : findVSign(samples);
  state.activeKey = sign?.key ?? null;

  if (blocked && (state.phase === "holding" || state.phase === "idle")) {
    // An active grab / two-hand transform cancels any in-progress charge.
    state.phase = "idle";
    state.holdTime = 0;
    state.absentTime = 0;
    state.progress = 0;
    return;
  }

  switch (state.phase) {
    case "idle":
      if (sign !== null) {
        state.phase = "holding";
        state.holdTime = step;
        state.absentTime = 0;
        state.progress = Math.min(1, state.holdTime / config.holdSeconds);
      } else {
        state.holdTime = 0;
        state.progress = 0;
      }
      break;

    case "holding":
      if (sign !== null) {
        state.absentTime = 0;
        state.holdTime += step;
        state.progress = Math.min(1, state.holdTime / config.holdSeconds);

        if (state.holdTime >= config.holdSeconds - 1e-9) {
          state.phase = "fired";
          state.fired = true;
          state.requested = nextFormationName(current);
          state.progress = 1;
          state.holdTime = config.holdSeconds;
          state.absentTime = 0;
        }
      } else {
        state.absentTime += step;
        if (state.absentTime >= config.releaseGraceSeconds) {
          state.phase = "idle";
          state.holdTime = 0;
          state.absentTime = 0;
          state.progress = 0;
        }
      }
      break;

    case "fired":
      // Wait until every hand drops the V-sign before rearming.
      state.progress = 1;
      if (sign !== null) {
        state.absentTime = 0;
      } else {
        state.absentTime += step;
        if (state.absentTime >= config.releaseGraceSeconds) {
          state.phase = "cooldown";
          state.cooldownTime = 0;
          state.absentTime = 0;
          state.progress = 0;
          state.holdTime = 0;
        }
      }
      break;

    case "cooldown":
      state.progress = 0;
      state.cooldownTime += step;
      if (state.cooldownTime >= config.cooldownSeconds - 1e-9) {
        state.phase = "idle";
        state.cooldownTime = 0;
        // A V-sign still held after cooldown starts a new charge immediately.
        if (sign !== null) {
          state.phase = "holding";
          state.holdTime = step;
          state.progress = Math.min(1, state.holdTime / config.holdSeconds);
        }
      }
      break;
  }
}

/**
 * Copies a one-frame request into the shared drain slot. Does nothing when
 * nothing fired. Never overwrites an undrained pending request with null.
 */
export function publishFormationSwitch(
  state: FormationSwitchState,
  request: FormationSwitchRequest,
): void {
  if (state.requested !== null) {
    request.pending = state.requested;
  }
}

/**
 * Consumes a pending formation request. Returns the name, or null when there
 * is nothing to apply. Safe to call from a React-facing drain once per frame.
 */
export function takeFormationSwitchRequest(
  request: FormationSwitchRequest,
): FormationName | null {
  const next = request.pending;
  request.pending = null;
  return next;
}
