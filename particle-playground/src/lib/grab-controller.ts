import { Vector3, type Object3D, type PerspectiveCamera } from "three";
import {
  writeLocalForceField,
  type LocalForceField,
} from "@/lib/gesture-force-field";
import {
  createGestureForceState,
  stepGestureForces,
  type GestureForceState,
} from "@/lib/gesture-forces";
import { grabConfig, type GrabConfig } from "@/lib/grab-config";
import {
  adoptGrab,
  cancelGrab,
  createGrabState,
  observeHands,
  resetGrabOrigin,
  stepGrab,
  type GrabState,
} from "@/lib/grab-interaction";
import {
  clampOrigin,
  computeGrabLimits,
  createGrabLimits,
  grabMotionConfig,
  smoothingAlpha,
  transformedExtent,
  type FormationExtent,
  type GrabLimits,
} from "@/lib/grab-motion";
import {
  createGroupSpace,
  worldPointToLocal,
  type GroupSpace,
} from "@/lib/group-space";
import {
  createTransformSnapshot,
  createTwoHandState,
  resetTwoHandOrigin,
  stepTwoHand,
  type TransformSnapshot,
  type TwoHandState,
} from "@/lib/two-hand-transform";
import type { HandInteractionSample } from "@/types/hand-interaction";
import type { Vector3 as Point } from "@/types/particles";

export type GrabHint = "none" | "near" | "held";

/** Which hand interaction currently owns the formation. */
export type GrabMode = "none" | "one" | "two";

/** What the rest of the scene reads each frame. Mutated in place, never replaced. */
export type GrabView = {
  /** A grab owns the formation: the pointer attractor should pause. */
  holding: boolean;
  hint: GrabHint;
  /** Where to draw the hint (the pinch point of the nearest or holding hand). */
  hintPoint: Point;
  /** One hand grabbing, two hands transforming, or neither. */
  mode: GrabMode;
};

export function createGrabView(): GrabView {
  return {
    holding: false,
    hint: "none",
    hintPoint: { x: 0, y: 0, z: 0 },
    mode: "none",
  };
}

export type GrabController = {
  grab: GrabState;
  two: TwoHandState;
  /**
   * Translation limits for the current formation and camera. With a `camera`
   * they are recomputed every frame from the formation's transformed extent;
   * without one the caller sets them.
   */
  limits: GrabLimits;
  space: GroupSpace;
  /** Roll and scale the group is easing toward. Persist after a release. */
  target: { rotation: number; scale: number };
  /** When set, limits follow the camera and the formation's scale and rotation. */
  camera: PerspectiveCamera | null;
  /** Half-size of the current formation in its own units (used with `camera`). */
  extent: FormationExtent;
  /** Scratch: `extent` after scale and rotation. */
  effective: FormationExtent;
  /** Scratch: the group's transform at the start of the frame. */
  current: TransformSnapshot;
  /** Open-palm / fist force fields (world space), one per free hand. */
  forces: GestureForceState;
  /** Scratch: keys of the hands that belong to a grab or a two-hand transform. */
  participants: (string | null)[];
  /** Scratch for converting gesture positions into the group's space. */
  forceScratch: Vector3;
};

export function createGrabController(
  config: GrabConfig = grabConfig,
): GrabController {
  return {
    grab: createGrabState({ x: 0, y: 0, z: 0 }, config),
    two: createTwoHandState(),
    limits: createGrabLimits(),
    space: createGroupSpace(),
    target: { rotation: 0, scale: 1 },
    camera: null,
    extent: { x: 0, y: 0, z: 0 },
    effective: { x: 0, y: 0, z: 0 },
    current: createTransformSnapshot(),
    forces: createGestureForceState(),
    participants: [null, null, null],
    forceScratch: new Vector3(),
  };
}

/**
 * Tells the controller which camera and formation the limits are for. Call it
 * each frame before `stepGrabController`; the limits are then derived from
 * the extent, the camera, and the group's scale and rotation. With a null
 * camera the limits are left to the caller. Copies the extent, so the shared
 * measurement is never aliased.
 */
export function setGrabBounds(
  controller: GrabController,
  camera: PerspectiveCamera | null,
  extent: FormationExtent,
): void {
  controller.camera = camera;
  controller.extent.x = extent.x;
  controller.extent.y = extent.y;
  controller.extent.z = extent.z;
}

/**
 * Advances hand interaction and moves `group` for one frame.
 *
 * 1. The group's transform is read; the two-hand engine and the single-hand
 *    grab decide who owns the formation. Two pinching hands take over from
 *    a single grab; one hand left of a two-hand transform carries on as a
 *    single grab. Either way the baseline is the group's real transform, so
 *    nothing jumps.
 * 2. The desired position is clamped to the view limits, which account for
 *    the formation's scale and rotation. When clamping changes it, the active
 *    interaction's offset is rebased so hands moving back take effect at once.
 * 3. Position, roll and scale ease toward their targets (delta-time
 *    smoothing). After a release the targets stay put, so the group settles
 *    there and stays.
 * 4. The group's world matrix is refreshed for pointer conversion.
 * 5. Gesture forces: hands that are not part of a grab or a two-hand
 *    transform (and are not pinching) may push or pull nearby particles. The
 *    result is written, in the group's local space, to `field` when given.
 *    This runs last, so the participants are the ones decided this frame, and
 *    it never changes the group or the grab.
 */
export function stepGrabController(
  controller: GrabController,
  group: Object3D,
  samples: readonly HandInteractionSample[],
  delta: number,
  view: GrabView,
  field?: LocalForceField,
): void {
  const { grab, two, target, current, limits } = controller;
  const position = group.position;

  current.x = position.x;
  current.y = position.y;
  current.z = position.z;
  current.rotation = group.rotation.z;
  current.scale = group.scale.x;

  stepTwoHand(two, samples, delta, current, grab.phase === "grabbing");

  if (two.started) {
    // Two hands took over from a single grab: it must not keep fighting them.
    cancelGrab(grab);
  }

  if (two.phase === "active") {
    // The grab engine only watches the hands, so it can take one back later.
    observeHands(grab, samples);
    grab.desiredOrigin.x = two.desired.position.x;
    grab.desiredOrigin.y = two.desired.position.y;
    grab.desiredOrigin.z = two.desired.position.z;
    target.rotation = two.desired.rotation;
    target.scale = two.desired.scale;
  } else {
    if (two.ended && two.remainingKey !== null) {
      observeHands(grab, samples);
      adoptGrab(grab, two.remainingKey, two.desired.position);
    }

    if (two.phase === "candidate" && grab.phase !== "grabbing") {
      // Two hands are about to start a transform: do not let one of them
      // start a single grab in the meantime.
      observeHands(grab, samples);
      cancelGrab(grab);
    } else {
      stepGrab(grab, samples, delta, position);
    }
  }

  if (controller.camera !== null) {
    transformedExtent(
      controller.extent,
      target.rotation,
      Math.max(group.scale.x, target.scale),
      controller.effective,
    );
    computeGrabLimits(controller.camera, controller.effective, limits);
  }

  const desired = grab.desiredOrigin;
  if (clampOrigin(limits, desired)) {
    if (two.phase === "active") {
      resetTwoHandOrigin(two, desired);
    } else {
      resetGrabOrigin(grab, desired);
    }
  }

  const frameDelta = Math.min(
    Number.isFinite(delta) && delta > 0 ? delta : 0,
    grabMotionConfig.maxSmoothingDelta,
  );
  const alpha = smoothingAlpha(grabMotionConfig.followSmoothing, frameDelta);

  position.x = approach(position.x, desired.x, alpha);
  position.y = approach(position.y, desired.y, alpha);
  position.z = approach(position.z, desired.z, alpha);
  group.rotation.z = approach(group.rotation.z, target.rotation, alpha);

  const scale = approach(group.scale.x, target.scale, alpha);
  group.scale.set(scale, scale, scale);

  group.updateMatrixWorld();
  updateView(controller, samples, position, view);
  updateGestureForces(controller, group, samples, delta, field);
}

function updateGestureForces(
  controller: GrabController,
  group: Object3D,
  samples: readonly HandInteractionSample[],
  delta: number,
  field: LocalForceField | undefined,
): void {
  const { grab, two, participants } = controller;

  participants[0] = grab.phase === "grabbing" ? grab.grabKey : null;
  participants[1] = two.phase === "active" ? two.keyA : null;
  participants[2] = two.phase === "active" ? two.keyB : null;

  stepGestureForces(controller.forces, samples, delta, participants);

  if (field) {
    writeLocalForceField(
      controller.forces,
      group,
      controller.space,
      controller.forceScratch,
      field,
    );
  }
}

function approach(current: number, target: number, alpha: number): number {
  const gap = target - current;

  if (Math.abs(gap) < grabMotionConfig.snapDistance) {
    return target;
  }

  return current + gap * alpha;
}

function updateView(
  controller: GrabController,
  samples: readonly HandInteractionSample[],
  origin: Point,
  view: GrabView,
): void {
  const { grab, two } = controller;

  if (two.phase === "active") {
    view.holding = true;
    view.hint = "held";
    view.hintPoint.x = two.mid.x;
    view.hintPoint.y = two.mid.y;
    view.hintPoint.z = 0;
    view.mode = "two";
    return;
  }

  view.holding = grab.suspendAttractor;

  if (grab.phase === "grabbing") {
    view.mode = "one";
    view.hint = "held";
    copyPoint(grab.lastPinch, view.hintPoint);
    return;
  }

  view.mode = "none";

  const hand = nearestHandInRange(samples, origin, grab.config.grabRadius);

  if (hand) {
    view.hint = "near";
    copyPoint(hand.pinchPoint, view.hintPoint);
  } else {
    view.hint = "none";
  }
}

function copyPoint(from: Point, to: Point): void {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
}

/**
 * The valid hand whose pinch point is nearest the formation origin, within
 * `radius` (XY distance, the same test the grab uses to start). Null when none.
 */
export function nearestHandInRange(
  samples: readonly HandInteractionSample[],
  origin: Point,
  radius: number,
): HandInteractionSample | null {
  let best: HandInteractionSample | null = null;
  let bestDistance = radius * radius;

  for (const sample of samples) {
    if (!sample.valid) {
      continue;
    }

    const dx = sample.pinchPoint.x - origin.x;
    const dy = sample.pinchPoint.y - origin.y;
    const distance = dx * dx + dy * dy;

    if (distance <= bestDistance) {
      best = sample;
      bestDistance = distance;
    }
  }

  return best;
}

/** Writes the world-space pointer target in the group's local space. */
export function writeLocalTarget(
  controller: GrabController,
  group: Object3D,
  world: Point,
  out: Vector3,
): Vector3 {
  return worldPointToLocal(controller.space, group, world, out);
}
