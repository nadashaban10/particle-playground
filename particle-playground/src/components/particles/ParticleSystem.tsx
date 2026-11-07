"use client";

import { useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferAttribute,
  type Points,
  type Vector3,
} from "three";
import { particleConfig } from "@/components/particles/particle-config";
import { createParticleBuffers, stepParticles } from "@/lib/particle-motion";
import type { InteractionMode } from "@/types/particles";

type ParticleSystemProps = {
  interaction: InteractionMode;
  target: RefObject<Vector3>;
};

export function ParticleSystem({ interaction, target }: ParticleSystemProps) {
  const points = useRef<Points>(null);
  const buffers = useMemo(() => createParticleBuffers(particleConfig), []);

  useFrame((_, delta) => {
    const position = points.current?.geometry.getAttribute("position");
    if (!(position instanceof BufferAttribute)) {
      return;
    }

    if (!target.current) {
      return;
    }

    stepParticles(
      buffers.positions,
      buffers.velocities,
      particleConfig,
      delta,
      interaction,
      target.current,
    );
    position.needsUpdate = true;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[buffers.positions, 3]}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[buffers.colors, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        vertexColors
        size={particleConfig.size}
        sizeAttenuation
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}
