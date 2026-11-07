import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark } from "@/types/hand-tracking";

const HAND_LANDMARK_COUNT = 21;

export function detectHandLandmarks(
  landmarker: HandLandmarker,
  video: HTMLVideoElement,
  timestamp: number,
): Landmark[] | null {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return null;
  }

  const result = landmarker.detectForVideo(video, timestamp);
  const hand = result.landmarks[0];
  if (!hand || hand.length < HAND_LANDMARK_COUNT) {
    return null;
  }

  return hand.slice(0, HAND_LANDMARK_COUNT).map((point) => ({
    x: point.x,
    y: point.y,
    z: point.z,
  }));
}
