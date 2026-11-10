"use client";

import { useEffect, useRef, type RefObject } from "react";
import {
  createHandPositionState,
  stepHandPositions,
  type HandPositionSample,
  type HandPositionView,
} from "@/lib/hand-positions";
import { isHorizontallyMirrored } from "@/lib/map-landmark";
import { paintSampleSource } from "@/lib/paint-sample-source";
import type { TrackedHand } from "@/types/hand-tracking";

export function useHandPositions(
  videoRef: RefObject<HTMLVideoElement | null>,
  handsRef: RefObject<TrackedHand[]>,
  onPositions?: (positions: readonly HandPositionSample[]) => void,
) {
  const positionsRef = useRef<readonly HandPositionSample[]>([]);
  const onPositionsRef = useRef(onPositions);

  useEffect(() => {
    onPositionsRef.current = onPositions;
  }, [onPositions]);

  useEffect(() => {
    const state = createHandPositionState();
    const view: HandPositionView = { mirrored: true, aspect: 1 };
    let frameId = 0;
    let lastTime = performance.now();

    const tick = (time: number) => {
      const delta = (time - lastTime) / 1000;
      lastTime = time;
      const video = videoRef.current;
      const hands = video && video.clientWidth > 0 ? handsRef.current : [];

      if (video && video.clientWidth > 0) {
        view.mirrored = isHorizontallyMirrored(video);
        view.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
      }

      stepHandPositions(state, hands, delta, view);
      positionsRef.current = state.samples;
      paintSampleSource.current = state.samples;
      onPositionsRef.current?.(state.samples);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      paintSampleSource.current = [];
    };
  }, [handsRef, videoRef]);

  return positionsRef;
}
