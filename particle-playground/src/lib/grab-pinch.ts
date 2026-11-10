import { grabConfig } from "@/lib/grab-config";
import type { Landmark } from "@/types/hand-tracking";

const THUMB_TIP = 4;
const INDEX_TIP = 8;
const WRIST = 0;
const MIDDLE_MCP = 9;
const MIN_PALM_LENGTH = 1e-6;

/**
 * Thumb-to-index distance expressed in palm lengths, using normalized 2D
 * landmark coordinates (depth is ignored because it is the noisiest axis).
 * Dividing by the wrist-to-middle-knuckle length makes the value independent of
 * how far the hand is from the camera.
 *
 * `aspect` is frame width / height. MediaPipe's x and y are each normalized to
 * their own axis, so passing the aspect keeps distances isotropic on frames
 * that are not square. Returns NaN when the measurement is impossible.
 */
export function measurePinchRatio(
  landmarks: readonly Landmark[],
  aspect = 1,
): number {
  const thumb = landmarks[THUMB_TIP];
  const index = landmarks[INDEX_TIP];
  const wrist = landmarks[WRIST];
  const knuckle = landmarks[MIDDLE_MCP];

  if (!thumb || !index || !wrist || !knuckle) {
    return Number.NaN;
  }

  const palm = Math.hypot(
    (knuckle.x - wrist.x) * aspect,
    knuckle.y - wrist.y,
  );

  if (!Number.isFinite(palm) || palm < MIN_PALM_LENGTH) {
    return Number.NaN;
  }

  const pinch = Math.hypot((index.x - thumb.x) * aspect, index.y - thumb.y);

  return pinch / palm;
}

/**
 * Pinch hysteresis. Closes below `closeBelow`, opens above `openAbove`, and
 * keeps the previous state in between (and for unusable ratios), so a hand
 * hovering near one threshold cannot flicker.
 */
export function nextPinchClosed(
  previous: boolean,
  ratio: number,
  closeBelow = grabConfig.pinchCloseBelow,
  openAbove = grabConfig.pinchOpenAbove,
): boolean {
  if (!Number.isFinite(ratio)) {
    return previous;
  }

  if (ratio < closeBelow) {
    return true;
  }

  if (ratio > openAbove) {
    return false;
  }

  return previous;
}
