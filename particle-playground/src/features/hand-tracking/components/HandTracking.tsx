"use client";

import { useCallback, useRef, type RefObject } from "react";
import { HandSkeleton } from "@/features/hand-tracking/components/HandSkeleton";
import { useHandLandmarks } from "@/shared/hooks/use-hand-landmarks";
import { useHandPositions } from "@/shared/hooks/use-hand-positions";
import type { HandPositionSample } from "@/shared/lib/hand-positions";

type HandTrackingProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
};

export function HandTracking({ videoRef }: HandTrackingProps) {
  const readoutRef = useRef<HTMLParagraphElement>(null);
  const fingertipReadoutRef = useRef<HTMLParagraphElement>(null);
  const publishPositions = useCallback((positions: readonly HandPositionSample[]) => {
    const readout = readoutRef.current;
    if (readout) {
      readout.textContent =
        positions.length === 0
          ? "No hand in frame"
          : positions.map(describePosition).join("  ·  ");
    }

    const fingertipReadout = fingertipReadoutRef.current;
    if (!fingertipReadout) {
      return;
    }

    let fingertips = "";
    for (const sample of positions) {
      if (!sample.hasFingertip) {
        continue;
      }
      fingertips = fingertips
        ? `${fingertips}  ·  ${describeFingertip(sample)}`
        : describeFingertip(sample);
    }
    fingertipReadout.textContent = fingertips;
  }, []);

  const { handsRef, handCount, status, error } = useHandLandmarks(videoRef);
  useHandPositions(videoRef, handsRef, publishPositions);

  return (
    <>
      <HandSkeleton videoRef={videoRef} handsRef={handsRef} />
      <div className="pointer-events-none absolute top-14 left-4 z-20 max-w-[calc(100%-2rem)] space-y-1 text-left text-xs text-zinc-100 sm:text-sm">
        <p>
          {status === "loading" && "Loading the hand landmarker…"}
          {status === "error" && error}
          {status === "ready" && handStatus(handCount)}
        </p>
        <p ref={readoutRef}>No hand in frame</p>
        {process.env.NODE_ENV === "development" ? (
          <p ref={fingertipReadoutRef} />
        ) : null}
      </div>
    </>
  );
}

function handStatus(handCount: number): string {
  if (handCount === 0) {
    return "Watching for a hand";
  }
  if (handCount === 1) {
    return "Hand detected";
  }
  return "Two hands detected";
}

function describePosition(sample: HandPositionSample): string {
  const side = sample.handedness ?? "Hand";
  const { x, y, z } = sample.position;
  return `${side} ${sample.gesture} · wrist (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
}

function describeFingertip(sample: HandPositionSample): string {
  const side = sample.handedness ?? "Hand";
  const { x, y, z } = sample.fingertip;
  const painting = sample.painting ? " painting" : "";
  return `${side} index (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})${painting}`;
}
