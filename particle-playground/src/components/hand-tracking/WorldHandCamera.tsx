"use client";

import { useCallback, useRef, useState } from "react";
import { CameraPreview } from "@/components/camera/CameraPreview";
import { HandInteractionDiagnostic } from "@/components/hand-tracking/HandInteractionDiagnostic";
import { HandInteractionTracker } from "@/components/hand-tracking/HandInteractionTracker";

/**
 * Small camera card for the main world. Mounts the preview and the interaction
 * tracker together with one shared video ref, so there is exactly one
 * MediaPipe detection loop while the camera is on. The same hand skeleton as
 * the camera lab is drawn over the preview so the user sees their hands tracked. Unmount the whole card to
 * stop the camera tracks and clear the interaction sources.
 *
 * Placed at the top-left so it stays clear of the bottom studio toolbar on
 * phones.
 */
export function WorldHandCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [trackerStatus, setTrackerStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [trackerError, setTrackerError] = useState<string | null>(null);

  const onStatusChange = useCallback(
    (status: "loading" | "ready" | "error", error: string | null) => {
      setTrackerStatus(status);
      setTrackerError(error);
    },
    [],
  );

  return (
    <div className="pointer-events-none absolute top-3 left-3 z-20 w-36 max-w-[calc(100%-1.5rem)] sm:top-4 sm:left-4 sm:w-44">
      <div className="pointer-events-auto rounded-2xl bg-zinc-950/80 p-2 ring-1 ring-white/10 backdrop-blur-md">
        {/* The skeleton overlay fills this box, which is exactly the video. */}
        <div className="relative">
          <CameraPreview videoRef={videoRef} className="w-full" />
          <HandInteractionTracker
            videoRef={videoRef}
            onStatusChange={onStatusChange}
            showSkeleton
          />
        </div>
        <p className="mt-2 text-[11px] leading-snug text-zinc-300">
          {trackerStatus === "loading" && "Loading hand tracker…"}
          {trackerStatus === "ready" && "Hand tracking ready"}
          {trackerStatus === "error" && (trackerError ?? "Hand tracking failed.")}
        </p>
        {process.env.NODE_ENV === "development" ? (
          <div className="mt-2 border-t border-white/10 pt-2">
            <HandInteractionDiagnostic />
          </div>
        ) : null}
      </div>
    </div>
  );
}
