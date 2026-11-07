"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { detectHandLandmarks } from "@/lib/detect-hand-landmarks";
import { readHandTrackingSource } from "@/lib/hand-tracking-source";
import {
  acquireHandLandmarker,
  releaseHandLandmarker,
} from "@/services/hand-landmarker";
import type { Landmark } from "@/types/hand-tracking";

export function useHandLandmarks(
  videoRef: RefObject<HTMLVideoElement | null>,
  onLandmarks?: (landmarks: Landmark[] | null) => void,
) {
  const landmarksRef = useRef<Landmark[] | null>(null);
  const onLandmarksRef = useRef(onLandmarks);
  const [handPresent, setHandPresent] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onLandmarksRef.current = onLandmarks;
  }, [onLandmarks]);

  useEffect(() => {
    let frameId = 0;
    let stopped = false;
    let lastVideoTime = -1;
    let present = false;

    function publish(landmarks: Landmark[] | null) {
      landmarksRef.current = landmarks;
      onLandmarksRef.current?.(landmarks);

      const nextPresent = landmarks !== null;
      if (nextPresent !== present) {
        present = nextPresent;
        setHandPresent(nextPresent);
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
                detectHandLandmarks(
                  landmarker,
                  source.video,
                  performance.now(),
                ),
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

  return { landmarksRef, handPresent, status, error };
}
