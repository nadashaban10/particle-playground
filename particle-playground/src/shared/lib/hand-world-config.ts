/**
 * A rectangle inside the camera frame, as fractions of the frame (0..1).
 * Measured the way the user sees the mirrored preview: x grows to the right of
 * the screen, y grows downward from the top.
 */
export type ActiveRegion = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export const handWorldConfig = {
  /**
   * The part of the camera frame that spans the whole visible world.
   * A hand at the region's edge reaches the Canvas edge, so the user never has
   * to stretch to the extreme borders of the camera image. The central 70% of
   * each axis is a comfortable arm's reach at a desk. Hands outside the region
   * clamp to the Canvas edge.
   */
  region: { minX: 0.15, maxX: 0.85, minY: 0.15, maxY: 0.85 } as ActiveRegion,
  /**
   * A detection older than this (ms) is treated as missing. Detection normally
   * lands every 30-70 ms, so this tolerates a slow frame but not a stalled
   * video or detector.
   */
  maxDetectionAgeMs: 250,
};
