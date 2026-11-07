"use client";

import { useCallback, useRef, type RefObject } from "react";
import { useHandLandmarks } from "@/hooks/use-hand-landmarks";
import type { Landmark } from "@/types/hand-tracking";

type HandTrackingProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
};

export function HandTracking({ videoRef }: HandTrackingProps) {
  const readoutRef = useRef<HTMLParagraphElement>(null);
  const publishLandmarks = useCallback((landmarks: Landmark[] | null) => {
    const readout = readoutRef.current;
    if (!readout) {
      return;
    }

    if (!landmarks) {
      readout.textContent = "No hand in frame";
      return;
    }

    const wrist = landmarks[0];
    readout.textContent = `${landmarks.length} landmarks · wrist ${wrist.x.toFixed(2)}, ${wrist.y.toFixed(2)}`;
  }, []);

  const { handPresent, status, error } = useHandLandmarks(
    videoRef,
    publishLandmarks,
  );

  return (
    <div className="mt-3 space-y-1 text-sm text-zinc-300">
      <p>
        {status === "loading" && "Loading the hand landmarker…"}
        {status === "error" && error}
        {status === "ready" &&
          (handPresent ? "Hand detected" : "Watching for a hand")}
      </p>
      <p ref={readoutRef}>No hand in frame</p>
    </div>
  );
}
