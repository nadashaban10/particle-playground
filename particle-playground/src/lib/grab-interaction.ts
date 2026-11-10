import { grabConfig, type GrabConfig } from "@/lib/grab-config";
import { nextPinchClosed } from "@/lib/grab-pinch";
import type { Handedness } from "@/types/hand-tracking";
import type { HandInteractionSample } from "@/types/hand-interaction";
import type { Vector3 } from "@/types/particles";

export type GrabPhase = "idle" | "candidate" | "grabbing";

/** Per-hand pinch memory. Pooled so stepping never allocates. */
type PinchTracker = {
  key: string | null;
  handedness: Handedness | null;
  closed: boolean;
  /** A tracker may start a grab only after it has been seen open. */
  armed: boolean;
  /** Seen with a usable sample this frame. */
  seen: boolean;
  /** Two usable samples shared this key this frame. */
  ambiguous: boolean;
  x: number;
  y: number;
  z: number;
};

export type GrabState = {
  config: GrabConfig;
  phase: GrabPhase;
  /** Hand holding the formation, or null. */
  grabKey: string | null;
  grabHandedness: Handedness | null;
  /** True only on the frame a grab began. */
  started: boolean;
  /** True only on the frame a grab ended. */
  ended: boolean;
  /** Where the formation origin should be. Holds its last value when idle. */
  desiredOrigin: Vector3;
  /** True while a grab owns the formation, so the pointer attractor should pause. */
  suspendAttractor: boolean;

  candidateKey: string | null;
  candidateFrames: number;
  openFrames: number;
  lostTime: number;
  /** desiredOrigin minus the pinch point; keeps the formation from jumping. */
  offset: Vector3;
  lastPinch: Vector3;
  /** Recompute `offset` from the next usable closed sample. */
  needsRebase: boolean;
  trackers: PinchTracker[];
};

const MAX_TRACKED_HANDS = 4;

function createTracker(): PinchTracker {
  return {
    key: null,
    handedness: null,
    closed: false,
    armed: true,
    seen: false,
    ambiguous: false,
    x: 0,
    y: 0,
    z: 0,
  };
}

export function createGrabState(
  origin: Vector3 = { x: 0, y: 0, z: 0 },
  config: GrabConfig = grabConfig,
): GrabState {
  const trackers: PinchTracker[] = [];
  for (let index = 0; index < MAX_TRACKED_HANDS; index += 1) {
    trackers.push(createTracker());
  }

  return {
    config,
    phase: "idle",
    grabKey: null,
    grabHandedness: null,
    started: false,
    ended: false,
    desiredOrigin: { x: origin.x, y: origin.y, z: origin.z },
    suspendAttractor: false,
    candidateKey: null,
    candidateFrames: 0,
    openFrames: 0,
    lostTime: 0,
    offset: { x: 0, y: 0, z: 0 },
    lastPinch: { x: 0, y: 0, z: 0 },
    needsRebase: false,
    trackers,
  };
}

/**
 * Moves the resting origin from outside (for example a "recenter" action).
 * A live grab continues from the new origin without a jump.
 */
export function resetGrabOrigin(state: GrabState, origin: Vector3): void {
  state.desiredOrigin.x = origin.x;
  state.desiredOrigin.y = origin.y;
  state.desiredOrigin.z = origin.z;

  if (state.phase === "grabbing") {
    state.needsRebase = true;
  }
}

function findTracker(state: GrabState, key: string | null): PinchTracker | null {
  if (key === null) {
    return null;
  }

  for (const tracker of state.trackers) {
    if (tracker.key === key) {
      return tracker;
    }
  }

  return null;
}

function isUsable(sample: HandInteractionSample): boolean {
  const point = sample.pinchPoint;

  return (
    sample.valid &&
    Number.isFinite(sample.pinchRatio) &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z)
  );
}

function updateTrackers(
  state: GrabState,
  samples: readonly HandInteractionSample[],
): void {
  const { config } = state;

  for (const tracker of state.trackers) {
    tracker.seen = false;
    tracker.ambiguous = false;
  }

  for (const sample of samples) {
    if (!isUsable(sample)) {
      continue;
    }

    let tracker = findTracker(state, sample.key);

    if (tracker === null) {
      for (const candidate of state.trackers) {
        if (candidate.key === null) {
          tracker = candidate;
          break;
        }
      }

      if (tracker === null) {
        continue;
      }

      tracker.key = sample.key;
      tracker.closed = false;
      tracker.armed = true;
    }

    if (tracker.seen) {
      tracker.ambiguous = true;
      continue;
    }

    tracker.seen = true;
    tracker.handedness = sample.handedness;
    tracker.x = sample.pinchPoint.x;
    tracker.y = sample.pinchPoint.y;
    tracker.z = sample.pinchPoint.z;
    tracker.closed = nextPinchClosed(
      tracker.closed,
      sample.pinchRatio,
      config.pinchCloseBelow,
      config.pinchOpenAbove,
    );

    if (!tracker.closed) {
      tracker.armed = true;
    }
  }

  // Forget hands that disappeared, except the one currently holding the grab.
  for (const tracker of state.trackers) {
    if (tracker.key === null || tracker.seen) {
      continue;
    }

    const holdsGrab =
      state.phase === "grabbing" && tracker.key === state.grabKey;

    if (!holdsGrab) {
      tracker.key = null;
    }
  }
}

function clearCandidate(state: GrabState): void {
  state.candidateKey = null;
  state.candidateFrames = 0;
}

function releaseGrab(state: GrabState, tracker: PinchTracker | null, forced: boolean): void {
  // After a forced release the hand must be seen open before it can grab again.
  if (forced && tracker !== null) {
    tracker.armed = false;
  }

  state.phase = "idle";
  state.ended = true;
  state.suspendAttractor = false;
  state.grabKey = null;
  state.grabHandedness = null;
  state.openFrames = 0;
  state.lostTime = 0;
  state.needsRebase = false;
  clearCandidate(state);
}

function beginGrab(
  state: GrabState,
  tracker: PinchTracker,
  formationOrigin: Vector3,
): void {
  state.phase = "grabbing";
  state.started = true;
  state.suspendAttractor = true;
  state.grabKey = tracker.key;
  state.grabHandedness = tracker.handedness;
  state.openFrames = 0;
  state.lostTime = 0;
  state.needsRebase = false;
  clearCandidate(state);

  state.offset.x = formationOrigin.x - tracker.x;
  state.offset.y = formationOrigin.y - tracker.y;
  state.offset.z = formationOrigin.z - tracker.z;
  state.lastPinch.x = tracker.x;
  state.lastPinch.y = tracker.y;
  state.lastPinch.z = tracker.z;
  state.desiredOrigin.x = formationOrigin.x;
  state.desiredOrigin.y = formationOrigin.y;
  state.desiredOrigin.z = formationOrigin.z;
}

function stepSearching(state: GrabState, formationOrigin: Vector3): void {
  const { config } = state;
  const radiusSquared = config.grabRadius * config.grabRadius;
  let best: PinchTracker | null = null;
  let bestDistance = Infinity;

  for (const tracker of state.trackers) {
    if (
      tracker.key === null ||
      !tracker.seen ||
      tracker.ambiguous ||
      !tracker.closed ||
      !tracker.armed
    ) {
      continue;
    }

    const dx = tracker.x - formationOrigin.x;
    const dy = tracker.y - formationOrigin.y;
    const distance = dx * dx + dy * dy;

    if (distance <= radiusSquared && distance < bestDistance) {
      best = tracker;
      bestDistance = distance;
    }
  }

  if (best === null) {
    state.phase = "idle";
    clearCandidate(state);
    return;
  }

  if (best.key === state.candidateKey) {
    state.candidateFrames += 1;
  } else {
    state.candidateKey = best.key;
    state.candidateFrames = 1;
  }

  if (state.candidateFrames >= config.startFrames) {
    beginGrab(state, best, formationOrigin);
  } else {
    state.phase = "candidate";
  }
}

function stepGrabbing(state: GrabState, delta: number): void {
  const { config } = state;
  const holder = findTracker(state, state.grabKey);

  // Hands that are already pinching while another hand holds the formation
  // must open before they may start a grab of their own.
  for (const tracker of state.trackers) {
    if (tracker !== holder && tracker.key !== null && tracker.closed) {
      tracker.armed = false;
    }
  }

  const usable = holder !== null && holder.seen && !holder.ambiguous;

  if (!usable) {
    state.lostTime += delta;
    state.needsRebase = true;

    if (state.lostTime > config.graceSeconds) {
      releaseGrab(state, holder, false);
    }
    return;
  }

  if (
    holder.handedness !== null &&
    state.grabHandedness !== null &&
    holder.handedness !== state.grabHandedness
  ) {
    releaseGrab(state, holder, true);
    return;
  }

  // The same key must reappear near where it was, otherwise it may be a
  // different hand that inherited the identity.
  const gap = delta + state.lostTime;
  const limit = config.continuityRadius + config.continuitySpeed * gap;
  const dx = holder.x - state.lastPinch.x;
  const dy = holder.y - state.lastPinch.y;

  if (dx * dx + dy * dy > limit * limit) {
    releaseGrab(state, holder, true);
    return;
  }

  state.lostTime = 0;
  state.lastPinch.x = holder.x;
  state.lastPinch.y = holder.y;
  state.lastPinch.z = holder.z;

  if (!holder.closed) {
    // Opening: the formation stays where it is until release is confirmed.
    state.openFrames += 1;
    state.needsRebase = true;

    if (state.openFrames >= config.releaseFrames) {
      releaseGrab(state, holder, false);
    }
    return;
  }

  state.openFrames = 0;

  if (state.needsRebase) {
    state.offset.x = state.desiredOrigin.x - holder.x;
    state.offset.y = state.desiredOrigin.y - holder.y;
    state.offset.z = state.desiredOrigin.z - holder.z;
    state.needsRebase = false;
  }

  state.desiredOrigin.x = holder.x + state.offset.x;
  state.desiredOrigin.y = holder.y + state.offset.y;
  state.desiredOrigin.z = holder.z + state.offset.z;
}

/**
 * Refreshes the per-hand pinch memory from `samples` without advancing the
 * state machine. Used while another interaction (the two-hand transform)
 * owns the formation, so a hand can be handed back with up-to-date pinch
 * state. Idempotent for the same samples.
 */
export function observeHands(
  state: GrabState,
  samples: readonly HandInteractionSample[],
): void {
  updateTrackers(state, samples);
}

/**
 * Starts a grab for `key` right now, without the usual start frames: the
 * caller already knows that hand is deliberately pinching (it was one of the
 * hands of a two-hand transform). Call `observeHands` first so the hand's
 * position is current. The formation origin is kept, so nothing jumps.
 * Returns false (and changes nothing) when that hand is not a usable, closed
 * pinch this frame.
 */
export function adoptGrab(
  state: GrabState,
  key: string,
  formationOrigin: Vector3,
): boolean {
  const tracker = findTracker(state, key);

  if (
    tracker === null ||
    !tracker.seen ||
    tracker.ambiguous ||
    !tracker.closed
  ) {
    return false;
  }

  beginGrab(state, tracker, formationOrigin);
  return true;
}

/**
 * Stops a live grab or pending candidate without disarming any hand, because
 * another interaction is taking the formation over. The desired origin keeps
 * its value.
 */
export function cancelGrab(state: GrabState): void {
  if (state.phase === "grabbing") {
    releaseGrab(state, null, false);
    return;
  }

  state.phase = "idle";
  clearCandidate(state);
}

/**
 * Advances the grab state machine by one frame. Pure and deterministic: the
 * result depends only on the state, the samples, `delta`, and the current
 * formation origin. Call it once per frame.
 */
export function stepGrab(
  state: GrabState,
  samples: readonly HandInteractionSample[],
  delta: number,
  formationOrigin: Vector3,
): void {
  const frameDelta = Number.isFinite(delta) && delta > 0 ? delta : 0;

  state.started = false;
  state.ended = false;

  updateTrackers(state, samples);

  if (state.phase === "grabbing") {
    stepGrabbing(state, frameDelta);
    return;
  }

  stepSearching(state, formationOrigin);
}
