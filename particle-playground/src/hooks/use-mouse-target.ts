"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Plane, Vector3 } from "three";
import { particleConfig } from "@/components/particles/particle-config";

export function useMouseTarget() {
  const { x, y, z } = particleConfig.target;
  const plane = useRef(new Plane(new Vector3(0, 0, 1), 0));
  const pointerTarget = useRef(new Vector3(x, y, z));
  const smoothedTarget = useRef(new Vector3(x, y, z));

  useFrame((state, delta) => {
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const hit = state.raycaster.ray.intersectPlane(
      plane.current,
      pointerTarget.current,
    );

    if (!hit) {
      return;
    }

    const alpha = 1 - Math.exp(-particleConfig.targetSmoothing * delta);
    smoothedTarget.current.lerp(pointerTarget.current, alpha);
  });

  return smoothedTarget;
}
