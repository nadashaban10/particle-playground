"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { createHandInteractionBuilder } from "@/shared/lib/hand-interaction-samples";
import {
  clearHandInteractionSource,
  refreshHandInteractionSource,
} from "@/shared/lib/hand-interaction-source";

/**
 * Lives inside the Canvas so it can use the real R3F camera (whose aspect
 * R3F keeps equal to the Canvas width / height). Each frame it turns the latest
 * hand detection into world-space samples in `handInteractionSource`, or
 * publishes none when the detection is missing or stale. Renders nothing and
 * does nothing until something publishes a detection.
 */
export function HandInteractionBridge() {
  const builder = useMemo(() => createHandInteractionBuilder(), []);

  // Negative priority: runs before the grab controller and the particle
  // physics, without taking over rendering (only positive priorities do).
  useFrame((state) => {
    if (state.size.width <= 0 || state.size.height <= 0) {
      clearHandInteractionSource();
      return;
    }

    state.camera.updateMatrixWorld();
    refreshHandInteractionSource(builder, state.camera, performance.now());
  }, -3);

  useEffect(() => clearHandInteractionSource, []);

  return null;
}
