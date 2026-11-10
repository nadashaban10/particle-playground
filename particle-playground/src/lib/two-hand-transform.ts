import { nextPinchClosed } from "@/lib/grab-pinch";
import { twoHandConfig, type TwoHandConfig } from "@/lib/two-hand-config";
import type { Handedness } from "@/types/hand-tracking";
import type { HandInteractionSample } from "@/types/hand-interaction";
import type { Vector3 } from "@/types/particles";

/**
 * Two-hand transform: with both hands pinching, the formation follows the
 * midpoint (translate), the hand distance (scale) and the line between the
 * hands (rotate about Z).
 *
 * Pure and three-free, like the single-hand grab engine. It never touches the
 * group: each frame it is given the group's *current* transform and writes
 * the transform it wants into `desired`. The controller eases the group
 * toward that.
 *
 * Everything is relative to a baseline captured from the current group
 * transform whenever the interaction starts or is re-anchored, so entering
 * the mode never moves the formation.
 */

export type TwoHandPhase = "inactive" | "candidate" | "active";

/** A group transform in world space: position, roll about Z, uniform scale. */
export type TransformSnapshot = {
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: number;
};

type Point2 = { x: number; y: number };

type HandTrack = {
  key: string | null;
  handedness: Handedness | null;
  closed: boolean;
  seen: boolean;
  ambiguous: boolean;
  x: number;
  y: number;
};

/** Per-hand bookkeeping while the transform is active. */
type HandSlot = {
  key: string | null;
  handedness: Handedness | null;
  /** Consecutive frames this hand has been open. */
  openFrames: number;
  /** Seconds this hand has been unusable. */
  lostTime: number;
  lastX: number;
  lastY: number;
  /** Usable and still pinching this frame. */
  engaged: boolean;
  /** Released or lost for good: the interaction is ending. */
  gone: boolean;
};

export type TwoHandBaseline = {
  a: Point2;
  b: Point2;
  mid: Point2;
  /** Hand distance, floored at `minHandDistance`. */
  distance: number;
  /** Angle of the line from hand A to hand B (radians). */
  angle: number;
  position: Vector3;
  rotation: number;
  scale: number;
};

export type TwoHandState = {
  config: TwoHandConfig;
  phase: TwoHandPhase;
  /** True only on the frame the transform began. */
  started: boolean;
  /** True only on the frame the transform ended. */
  ended: boolean;
  /** The end was forced (identity or continuity problem), not a clean release. */
  endedForced: boolean;
  /**
   * On the frame it ended: the key of the hand that is still pinching and can
   * carry on as a single-hand grab. Null when none can.
   */
  remainingKey: string | null;
  /** The two hands, ordered by key, while active. */
  keyA: string | null;
  keyB: string | null;
  /** Live geometry of the two pinches (last good values while a hand is missing). */
  mid: Point2;
  distance: number;
  angle: number;
  baseline: TwoHandBaseline;
  /** Where the formation should be. Holds its last value when inactive. */
  desired: {
    position: Vector3;
    rotation: number;
    scale: number;
  };

  candidateA: string | null;
  candidateB: string | null;
  candidateFrames: number;
  /** desired position minus the midpoint; keeps the formation from jumping. */
  offset: Point2;
  /** Sum of per-frame wrapped angle changes since the baseline. */
  angleAccum: number;
  anglePrev: number;
  anglePrevValid: boolean;
  /** Re-anchor the baseline from the next frame in which both hands pinch. */
  needsRebase: boolean;
  slots: [HandSlot, HandSlot];
  tracks: HandTrack[];
};

const MAX_TRACKED_HANDS = 4;
const TWO_PI = Math.PI * 2;

/** Maps any angle to (-pi, pi]. */
export function wrapAngle(angle: number): number {
  const wrapped = angle - TWO_PI * Math.round(angle / TWO_PI);

  // round() sends exactly +-pi to the same side; keep the result in (-pi, pi].
  return wrapped <= -Math.PI ? wrapped + TWO_PI : wrapped;
}

function createTrack(): HandTrack {
  return {
    key: null,
    handedness: null,
    closed: false,
    seen: false,
    ambiguous: false,
    x: 0,
    y: 0,
  };
}

function createSlot(): HandSlot {
  return {
    key: null,
    handedness: null,
    openFrames: 0,
    lostTime: 0,
    lastX: 0,
    lastY: 0,
    engaged: false,
    gone: false,
  };
}

export function createTransformSnapshot(): TransformSnapshot {
  return { x: 0, y: 0, z: 0, rotation: 0, scale: 1 };
}

export function createTwoHandState(
  config: TwoHandConfig = twoHandConfig,
): TwoHandState {
  const tracks: HandTrack[] = [];
  for (let index = 0; index < MAX_TRACKED_HANDS; index += 1) {
    tracks.push(createTrack());
  }

  return {
    config,
    phase: "inactive",
    started: false,
    ended: false,
    endedForced: false,
    remainingKey: null,
    keyA: null,
    keyB: null,
    mid: { x: 0, y: 0 },
    distance: 0,
    angle: 0,
    baseline: {
      a: { x: 0, y: 0 },
      b: { x: 0, y: 0 },
      mid: { x: 0, y: 0 },
      distance: 1,
      angle: 0,
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      scale: 1,
    },
    desired: { position: { x: 0, y: 0, z: 0 }, rotation: 0, scale: 1 },
    candidateA: null,
    candidateB: null,
    candidateFrames: 0,
    offset: { x: 0, y: 0 },
    angleAccum: 0,
    anglePrev: 0,
    anglePrevValid: false,
    needsRebase: false,
    slots: [createSlot(), createSlot()],
    tracks,
  };
}

/**
 * Moves the formation's desired position from outside (the controller clamps
 * it to the view limits). While active, the offset from the midpoint is
 * recomputed at once, so hands moving back toward the formation take effect
 * immediately instead of first having to travel through the clamped distance.
 * Scale and rotation keep responding, because only the offset changes.
 */
export function resetTwoHandOrigin(state: TwoHandState, origin: Vector3): void {
  state.desired.position.x = origin.x;
  state.desired.position.y = origin.y;
  state.desired.position.z = origin.z;

  if (state.phase === "active") {
    state.offset.x = origin.x - state.mid.x;
    state.offset.y = origin.y - state.mid.y;
  }
}

function findTrack(state: TwoHandState, key: string | null): HandTrack | null {
  if (key === null) {
    return null;
  }

  for (const track of state.tracks) {
    if (track.key === key) {
      return track;
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
    Number.isFinite(point.y)
  );
}

function updateTracks(
  state: TwoHandState,
  samples: readonly HandInteractionSample[],
): void {
  const { config } = state;

  for (const track of state.tracks) {
    track.seen = false;
    track.ambiguous = false;
  }

  for (const sample of samples) {
    if (!isUsable(sample)) {
      continue;
    }

    let track = findTrack(state, sample.key);

    if (track === null) {
      for (const candidate of state.tracks) {
        if (candidate.key === null) {
          track = candidate;
          break;
        }
      }

      if (track === null) {
        continue;
      }

      track.key = sample.key;
      track.closed = false;
    }

    if (track.seen) {
      track.ambiguous = true;
      continue;
    }

    track.seen = true;
    track.handedness = sample.handedness;
    track.x = sample.pinchPoint.x;
    track.y = sample.pinchPoint.y;
    track.closed = nextPinchClosed(
      track.closed,
      sample.pinchRatio,
      config.pinchCloseBelow,
      config.pinchOpenAbove,
    );
  }

  // Forget hands that disappeared, except the two the transform is holding.
  for (const track of state.tracks) {
    if (track.key === null || track.seen) {
      continue;
    }

    const holds =
      state.phase === "active" &&
      (track.key === state.keyA || track.key === state.keyB);

    if (!holds) {
      track.key = null;
    }
  }
}

function clearCandidate(state: TwoHandState): void {
  state.candidateA = null;
  state.candidateB = null;
  state.candidateFrames = 0;
}

function isEligible(track: HandTrack): boolean {
  return (
    track.key !== null && track.seen && !track.ambiguous && track.closed
  );
}

/**
 * Anchors the baseline to the *current* group transform and the hands'
 * current geometry. Everything afterwards is measured against it.
 */
function captureBaseline(
  state: TwoHandState,
  current: TransformSnapshot,
  a: Point2,
  b: Point2,
): void {
  const { baseline, config } = state;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);

  baseline.a.x = a.x;
  baseline.a.y = a.y;
  baseline.b.x = b.x;
  baseline.b.y = b.y;
  baseline.mid.x = (a.x + b.x) / 2;
  baseline.mid.y = (a.y + b.y) / 2;
  baseline.distance = Math.max(distance, config.minHandDistance);
  baseline.angle = Math.atan2(dy, dx);
  baseline.position.x = current.x;
  baseline.position.y = current.y;
  baseline.position.z = current.z;
  baseline.rotation = current.rotation;
  baseline.scale = Math.min(
    config.maxScale,
    Math.max(config.minScale, current.scale),
  );

  state.mid.x = baseline.mid.x;
  state.mid.y = baseline.mid.y;
  state.distance = distance;
  state.angle = baseline.angle;
  state.offset.x = current.x - baseline.mid.x;
  state.offset.y = current.y - baseline.mid.y;
  state.angleAccum = 0;
  state.anglePrev = baseline.angle;
  state.anglePrevValid = distance >= config.minHandDistance;
  state.needsRebase = false;

  state.desired.position.x = current.x;
  state.desired.position.y = current.y;
  state.desired.position.z = current.z;
  state.desired.rotation = current.rotation;
  state.desired.scale = baseline.scale;
}

function activate(
  state: TwoHandState,
  a: HandTrack,
  b: HandTrack,
  current: TransformSnapshot,
): void {
  state.phase = "active";
  state.started = true;
  state.keyA = a.key;
  state.keyB = b.key;
  clearCandidate(state);

  const [slotA, slotB] = state.slots;
  for (const [slot, track] of [
    [slotA, a],
    [slotB, b],
  ] as const) {
    slot.key = track.key;
    slot.handedness = track.handedness;
    slot.openFrames = 0;
    slot.lostTime = 0;
    slot.lastX = track.x;
    slot.lastY = track.y;
    slot.engaged = true;
    slot.gone = false;
  }

  captureBaseline(state, current, a, b);
}

function stepSearching(
  state: TwoHandState,
  current: TransformSnapshot,
  engaged: boolean,
): void {
  const { config } = state;

  // The two eligible hands with the smallest keys: a stable choice, so the
  // same pair is seen frame after frame.
  let first: HandTrack | null = null;
  let second: HandTrack | null = null;

  for (const track of state.tracks) {
    if (!isEligible(track)) {
      continue;
    }

    if (first === null || (track.key as string) < (first.key as string)) {
      second = first;
      first = track;
    } else if (second === null || (track.key as string) < (second.key as string)) {
      second = track;
    }
  }

  if (first === null || second === null) {
    state.phase = "inactive";
    clearCandidate(state);
    return;
  }

  const dx = second.x - first.x;
  const dy = second.y - first.y;

  if (Math.hypot(dx, dy) < config.minHandDistance) {
    state.phase = "inactive";
    clearCandidate(state);
    return;
  }

  if (!engaged) {
    const mx = (first.x + second.x) / 2 - current.x;
    const my = (first.y + second.y) / 2 - current.y;

    if (Math.hypot(mx, my) > config.activationRadius) {
      state.phase = "inactive";
      clearCandidate(state);
      return;
    }
  }

  if (first.key === state.candidateA && second.key === state.candidateB) {
    state.candidateFrames += 1;
  } else {
    state.candidateA = first.key;
    state.candidateB = second.key;
    state.candidateFrames = 1;
  }

  if (state.candidateFrames >= config.startFrames) {
    activate(state, first, second, current);
  } else {
    state.phase = "candidate";
  }
}

function end(state: TwoHandState, forced: boolean, remainingKey: string | null): void {
  state.phase = "inactive";
  state.ended = true;
  state.endedForced = forced;
  state.remainingKey = forced ? null : remainingKey;
  state.keyA = null;
  state.keyB = null;
  state.needsRebase = false;
  clearCandidate(state);
}

/**
 * Updates one hand's slot. Returns true when the hand's identity or motion
 * is not believable and the whole interaction must end.
 */
function updateSlot(
  state: TwoHandState,
  slot: HandSlot,
  delta: number,
): boolean {
  const { config } = state;
  const track = findTrack(state, slot.key);
  const usable = track !== null && track.seen && !track.ambiguous;

  slot.engaged = false;

  if (!usable) {
    slot.lostTime += delta;

    if (slot.lostTime > config.graceSeconds) {
      slot.gone = true;
    }

    return false;
  }

  if (
    track.handedness !== null &&
    slot.handedness !== null &&
    track.handedness !== slot.handedness
  ) {
    return true;
  }

  // The same key must reappear near where it was, otherwise it may be a
  // different hand that inherited the identity.
  const gap = delta + slot.lostTime;
  const limit = config.continuityRadius + config.continuitySpeed * gap;
  const dx = track.x - slot.lastX;
  const dy = track.y - slot.lastY;

  if (dx * dx + dy * dy > limit * limit) {
    return true;
  }

  slot.lostTime = 0;
  slot.lastX = track.x;
  slot.lastY = track.y;

  if (track.closed) {
    slot.openFrames = 0;
    slot.engaged = true;
  } else {
    slot.openFrames += 1;

    if (slot.openFrames >= config.releaseFrames) {
      slot.gone = true;
    }
  }

  return false;
}

function stepActive(
  state: TwoHandState,
  delta: number,
): void {
  const { config } = state;
  const [slotA, slotB] = state.slots;
  const forcedA = updateSlot(state, slotA, delta);
  const forcedB = updateSlot(state, slotB, delta);

  if (forcedA || forcedB) {
    end(state, true, null);
    return;
  }

  if (slotA.gone || slotB.gone) {
    // The hand still pinching, if any, can carry on as a single-hand grab.
    const survivor = slotA.gone ? slotB : slotA;
    const keeps = !survivor.gone && survivor.engaged;

    end(state, false, keeps ? survivor.key : null);
    return;
  }

  if (!slotA.engaged || !slotB.engaged) {
    // A hand is opening or briefly missing: hold, and re-anchor on return.
    state.needsRebase = true;
    return;
  }

  const trackA = findTrack(state, slotA.key) as HandTrack;
  const trackB = findTrack(state, slotB.key) as HandTrack;
  const dx = trackB.x - trackA.x;
  const dy = trackB.y - trackA.y;
  const distance = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const midX = (trackA.x + trackB.x) / 2;
  const midY = (trackA.y + trackB.y) / 2;
  const { baseline, desired } = state;

  state.mid.x = midX;
  state.mid.y = midY;
  state.distance = distance;
  state.angle = angle;

  if (state.needsRebase) {
    // Re-anchor on where the formation is *desired* to be: holding while a
    // hand was opening or missing must not let it jump back.
    baseline.distance = Math.max(distance, config.minHandDistance);
    baseline.angle = angle;
    baseline.position.x = desired.position.x;
    baseline.position.y = desired.position.y;
    baseline.position.z = desired.position.z;
    baseline.rotation = desired.rotation;
    baseline.scale = desired.scale;
    baseline.mid.x = midX;
    baseline.mid.y = midY;
    state.offset.x = desired.position.x - midX;
    state.offset.y = desired.position.y - midY;
    state.angleAccum = 0;
    state.anglePrev = angle;
    state.anglePrevValid = distance >= config.minHandDistance;
    state.needsRebase = false;
  }

  // Translation: the formation keeps its offset from the midpoint.
  desired.position.x = midX + state.offset.x;
  desired.position.y = midY + state.offset.y;

  // Scale: current distance over baseline distance, applied to the baseline
  // scale (never accumulated frame to frame). At a limit the baseline moves
  // with the hands, so reversing responds at once instead of first having
  // to travel back through the part of the gesture that was clamped away.
  const measured = Math.max(distance, config.minHandDistance);
  const raw = (baseline.scale * measured) / baseline.distance;
  const scale = Math.min(config.maxScale, Math.max(config.minScale, raw));

  if (scale !== raw) {
    baseline.scale = scale;
    baseline.distance = measured;
  }

  desired.scale = scale;

  // Rotation: the baseline rotation plus the accumulated change in the angle
  // between the hands. Each frame's change is wrapped into (-pi, pi], so
  // crossing the +-pi boundary is continuous and turns past a half turn keep
  // counting. With the hands almost touching the angle is meaningless: it
  // freezes, and on recovery restarts from the new angle without a jump.
  if (distance >= config.minHandDistance) {
    if (state.anglePrevValid) {
      state.angleAccum += wrapAngle(angle - state.anglePrev);
    }

    state.anglePrev = angle;
    state.anglePrevValid = true;
  } else {
    state.anglePrevValid = false;
  }

  desired.rotation = baseline.rotation + state.angleAccum;
}

/**
 * Advances the two-hand transform by one frame.
 *
 * `current` is the group's transform right now (used to anchor the baseline).
 * `engaged` says a single-hand grab is live, in which case the second hand
 * may join from anywhere; from idle the pinches must start near the
 * formation. Deterministic: the result depends only on the state, the
 * samples, `delta`, `current` and `engaged`.
 */
export function stepTwoHand(
  state: TwoHandState,
  samples: readonly HandInteractionSample[],
  delta: number,
  current: TransformSnapshot,
  engaged: boolean,
): void {
  const frameDelta = Number.isFinite(delta) && delta > 0 ? delta : 0;

  state.started = false;
  state.ended = false;
  state.endedForced = false;
  state.remainingKey = null;

  updateTracks(state, samples);

  if (state.phase === "active") {
    stepActive(state, frameDelta);
    return;
  }

  stepSearching(state, current, engaged);
}
