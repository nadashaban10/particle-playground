import { grabConfig } from "@/lib/grab-config";

export type GestureForceConfig = {
  /** Pinch ratio below which a hand counts as pinching (shared with the grab). */
  pinchCloseBelow: number;
  /** Pinch ratio above which a pinching hand counts as open again. */
  pinchOpenAbove: number;
  /**
   * Seconds a new gesture (open palm or fist) must be read continuously
   * before it takes effect. Filters single-frame misclassifications. Time
   * based, so it does not depend on the frame rate.
   */
  confirmSeconds: number;
  /**
   * Seconds a hand must read as something else (NONE, point, ...) before an
   * active gesture is dropped. Longer than the confirm time on purpose: a
   * force that is already acting should not flicker off.
   */
  releaseSeconds: number;
  /** How fast a force fades in (strength per second; 1 / rate seconds to full). */
  attackRate: number;
  /** How fast a dropped force fades out (strength per second). */
  releaseRate: number;
  /** Follow rate (per second) of the hand position, to take out detector jitter. */
  positionSmoothing: number;
  /** Frames longer than this (s) are treated as this long. */
  maxStepSeconds: number;
  /**
   * Radius of a force field, in world units. Converted to the group's local
   * units (divided by its scale) so the field keeps its size on screen.
   */
  radius: number;
  /**
   * Fraction of the radius that forms the soft core around the hand's centre.
   * Repulsion fades to zero toward the centre; attraction fades and then
   * reverses slightly inside half the core, so a pulled cloud settles on a
   * small shell (radius about core / 2) rather than collapsing to a point.
   * Outside the core both only decrease with distance.
   */
  coreFraction: number;
  /**
   * Peak open-palm push, as an acceleration in world-scale velocity units per
   * second (the same units as the pointer's `forceStrength`). The force
   * at distance d from the hand is `strength * (1 - d / radius)^2`, so this
   * is also the most any particle can feel.
   */
  repulsionStrength: number;
  /** Peak fist pull, same units and falloff. Lower than the push to keep clouds loose. */
  attractionStrength: number;
};

export const gestureForceConfig: GestureForceConfig = {
  pinchCloseBelow: grabConfig.pinchCloseBelow,
  pinchOpenAbove: grabConfig.pinchOpenAbove,
  confirmSeconds: 0.1,
  releaseSeconds: 0.15,
  attackRate: 6,
  releaseRate: 10,
  positionSmoothing: 20,
  maxStepSeconds: 0.05,
  radius: 3.5,
  coreFraction: 0.25,
  repulsionStrength: 9,
  attractionStrength: 6,
};
