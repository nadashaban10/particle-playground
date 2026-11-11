"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { detectTrackedHands } from "@/shared/lib/detect-hand-landmarks";
import { readHandTrackingSource } from "@/shared/lib/hand-tracking-source";
import {
  acquireHandLandmarker,
  releaseHandLandmarker,
} from "@/shared/services/hand-landmarker";
import type { TrackedHand } from "@/shared/types/hand-tracking";

export function useHandLandmarks(
  videoRef: RefObject<HTMLVideoElement | null>,
  onHands?: (hands: TrackedHand[], detectedAt: number) => void,
) {
  const handsRef = useRef<TrackedHand[]>([]);
  /**
   * `performance.now()` of the last successful detection (-Infinity before the
   * first). `handsRef` keeps its last value if the video or detector stalls, so
   * consumers compare this against the clock to know whether it is still fresh.
   */
  const lastDetectionRef = useRef(Number.NEGATIVE_INFINITY);
  const onHandsRef = useRef(onHands);
  const [handCount, setHandCount] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onHandsRef.current = onHands;
  }, [onHands]);

  useEffect(() => {
    let frameId = 0;
    let stopped = false;
    let lastVideoTime = -1;
    let count = 0;

    function publish(hands: TrackedHand[]) {
      const detectedAt = performance.now();
      handsRef.current = hands;
      lastDetectionRef.current = detectedAt;
      onHandsRef.current?.(hands, detectedAt);

      if (hands.length !== count) {
        count = hands.length;
        setHandCount(count);
      }
    }

    acquireHandLandmarker()
      .then((landmarker) => {
        if (stopped) {
          return;
        }

        setStatus("ready");

        const tick = () => {
          if (stopped) {
            return;
          }

          const source = readHandTrackingSource(videoRef.current);
          if (source && source.video.currentTime !== lastVideoTime) {
            lastVideoTime = source.video.currentTime;

            try {
              publish(
                detectTrackedHands(landmarker, source.video, performance.now()),
              );
            } catch (caught) {
              if (!stopped) {
                setStatus("error");
                setError(
                  caught instanceof Error
                    ? caught.message
                    : "Hand detection failed.",
                );
              }
              return;
            }
          }

          frameId = requestAnimationFrame(tick);
        };

        frameId = requestAnimationFrame(tick);
      })
      .catch((caught: unknown) => {
        if (!stopped) {
          setStatus("error");
          setError(
            caught instanceof Error
              ? caught.message
              : "The hand landmarker could not be loaded.",
          );
        }
      });

    return () => {
      stopped = true;
      cancelAnimationFrame(frameId);
      void releaseHandLandmarker();
    };
  }, [videoRef]);

  return { handsRef, lastDetectionRef, handCount, status, error };
}
