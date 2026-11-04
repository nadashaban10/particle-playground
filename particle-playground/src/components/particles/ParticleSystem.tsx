"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, type Points, type PointsMaterial } from "three";
import type { GestureName } from "@/types/hand-tracking";

const COUNT = 1600;

const GESTURE_COLOR: Record<GestureName, string> = {
  none: "#e4e4e7",
  open_palm: "#fde68a",
  closed_fist: "#fb7185",
  pinch: "#7dd3fc",
  point: "#c4b5fd",
};

type ParticleSystemProps = {
  gesture?: GestureName;
};

export function ParticleSystem({ gesture = "none" }: ParticleSystemProps) {
  const points = useRef<Points>(null);
  const color = useMemo(() => new Color(GESTURE_COLOR[gesture]), [gesture]);

  const positions = useMemo(() => {
    const values = new Float32Array(COUNT * 3);

    for (let index = 0; index < COUNT; index += 1) {
      const offset = index * 3;
      values[offset] = (Math.random() - 0.5) * 8;
      values[offset + 1] = (Math.random() - 0.5) * 8;
      values[offset + 2] = (Math.random() - 0.5) * 8;
    }

    return values;
  }, []);

  useFrame((_, delta) => {
    if (!points.current) {
      return;
    }

    const speed =
      gesture === "closed_fist" ? 0.02 : gesture === "open_palm" ? 0.2 : 0.08;
    points.current.rotation.y += delta * speed;

    const material = points.current.material;
    if (!Array.isArray(material)) {
      (material as PointsMaterial).color.lerp(color, 0.08);
    }
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={GESTURE_COLOR[gesture]} size={0.035} sizeAttenuation />
    </points>
  );
}
