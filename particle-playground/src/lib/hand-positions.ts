import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { particleConfig } from "@/components/particles/particle-config";
import { isIndexPointing } from "@/lib/gesture-detection";
import type {
  GestureName,
  Handedness,
  Landmark,
  TrackedHand,
} from "@/types/hand-tracking";

/**
 * Frame-rate-independent follow rate for each hand.
 * Larger values catch the detected position sooner.
 * Uses the same exponential smoothing as the particle pointer.
 */
export const HAND_POSITION_SMOOTHING = 8;

/** MediaPipe index fingertip. */
export const INDEX_FINGERTIP = 8;

const IDENTITY_MATCH_DISTANCE = 0.35;

export type HandPositionSample = {
  key: string;
  handedness: Handedness | null;
  gesture: GestureName;
  /** Smoothed wrist position in the particle interaction space. */
  position: Vector3;
  /** Smoothed index fingertip. Live only while `hasFingertip` is true. */
  fingertip: Vector3;
  hasFingertip: boolean;
  /** Index is extended and the other fingers are curled. */
  painting: boolean;
};

export type HandPositionView = {
  mirrored: boolean;
  aspect: number;
};

type HandSlot = {
  key: string;
  normX: number;
  normY: number;
  raw: Vector3;
  smoothed: Vector3;
  fingertipRaw: Vector3;
  fingertipSmoothed: Vector3;
  active: boolean;
  seen: boolean;
  sample: HandPositionSample;
};

export type HandPositionState = {
  camera: PerspectiveCamera;
  raycaster: Raycaster;
  pointer: Vector2;
  plane: Plane;
  worldWidth: number;
  aspect: number;
  slots: HandSlot[];
  unlabeled: HandSlot[];
  samples: HandPositionSample[];
};

export function createHandPositionState(): HandPositionState {
  const camera = new PerspectiveCamera(
    particleConfig.cameraFov,
    1,
    0.1,
    1000,
  );
  camera.position.set(0, 0, particleConfig.cameraZ);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const left = createSlot("Left");
  const right = createSlot("Right");
  const unlabeled = [createSlot("hand-0"), createSlot("hand-1")];

  return {
    camera,
    raycaster: new Raycaster(),
    pointer: new Vector2(),
    plane: new Plane(new Vector3(0, 0, 1), 0),
    worldWidth: viewWidth(1),
    aspect: 1,
    slots: [left, right, unlabeled[0], unlabeled[1]],
    unlabeled,
    samples: [],
  };
}

export function stepHandPositions(
  state: HandPositionState,
  hands: readonly TrackedHand[],
  delta: number,
  view: HandPositionView,
): void {
  syncCamera(state, view.aspect);

  for (const slot of state.slots) {
    slot.seen = false;
  }

  for (const hand of hands) {
    const slot = claimSlot(state, hand);
    if (!slot) {
      continue;
    }
    followHand(state, slot, hand, delta, view.mirrored);
  }

  state.samples.length = 0;
  for (const slot of state.slots) {
    if (!slot.seen) {
      slot.active = false;
      slot.sample.hasFingertip = false;
      slot.sample.painting = false;
      continue;
    }
    state.samples.push(slot.sample);
  }
}

function followHand(
  state: HandPositionState,
  slot: HandSlot,
  hand: TrackedHand,
  delta: number,
  mirrored: boolean,
): void {
  if (!mapLandmark(state, hand.position, mirrored, slot.raw)) {
    slot.seen = false;
    return;
  }

  const appeared = !slot.active;
  smoothPoint(slot.raw, slot.smoothed, appeared, delta);

  const fingertip = hand.landmarks[INDEX_FINGERTIP];
  if (fingertip && mapLandmark(state, fingertip, mirrored, slot.fingertipRaw)) {
    smoothPoint(slot.fingertipRaw, slot.fingertipSmoothed, appeared, delta);
    slot.sample.hasFingertip = true;
  } else {
    slot.sample.hasFingertip = false;
  }

  slot.sample.painting =
    slot.sample.hasFingertip && isIndexPointing(hand.landmarks);
  slot.active = true;
  slot.normX = hand.position.x;
  slot.normY = hand.position.y;
  slot.sample.handedness = hand.handedness;
  slot.sample.gesture = hand.gesture;
}

function mapLandmark(
  state: HandPositionState,
  landmark: Landmark,
  mirrored: boolean,
  target: Vector3,
): Vector3 | null {
  const x = mirrored ? 1 - landmark.x : landmark.x;
  state.pointer.set(x * 2 - 1, 1 - landmark.y * 2);
  state.raycaster.setFromCamera(state.pointer, state.camera);

  const hit = state.raycaster.ray.intersectPlane(state.plane, target);
  if (!hit) {
    return null;
  }

  target.z = -landmark.z * state.worldWidth;
  return target;
}

function smoothPoint(
  raw: Vector3,
  smoothed: Vector3,
  appeared: boolean,
  delta: number,
): void {
  if (appeared) {
    smoothed.copy(raw);
    return;
  }

  const alpha = 1 - Math.exp(-HAND_POSITION_SMOOTHING * delta);
  smoothed.lerp(raw, alpha);
}

function claimSlot(state: HandPositionState, hand: TrackedHand): HandSlot | null {
  if (hand.handedness === "Left") {
    state.slots[0].seen = true;
    return state.slots[0];
  }
  if (hand.handedness === "Right") {
    state.slots[1].seen = true;
    return state.slots[1];
  }

  let best: HandSlot | null = null;
  let bestDistance = IDENTITY_MATCH_DISTANCE;

  for (const slot of state.unlabeled) {
    if (slot.seen || !slot.active) {
      continue;
    }
    const distance = Math.hypot(slot.normX - hand.position.x, slot.normY - hand.position.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = slot;
    }
  }

  if (best) {
    best.seen = true;
    return best;
  }

  const fresh = state.unlabeled.find((slot) => !slot.seen);
  if (!fresh) {
    return null;
  }
  fresh.seen = true;
  return fresh;
}

function syncCamera(state: HandPositionState, aspect: number): void {
  const nextAspect = aspect > 0 ? aspect : 1;
  if (nextAspect === state.aspect) {
    return;
  }

  state.aspect = nextAspect;
  state.camera.aspect = nextAspect;
  state.camera.updateProjectionMatrix();
  state.worldWidth = viewWidth(nextAspect);
}

function viewWidth(aspect: number): number {
  const halfAngle = (particleConfig.cameraFov * Math.PI) / 360;
  return Math.tan(halfAngle) * particleConfig.cameraZ * 2 * aspect;
}

function createSlot(key: string): HandSlot {
  const smoothed = new Vector3();
  const fingertipSmoothed = new Vector3();
  return {
    key,
    normX: 0,
    normY: 0,
    raw: new Vector3(),
    smoothed,
    fingertipRaw: new Vector3(),
    fingertipSmoothed,
    active: false,
    seen: false,
    sample: {
      key,
      handedness: null,
      gesture: "none",
      position: smoothed,
      fingertip: fingertipSmoothed,
      hasFingertip: false,
      painting: false,
    },
  };
}
