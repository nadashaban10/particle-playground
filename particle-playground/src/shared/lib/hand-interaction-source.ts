import type { Camera } from "three";
import {
  clearHandDetection,
  handDetectionSource,
  isDetectionFresh,
  type HandDetectionSource,
} from "@/shared/lib/hand-detection-source";
import {
  buildHandInteractionSamples,
  resetHandInteractionBuilder,
  type HandInteractionBuilder,
} from "@/shared/lib/hand-interaction-samples";
import { handWorldConfig } from "@/shared/lib/hand-world-config";
import type { HandInteractionSample } from "@/shared/types/hand-interaction";

const EMPTY: readonly HandInteractionSample[] = [];

/**
 * Latest hand-interaction samples in world space. Neutral: nothing here knows
 * about painting or grabbing. Consumers read `.current` each frame; it is the
 * empty list whenever tracking is off or stale.
 */
export const handInteractionSource: {
  current: readonly HandInteractionSample[];
} = {
  current: EMPTY,
};

/**
 * Rebuilds the samples for this frame from the latest detection, or publishes
 * an empty list when the detection is missing or older than
 * `handWorldConfig.maxDetectionAgeMs`. A stalled video or detector therefore
 * can never keep an old hand looking live.
 */
export function refreshHandInteractionSource(
  builder: HandInteractionBuilder,
  camera: Camera,
  now: number,
  detection: HandDetectionSource = handDetectionSource,
  maxAgeMs: number = handWorldConfig.maxDetectionAgeMs,
): readonly HandInteractionSample[] {
  if (!isDetectionFresh(detection, now, maxAgeMs)) {
    resetHandInteractionBuilder(builder);
    handInteractionSource.current = EMPTY;
    return EMPTY;
  }

  const samples = buildHandInteractionSamples(builder, detection.hands, camera, {
    mirrored: detection.mirrored,
    aspect: detection.aspect,
  });
  handInteractionSource.current = samples;
  return samples;
}

export function clearHandInteractionSource(): void {
  handInteractionSource.current = EMPTY;
}

/** Everything that must happen when tracking stops or the camera is disabled. */
export function resetHandInteraction(): void {
  clearHandDetection();
  clearHandInteractionSource();
}
