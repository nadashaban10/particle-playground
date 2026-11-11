"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CameraPreview,
  type CameraLifecycleState,
} from "@/shared/components/camera/CameraPreview";
import { useHandLandmarks } from "@/shared/hooks/use-hand-landmarks";
import {
  cameraExperienceCopy,
  deriveCameraExperiencePhase,
  type CameraStreamPhase,
  type TrackerPhase,
} from "@/shared/lib/camera-experience";
import type { TrackedHand } from "@/shared/types/hand-tracking";

type StudioHandCameraProps = {
  onHands: (hands: TrackedHand[], detectedAt: number) => void;
  onRetry?: () => void;
  className?: string;
};

/**
 * Compact Studio camera card. Reuses CameraPreview + useHandLandmarks only —
 * does not publish into the Explore hand-detection bus.
 */
export function StudioHandCamera({
  onHands,
  onRetry,
  className,
}: StudioHandCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<CameraStreamPhase>("idle");
  const [streamError, setStreamError] = useState<string | null>(null);
  const onHandsRef = useRef(onHands);

  useEffect(() => {
    onHandsRef.current = onHands;
  }, [onHands]);

  const onCameraLifecycle = useCallback((state: CameraLifecycleState) => {
    setStream(state.phase);
    setStreamError(state.error);
  }, []);

  const { handCount, status, error } = useHandLandmarks(
    videoRef,
    (hands, detectedAt) => {
      onHandsRef.current(hands, detectedAt);
    },
  );

  const tracker: TrackerPhase =
    status === "loading" ? "loading" : status === "error" ? "error" : "ready";

  const phase = useMemo(
    () =>
      deriveCameraExperiencePhase({
        cameraEnabled: true,
        stream,
        streamError,
        tracker,
        trackerError: error,
        handCount,
      }),
    [error, handCount, stream, streamError, tracker],
  );

  const copy = useMemo(() => {
    const base = cameraExperienceCopy(phase, {
      streamError,
      trackerError: error,
      handCount,
    });
    if (phase === "idle" || phase === "waiting_for_hand") {
      return {
        ...base,
        status:
          phase === "waiting_for_hand"
            ? "Show a hand to draw"
            : base.status,
        hint: "Point to draw · Pinch to move · Two hands to scale · Open palm to pause",
      };
    }
    if (phase === "hand_detected") {
      return {
        ...base,
        status: handCount > 1 ? "Two hands — scale mode" : "Hand ready",
        hint: "Point to draw · Pinch to grab",
      };
    }
    return base;
  }, [error, handCount, phase, streamError]);

  const showRetry = copy.action === "retry" && onRetry !== undefined;
  const isError =
    phase === "camera_error" ||
    phase === "tracker_error" ||
    phase === "stream_ended";

  return (
    <div
      className={
        className ??
        "pointer-events-none absolute top-3 right-3 z-20 w-[min(10.5rem,calc(100%-1.5rem))] sm:top-4 sm:right-4 sm:w-40"
      }
    >
      <div className="pointer-events-auto rounded-2xl bg-slate-950/80 p-2 ring-1 ring-white/10 backdrop-blur-md">
        <div className="relative overflow-hidden rounded-xl">
          <CameraPreview
            videoRef={videoRef}
            className="w-full"
            showError={false}
            onLifecycleChange={onCameraLifecycle}
          />
        </div>
        <div className="mt-2 space-y-1">
          <p
            className={`text-[11px] leading-snug ${
              isError ? "text-rose-300" : "text-slate-200"
            }`}
          >
            {copy.status}
          </p>
          {copy.hint ? (
            <p className="text-[10px] leading-snug text-slate-400">{copy.hint}</p>
          ) : null}
          {showRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 rounded-full bg-amber-200/90 px-2.5 py-1 text-[11px] font-medium text-slate-950"
            >
              Retry camera
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
