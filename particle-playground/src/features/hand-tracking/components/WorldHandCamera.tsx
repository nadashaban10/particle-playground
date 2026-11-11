"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  CameraPreview,
  type CameraLifecycleState,
} from "@/shared/components/camera/CameraPreview";
import { HandInteractionDiagnostic } from "@/features/hand-tracking/components/HandInteractionDiagnostic";
import { HandInteractionTracker } from "@/features/hand-tracking/components/HandInteractionTracker";
import {
  cameraExperienceCopy,
  deriveCameraExperiencePhase,
  type CameraStreamPhase,
  type TrackerPhase,
} from "@/shared/lib/camera-experience";

type WorldHandCameraProps = {
  /** Remount / retry the camera session after an error or disconnect. */
  onRetry?: () => void;
};

/**
 * Small camera card for the main world. Mounts the preview and the interaction
 * tracker together with one shared video ref, so there is exactly one
 * MediaPipe detection loop while the camera is on. Status copy separates
 * camera permission, tracker load, and hand presence. Unmount the card to
 * stop the camera tracks and clear the interaction sources.
 *
 * Placed at the top-left so it stays clear of the bottom studio toolbar on
 * phones; sized for both portrait and landscape.
 */
export function WorldHandCamera({ onRetry }: WorldHandCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<CameraStreamPhase>("idle");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [tracker, setTracker] = useState<TrackerPhase>("loading");
  const [trackerError, setTrackerError] = useState<string | null>(null);
  const [handCount, setHandCount] = useState(0);

  const onCameraLifecycle = useCallback((state: CameraLifecycleState) => {
    setStream(state.phase);
    setStreamError(state.error);
  }, []);

  const onTrackerStatus = useCallback(
    (status: "loading" | "ready" | "error", error: string | null) => {
      setTracker(status);
      setTrackerError(error);
    },
    [],
  );

  const onHandCountChange = useCallback((count: number) => {
    setHandCount(count);
  }, []);

  const phase = useMemo(
    () =>
      deriveCameraExperiencePhase({
        cameraEnabled: true,
        stream,
        streamError,
        tracker,
        trackerError,
        handCount,
      }),
    [handCount, stream, streamError, tracker, trackerError],
  );

  const copy = useMemo(
    () => cameraExperienceCopy(phase, { streamError, trackerError, handCount }),
    [handCount, phase, streamError, trackerError],
  );

  const showRetry = copy.action === "retry" && onRetry !== undefined;
  const isError =
    phase === "camera_error" ||
    phase === "tracker_error" ||
    phase === "stream_ended";

  return (
    <div className="pointer-events-none absolute top-3 left-3 z-20 w-[min(11rem,calc(100%-1.5rem))] sm:top-4 sm:left-4 sm:w-44">
      <div className="pointer-events-auto rounded-2xl bg-zinc-950/80 p-2 ring-1 ring-white/10 backdrop-blur-md">
        {/* The skeleton overlay fills this box, which is exactly the video. */}
        <div className="relative overflow-hidden rounded-xl">
          <CameraPreview
            videoRef={videoRef}
            className="w-full"
            showError={false}
            onLifecycleChange={onCameraLifecycle}
          />
          <HandInteractionTracker
            videoRef={videoRef}
            onStatusChange={onTrackerStatus}
            onHandCountChange={onHandCountChange}
            showSkeleton
          />
        </div>
        <div className="mt-2 space-y-1">
          <p
            className={`text-[11px] leading-snug ${
              isError ? "text-rose-300" : "text-zinc-300"
            }`}
          >
            {copy.status}
          </p>
          {copy.hint ? (
            <p className="text-[10px] leading-snug text-zinc-500">{copy.hint}</p>
          ) : null}
          {showRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 rounded-full px-2.5 py-1 text-[10px] text-zinc-100 ring-1 ring-white/15 hover:bg-white/10"
            >
              Retry camera
            </button>
          ) : null}
        </div>
        {process.env.NODE_ENV === "development" ? (
          <div className="mt-2 border-t border-white/10 pt-2">
            <HandInteractionDiagnostic />
          </div>
        ) : null}
      </div>
    </div>
  );
}
