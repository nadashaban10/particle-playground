import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { handsFromDetection } from "@/shared/lib/track-hands";
import type { TrackedHand } from "@/shared/types/hand-tracking";

export function detectTrackedHands(
  landmarker: HandLandmarker,
  video: HTMLVideoElement,
  timestamp: number,
): TrackedHand[] {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return [];
  }

  const result = landmarker.detectForVideo(video, timestamp);
  return handsFromDetection(result.landmarks, result.handedness);
}
