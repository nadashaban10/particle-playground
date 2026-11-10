export type GrabConfig = {
  /** Pinch closes when the ratio drops below this many palm lengths. */
  pinchCloseBelow: number;
  /** Pinch opens when the ratio rises above this many palm lengths. */
  pinchOpenAbove: number;
  /** Consecutive closed-pinch frames needed to start a grab. */
  startFrames: number;
  /** Consecutive open-pinch frames needed to release a grab. */
  releaseFrames: number;
  /** World-space distance (XY) from the formation origin within which a grab may start. */
  grabRadius: number;
  /** Seconds a grab survives without a usable sample before it is released. */
  graceSeconds: number;
  /** Fixed slack (world units) when checking that a returning hand is the same hand. */
  continuityRadius: number;
  /** Extra slack per second (world units) for the same check. */
  continuitySpeed: number;
};

export const grabConfig: GrabConfig = {
  pinchCloseBelow: 0.35,
  pinchOpenAbove: 0.55,
  startFrames: 3,
  releaseFrames: 3,
  grabRadius: 3,
  graceSeconds: 0.2,
  continuityRadius: 1,
  continuitySpeed: 60,
};
