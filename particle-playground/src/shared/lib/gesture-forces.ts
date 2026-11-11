import {
  gestureForceConfig,
  type GestureForceConfig,
} from "@/shared/lib/gesture-force-config";
import { nextPinchClosed } from "@/shared/lib/grab-pinch";
import type { HandInteractionSample } from "@/shared/types/hand-interaction";

/**
 * Turns the hands' raw gestures into force fields, in world space.
 *
 * Open palm repels, fist attracts, everything else does nothing. Each hand
 * is independent. The raw gesture comes from the existing detector (carried
 * on the interaction samples); this module only adds stability:
 *
 *  - a new gesture must be read for `confirmSeconds` before it acts, and an
 *    active one survives `releaseSeconds` of disagreement, so a one-frame
 *    misclassification neither starts nor stops a force;
 *  - a force fades in and out (`attackRate`, `releaseRate`) instead of
 *    switching, and restarts from zero when the hand changes from one force
 *    to the other, so the push never flips sign in a single frame;
 *  - a hand that is pinching (pinch-ratio hysteresis, the same thresholds as
 *    the grab) or that is part of a grab or two-hand transform has no force
 *    at all, cut on the very frame it happens, and must read its gesture
 *    again afterwards: nothing stale survives a pinch. The classifier's raw
 *    `"pinch"` label is ignored here so a tight fist cannot cut attraction
 *    before the ratio hysteresis agrees;
 *  - a missing or invalid hand is tolerated for `lossGraceSeconds` (the force
 *    fades; memory stays so a quick return does not need a full reconfirm).
 *    After the grace the track is forgotten. Ambiguous keys still cut at once.
 *
 * Pure and three-free. Nothing here allocates after construction.
 */

export type GestureForceKind = "repel" | "attract";

type StableGesture = "none" | "open_palm" | "closed_fist";

type Track = {
  key: string | null;
  seen: boolean;
  ambiguous: boolean;
  /** Pinch hysteresis memory. */
  pinchClosed: boolean;
  /** The gesture that currently acts (after confirmation). */
  stable: StableGesture;
  /** What the hand reads as now, if different from `stable`. */
  candidate: StableGesture;
  /** Seconds `candidate` has been read without interruption. */
  candidateTime: number;
  kind: GestureForceKind;
  /** 0..1 fade of the force. */
  strength: number;
  /** Smoothed palm position (world). */
  x: number;
  y: number;
  z: number;
  /** The position has been placed since the hand last appeared. */
  placed: boolean;
  /** Seconds without a usable sample while this track still exists. */
  absentTime: number;
};

/** One output force field in world space. Reused every frame. */
export type WorldForce = {
  key: string;
  kind: GestureForceKind;
  /** Fade 0..1 (never 0 for a listed force). Scale by the configured peak. */
  strength: number;
  x: number;
  y: number;
  z: number;
};

export type GestureForceState = {
  config: GestureForceConfig;
  /** The first `count` entries are the active forces of the latest step. */
  forces: WorldForce[];
  count: number;
  tracks: Track[];
};

const MAX_TRACKED_HANDS = 4;

function createTrack(): Track {
  return {
    key: null,
    seen: false,
    ambiguous: false,
    pinchClosed: false,
    stable: "none",
    candidate: "none",
    candidateTime: 0,
    kind: "repel",
    strength: 0,
    x: 0,
    y: 0,
    z: 0,
    placed: false,
    absentTime: 0,
  };
}

function resetTrack(track: Track): void {
  track.key = null;
  track.seen = false;
  track.ambiguous = false;
  track.pinchClosed = false;
  track.absentTime = 0;
  cutForce(track);
}

/** Drops the force and all gesture memory of a hand, keeping its identity. */
function cutForce(track: Track): void {
  track.stable = "none";
  track.candidate = "none";
  track.candidateTime = 0;
  track.strength = 0;
  track.placed = false;
  track.absentTime = 0;
}

export function createGestureForceState(
  config: GestureForceConfig = gestureForceConfig,
): GestureForceState {
  const tracks: Track[] = [];
  const forces: WorldForce[] = [];

  for (let index = 0; index < MAX_TRACKED_HANDS; index += 1) {
    tracks.push(createTrack());
    forces.push({ key: "", kind: "repel", strength: 0, x: 0, y: 0, z: 0 });
  }

  return { config, forces, count: 0, tracks };
}

/** Removes every force and forgets every hand (camera off, unmount). */
export function clearGestureForces(state: GestureForceState): void {
  for (const track of state.tracks) {
    resetTrack(track);
  }

  state.count = 0;
}

function findTrack(state: GestureForceState, key: string): Track | null {
  for (const track of state.tracks) {
    if (track.key === key) {
      return track;
    }
  }

  return null;
}

function claimTrack(state: GestureForceState, key: string): Track | null {
  const existing = findTrack(state, key);

  if (existing !== null) {
    return existing;
  }

  for (const track of state.tracks) {
    if (track.key === null) {
      track.key = key;
      return track;
    }
  }

  return null;
}

function isUsable(sample: HandInteractionSample): boolean {
  const palm = sample.palmPoint;

  return (
    sample.valid &&
    Number.isFinite(sample.pinchRatio) &&
    palm !== undefined &&
    Number.isFinite(palm.x) &&
    Number.isFinite(palm.y) &&
    Number.isFinite(palm.z)
  );
}

/** What a raw gesture means for forces. Anything else is "none". */
function readGesture(sample: HandInteractionSample): StableGesture {
  return sample.gesture === "open_palm" || sample.gesture === "closed_fist"
    ? sample.gesture
    : "none";
}

function isParticipant(
  key: string,
  participants: readonly (string | null)[],
): boolean {
  for (const participant of participants) {
    if (participant === key) {
      return true;
    }
  }

  return false;
}

function stepGesture(
  track: Track,
  reading: StableGesture,
  step: number,
  config: GestureForceConfig,
): void {
  if (reading === track.stable) {
    track.candidate = track.stable;
    track.candidateTime = 0;
  } else {
    if (reading === track.candidate) {
      track.candidateTime += step;
    } else {
      track.candidate = reading;
      track.candidateTime = step;
    }

    // Entering a force gesture takes the confirm time; dropping one takes the
    // (longer) release time.
    const needed = reading === "none" ? config.releaseSeconds : config.confirmSeconds;

    if (track.candidateTime >= needed - 1e-9) {
      track.stable = reading;
      track.candidate = reading;
      track.candidateTime = 0;

      if (reading !== "none") {
        const kind: GestureForceKind =
          reading === "open_palm" ? "repel" : "attract";

        if (kind !== track.kind) {
          // Switching between push and pull restarts from zero.
          track.strength = 0;
        }

        track.kind = kind;
      }
    }
  }

  const rising = track.stable !== "none";

  track.strength = rising
    ? Math.min(1, track.strength + config.attackRate * step)
    : Math.max(0, track.strength - config.releaseRate * step);
}

function followPalm(
  track: Track,
  sample: HandInteractionSample,
  step: number,
  config: GestureForceConfig,
): void {
  const palm = sample.palmPoint;

  if (!track.placed) {
    track.x = palm.x;
    track.y = palm.y;
    track.z = palm.z;
    track.placed = true;
    return;
  }

  const alpha = 1 - Math.exp(-config.positionSmoothing * step);

  track.x += (palm.x - track.x) * alpha;
  track.y += (palm.y - track.y) * alpha;
  track.z += (palm.z - track.z) * alpha;
}

/**
 * Advances every hand's gesture and rebuilds `state.forces` for this frame.
 *
 * `participants` lists the hand keys that currently belong to a grab or a
 * two-hand transform (null entries are ignored). Those hands get no force.
 * Call it once per frame with the latest interaction samples; an empty list
 * (camera off, stale detection) clears everything.
 */
export function stepGestureForces(
  state: GestureForceState,
  samples: readonly HandInteractionSample[],
  delta: number,
  participants: readonly (string | null)[],
): void {
  const { config } = state;
  const step = Math.min(
    Number.isFinite(delta) && delta > 0 ? delta : 0,
    config.maxStepSeconds,
  );

  for (const track of state.tracks) {
    track.seen = false;
    track.ambiguous = false;
  }

  for (const sample of samples) {
    if (!isUsable(sample)) {
      continue;
    }

    const track = claimTrack(state, sample.key);

    if (track === null) {
      continue;
    }

    if (track.seen) {
      track.ambiguous = true;
      continue;
    }

    track.seen = true;
    track.absentTime = 0;
    track.pinchClosed = nextPinchClosed(
      track.pinchClosed,
      sample.pinchRatio,
      config.pinchCloseBelow,
      config.pinchOpenAbove,
    );

    // Pinch authority is the shared ratio hysteresis only — not the classifier
    // label — so a fist whose tips briefly meet still attracts until the ratio
    // closes.
    const blocked =
      track.pinchClosed || isParticipant(sample.key, participants);

    if (blocked) {
      cutForce(track);
      continue;
    }

    followPalm(track, sample, step, config);
    stepGesture(track, readGesture(sample), step, config);
  }

  let count = 0;

  for (const track of state.tracks) {
    if (track.key === null) {
      continue;
    }

    if (track.ambiguous) {
      // Two samples claim the same key: nothing to trust.
      resetTrack(track);
      continue;
    }

    if (!track.seen) {
      track.absentTime += step;

      if (track.absentTime > config.lossGraceSeconds) {
        resetTrack(track);
        continue;
      }

      // Brief detector drop: the emitted force fades, but gesture memory stays
      // so a return within the grace does not need a full reconfirm.
      track.strength = Math.max(0, track.strength - config.releaseRate * step);
    }

    if (track.strength <= 0) {
      continue;
    }

    const force = state.forces[count];

    force.key = track.key;
    force.kind = track.kind;
    force.strength = track.strength;
    force.x = track.x;
    force.y = track.y;
    force.z = track.z;
    count += 1;
  }

  state.count = count;
}
