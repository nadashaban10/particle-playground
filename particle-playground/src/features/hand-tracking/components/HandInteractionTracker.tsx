"use client";

import { useCallback, useEffect, type RefObject } from "react";
import { HandSkeleton } from "@/features/hand-tracking/components/HandSkeleton";
import { useHandLandmarks } from "@/shared/hooks/use-hand-landmarks";
import { publishHandDetection } from "@/shared/lib/hand-detection-source";
import { resetHandInteraction } from "@/shared/lib/hand-interaction-source";
import { isHorizontallyMirrored } from "@/shared/lib/map-landmark";
import type { TrackedHand } from "@/shared/types/hand-tracking";

type TrackerStatus = "loading" | "ready" | "error";

type HandInteractionTrackerProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Optional status updates for a host UI (loading / ready / error). */
  onStatusChange?: (status: TrackerStatus, error: string | null) => void;
  /** Optional hand-count updates (0 while loading or when none are visible). */
  onHandCountChange?: (handCount: number) => void;
  /**
   * Draw the same hand skeleton the camera lab uses over the video, so the
   * user can see their hands being tracked. It reads the detections this
   * tracker already produces (no second detection loop). The overlay fills
   * the nearest positioned ancestor, so mount the tracker inside a
   * `relative` box that wraps the video.
   */
  showSkeleton?: boolean;
};

/**
 * Feeds the main world with hand detections. It runs the one detection loop
 * (`useHandLandmarks`) and publishes each result to `handDetectionSource`.
 * Mount it only after the user enables the camera; unmounting it (camera
 * disabled) clears everything it published.
 *
 * It renders nothing unless `showSkeleton` is set, and carries none of the
 * camera lab's status text.
 */
export function HandInteractionTracker({
  videoRef,
  onStatusChange,
  onHandCountChange,
  showSkeleton = false,
}: HandInteractionTrackerProps) {
  const publish = useCallback(
    (hands: TrackedHand[], detectedAt: number) => {
      const video = videoRef.current;
      if (!video) {
        return;
      }

      publishHandDetection(
        hands,
        detectedAt,
        isHorizontallyMirrored(video),
        frameAspect(video),
      );
    },
    [videoRef],
  );

  const { handsRef, status, error, handCount } = useHandLandmarks(
    videoRef,
    publish,
  );

  useEffect(() => {
    onStatusChange?.(status, error);
  }, [error, onStatusChange, status]);

  useEffect(() => {
    onHandCountChange?.(handCount);
  }, [handCount, onHandCountChange]);

  useEffect(() => {
    if (status === "error") {
      resetHandInteraction();
    }
  }, [status]);

  useEffect(() => resetHandInteraction, []);

  return showSkeleton ? (
    <HandSkeleton videoRef={videoRef} handsRef={handsRef} />
  ) : null;
}

function frameAspect(video: HTMLVideoElement): number {
  return video.videoWidth > 0 && video.videoHeight > 0
    ? video.videoWidth / video.videoHeight
    : 1;
}
