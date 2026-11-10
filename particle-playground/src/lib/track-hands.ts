import { detectGesture } from "@/lib/gesture-detection";
import type { Handedness, TrackedHand } from "@/types/hand-tracking";

const HAND_LANDMARK_COUNT = 21;

type RawPoint = {
  x: number;
  y: number;
  z: number;
};

type RawCategory = {
  categoryName?: string;
};

/**
 * Pair each landmark list with the handedness entry at the same index.
 * That index only matches the two arrays for this frame. It is not an identity,
 * and it is not a permanent left or right hand.
 */
export function handsFromDetection(
  landmarks: RawPoint[][],
  handedness: RawCategory[][] | undefined,
): TrackedHand[] {
  const hands: TrackedHand[] = [];

  for (let index = 0; index < landmarks.length; index += 1) {
    const points = landmarks[index];
    if (!points || points.length < HAND_LANDMARK_COUNT) {
      continue;
    }

    const mapped = points.slice(0, HAND_LANDMARK_COUNT).map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z,
    }));
    const wrist = mapped[0];

    hands.push({
      handedness: readHandedness(handedness?.[index]),
      landmarks: mapped,
      gesture: detectGesture(mapped),
      position: { x: wrist.x, y: wrist.y, z: wrist.z },
    });
  }

  return hands;
}

function readHandedness(categories: RawCategory[] | undefined): Handedness | null {
  const name = categories?.[0]?.categoryName;
  if (name === "Left" || name === "Right") {
    return name;
  }
  return null;
}
