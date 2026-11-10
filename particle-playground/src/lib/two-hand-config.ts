import { grabConfig } from "@/lib/grab-config";

export type TwoHandConfig = {
  /** Pinch ratio below which a hand closes (hysteresis, shared with the grab). */
  pinchCloseBelow: number;
  /** Pinch ratio above which a closed hand opens again. */
  pinchOpenAbove: number;
  /** Consecutive frames both hands must pinch before the transform starts. */
  startFrames: number;
  /** Consecutive frames a hand must be open before it counts as released. */
  releaseFrames: number;
  /** How long (s) a missing hand is tolerated before it counts as released. */
  graceSeconds: number;
  /** A hand may jump this far (world units) in one frame without being a different hand. */
  continuityRadius: number;
  /** Extra continuity allowance per second of elapsed time (world units / s). */
  continuitySpeed: number;
  /**
   * From idle, the midpoint of the two pinches must be within this distance
   * (XY, world units) of the formation to start. While a single-hand grab is
   * live the second hand may join from anywhere.
   */
  activationRadius: number;
  /**
   * Hands closer than this (world units) neither start the transform nor
   * drive scale or rotation. Below it the distance is clamped and the angle
   * is frozen, so a pinch-to-pinch touch cannot divide by zero or spin.
   */
  minHandDistance: number;
  /** Smallest group scale the transform may produce. */
  minScale: number;
  /** Largest group scale the transform may produce. */
  maxScale: number;
};

export const twoHandConfig: TwoHandConfig = {
  pinchCloseBelow: grabConfig.pinchCloseBelow,
  pinchOpenAbove: grabConfig.pinchOpenAbove,
  startFrames: grabConfig.startFrames,
  releaseFrames: grabConfig.releaseFrames,
  graceSeconds: grabConfig.graceSeconds,
  continuityRadius: grabConfig.continuityRadius,
  continuitySpeed: grabConfig.continuitySpeed,
  activationRadius: 5,
  minHandDistance: 0.5,
  /**
   * 0.4 keeps a shrunk formation readable; 2.5 lets it grow without filling
   * the view. The bounds step additionally pulls a large formation toward
   * the centre, so the scale limits are about usability, not visibility.
   */
  minScale: 0.4,
  maxScale: 2.5,
};
