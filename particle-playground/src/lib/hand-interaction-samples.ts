import { Vector3, type Camera } from "three";
import { measurePinchRatio } from "@/lib/grab-pinch";
import { handWorldConfig, type ActiveRegion } from "@/lib/hand-world-config";
import {
  createHandWorldMapper,
  mapFrameToWorld,
  type HandWorldMapper,
} from "@/lib/map-hand-to-world";
import type { HandInteractionSample } from "@/types/hand-interaction";
import type { Landmark, TrackedHand } from "@/types/hand-tracking";

const THUMB_TIP = 4;
const INDEX_TIP = 8;
/** Largest landmark index the pinch measurement reads (middle MCP). */
const REQUIRED_LANDMARKS = 10;
/** Wrist and the index, middle, ring, and pinky knuckles: the palm's corners. */
const PALM_LANDMARKS = [0, 5, 9, 13, 17] as const;
/** Normalized wrist distance within which an unlabeled hand keeps its key. */
const IDENTITY_MATCH_DISTANCE = 0.35;

/** What the builder needs to know about the camera frame the landmarks came from. */
export type HandInteractionFrame = {
  /** The preview is shown mirrored (selfie view). */
  mirrored: boolean;
  /**
   * Source frame width / height (`videoWidth / videoHeight`). Landmarks are
   * normalized per axis, so this restores equal units for the pinch ratio.
   * Values that are not positive fall back to 1.
   */
  aspect: number;
};

type Slot = {
  active: boolean;
  seen: boolean;
  /** Last wrist position, used to keep unlabeled hands apart. */
  wristX: number;
  wristY: number;
  point: Vector3;
  /** World-space palm centre, shared with `sample.palmPoint`. */
  palm: Vector3;
  sample: HandInteractionSample;
};

export type HandInteractionBuilder = {
  mapper: HandWorldMapper;
  /** Left, Right, then two slots for hands without a usable label. */
  slots: Slot[];
  unlabeled: Slot[];
  /** Reused every call; holds the samples of the most recent build. */
  samples: HandInteractionSample[];
};

export function createHandInteractionBuilder(): HandInteractionBuilder {
  const left = createSlot("Left");
  const right = createSlot("Right");
  const unlabeled = [createSlot("hand-0"), createSlot("hand-1")];

  return {
    mapper: createHandWorldMapper(),
    slots: [left, right, unlabeled[0], unlabeled[1]],
    unlabeled,
    samples: [],
  };
}

/** Forgets every hand and empties the sample list. */
export function resetHandInteractionBuilder(builder: HandInteractionBuilder): void {
  builder.samples.length = 0;
  for (const slot of builder.slots) {
    slot.active = false;
    slot.seen = false;
    slot.sample.valid = false;
    slot.sample.gesture = "none";
  }
}

/**
 * Turns tracked hands into interaction samples for the world seen by `camera`.
 *
 * Coordinate assumptions:
 * - Landmark x/y are normalized to the source video frame (0..1, y downward).
 * - `frame.mirrored` says whether the preview the user watches is flipped;
 *   x is flipped before mapping so moving a hand right moves the world right.
 * - The pinch anchor is the midpoint of the thumb tip (4) and index tip (8),
 *   mapped through the active region onto the z = 0 interaction plane.
 *
 * A hand whose landmarks cannot be measured still yields a sample (so its key
 * is accounted for) but with `valid: false`. Returns `builder.samples`.
 */
export function buildHandInteractionSamples(
  builder: HandInteractionBuilder,
  hands: readonly TrackedHand[],
  camera: Camera,
  frame: HandInteractionFrame,
  region: ActiveRegion = handWorldConfig.region,
): readonly HandInteractionSample[] {
  for (const slot of builder.slots) {
    slot.seen = false;
  }

  builder.samples.length = 0;

  for (const hand of hands) {
    const slot = claimSlot(builder, hand);
    if (!slot) {
      continue;
    }

    fillSample(builder, slot, hand, camera, frame, region);
    builder.samples.push(slot.sample);
  }

  for (const slot of builder.slots) {
    if (!slot.seen) {
      slot.active = false;
      slot.sample.valid = false;
      slot.sample.gesture = "none";
    }
  }

  return builder.samples;
}

function fillSample(
  builder: HandInteractionBuilder,
  slot: Slot,
  hand: TrackedHand,
  camera: Camera,
  frame: HandInteractionFrame,
  region: ActiveRegion,
): void {
  const { sample } = slot;
  const landmarks = hand.landmarks;

  sample.handedness = hand.handedness;
  sample.valid = false;
  sample.pinchRatio = Number.NaN;
  sample.gesture = "none";

  const wrist = landmarks[0];
  if (isFinitePoint(wrist)) {
    slot.wristX = wrist.x;
    slot.wristY = wrist.y;
    slot.active = true;
  }

  const thumb = landmarks[THUMB_TIP];
  const index = landmarks[INDEX_TIP];
  if (
    landmarks.length < REQUIRED_LANDMARKS ||
    !isFinitePoint(thumb) ||
    !isFinitePoint(index)
  ) {
    return;
  }

  const aspect = frame.aspect > 0 && Number.isFinite(frame.aspect) ? frame.aspect : 1;
  const ratio = measurePinchRatio(landmarks, aspect);
  if (!Number.isFinite(ratio)) {
    return;
  }

  const mapped = mapFrameToWorld(
    builder.mapper,
    camera,
    (thumb.x + index.x) / 2,
    (thumb.y + index.y) / 2,
    frame.mirrored,
    slot.point,
    region,
  );
  if (!mapped) {
    return;
  }

  sample.pinchRatio = ratio;
  sample.valid = true;

  // The raw gesture is only usable together with a placeable palm centre.
  if (
    hand.gesture !== "none" &&
    mapPalm(builder, slot, landmarks, camera, frame.mirrored, region)
  ) {
    sample.gesture = hand.gesture;
  }
}

/**
 * Maps the palm centre (mean of the wrist and the four finger knuckles) into
 * `slot.palmPoint`. Returns false when a landmark is missing or the ray
 * misses the interaction plane.
 */
function mapPalm(
  builder: HandInteractionBuilder,
  slot: Slot,
  landmarks: readonly Landmark[],
  camera: Camera,
  mirrored: boolean,
  region: ActiveRegion,
): boolean {
  let x = 0;
  let y = 0;

  for (const index of PALM_LANDMARKS) {
    const point = landmarks[index];
    if (!isFinitePoint(point)) {
      return false;
    }

    x += point.x;
    y += point.y;
  }

  return mapFrameToWorld(
    builder.mapper,
    camera,
    x / PALM_LANDMARKS.length,
    y / PALM_LANDMARKS.length,
    mirrored,
    slot.palm,
    region,
  );
}

function isFinitePoint(point: Landmark | undefined): point is Landmark {
  return (
    point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y)
  );
}

/**
 * Labeled hands keep "Left" / "Right". An unlabeled hand, or a second hand
 * that reuses a label already taken this frame, takes the nearest previously
 * active fallback slot, else a free one.
 */
function claimSlot(builder: HandInteractionBuilder, hand: TrackedHand): Slot | null {
  const labeled =
    hand.handedness === "Left"
      ? builder.slots[0]
      : hand.handedness === "Right"
        ? builder.slots[1]
        : null;

  if (labeled && !labeled.seen) {
    labeled.seen = true;
    return labeled;
  }

  const wrist = hand.landmarks[0] ?? hand.position;
  let best: Slot | null = null;
  let bestDistance = IDENTITY_MATCH_DISTANCE;

  if (isFinitePoint(wrist)) {
    for (const slot of builder.unlabeled) {
      if (slot.seen || !slot.active) {
        continue;
      }

      const distance = Math.hypot(slot.wristX - wrist.x, slot.wristY - wrist.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = slot;
      }
    }
  }

  if (!best) {
    for (const slot of builder.unlabeled) {
      if (!slot.seen) {
        best = slot;
        break;
      }
    }
  }

  if (best) {
    best.seen = true;
  }

  return best;
}

function createSlot(key: string): Slot {
  const point = new Vector3();
  const palm = new Vector3();

  return {
    active: false,
    seen: false,
    wristX: 0,
    wristY: 0,
    point,
    palm,
    sample: {
      key,
      handedness: null,
      pinchPoint: point,
      pinchRatio: Number.NaN,
      valid: false,
      gesture: "none",
      palmPoint: palm,
    },
  };
}
