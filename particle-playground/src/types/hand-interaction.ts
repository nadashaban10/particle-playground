import type { GestureName, Handedness } from "@/types/hand-tracking";
import type { Vector3 } from "@/types/particles";

/**
 * One hand, described only by what an interaction needs: who it is, where its
 * pinch is, and how closed the pinch looks. Nothing here depends on painting,
 * trails, or the scene, so grabbing (and later gestures) can share it.
 */
export type HandInteractionSample = {
  /** Stable identity for the hand across frames ("Left", "Right", "hand-0", ...). */
  key: string;
  /** Label reported by the detector, or null when it is unknown. */
  handedness: Handedness | null;
  /** World-space midpoint between the thumb tip (4) and the index tip (8). */
  pinchPoint: Vector3;
  /** Thumb-to-index distance divided by palm length (wrist 0 to middle MCP 9). */
  pinchRatio: number;
  /** False when this frame's measurement cannot be trusted. */
  valid: boolean;
  /**
   * The detector's raw gesture for this frame (`detectGesture`), unfiltered.
   * "none" whenever the sample is not valid or the palm cannot be placed.
   */
  gesture: GestureName;
  /**
   * World-space palm centre: the mean of the wrist (0) and the four finger
   * knuckles (5, 9, 13, 17), mapped like the pinch point. Where gesture forces
   * are anchored. Only meaningful while `gesture` is not "none".
   */
  palmPoint: Vector3;
};
