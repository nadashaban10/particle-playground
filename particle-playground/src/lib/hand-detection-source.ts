import type { TrackedHand } from "@/types/hand-tracking";

const NO_HANDS: readonly TrackedHand[] = [];

/**
 * The latest raw detection, shared between the React root that runs MediaPipe
 * and the R3F root that renders the world. It is written once per detection
 * and read every frame, so no React state is involved.
 */
export type HandDetectionSource = {
  hands: readonly TrackedHand[];
  /** `performance.now()` when the detection finished; -Infinity when none. */
  detectedAt: number;
  /** The preview is displayed mirrored. */
  mirrored: boolean;
  /** Source frame width / height. */
  aspect: number;
};

export const handDetectionSource: HandDetectionSource = {
  hands: NO_HANDS,
  detectedAt: Number.NEGATIVE_INFINITY,
  mirrored: true,
  aspect: 1,
};

export function publishHandDetection(
  hands: readonly TrackedHand[],
  detectedAt: number,
  mirrored: boolean,
  aspect: number,
): void {
  handDetectionSource.hands = hands;
  handDetectionSource.detectedAt = detectedAt;
  handDetectionSource.mirrored = mirrored;
  handDetectionSource.aspect = aspect;
}

export function clearHandDetection(): void {
  handDetectionSource.hands = NO_HANDS;
  handDetectionSource.detectedAt = Number.NEGATIVE_INFINITY;
}

/** True when the detection finished no more than `maxAgeMs` before `now`. */
export function isDetectionFresh(
  source: HandDetectionSource,
  now: number,
  maxAgeMs: number,
): boolean {
  return now - source.detectedAt <= maxAgeMs;
}
