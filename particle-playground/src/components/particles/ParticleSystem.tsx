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
import { getCreativeSettings } from "@/lib/creative-settings";
import {
  createFormationTargets,
  formationConfig,
  writeWaveHeights,
  type FormationName,
} from "@/lib/formations";
import type { LocalForceField } from "@/lib/gesture-force-field";
import { writePaletteColors, type PaletteName } from "@/lib/palettes";
import { createParticleBuffers, stepParticles } from "@/lib/particle-motion";
import type { InteractionMode } from "@/types/particles";

type ParticleSystemProps = {
  interaction: InteractionMode;
  formation: FormationName;
  palette: PaletteName;
  /** Pointer target in this system's local space. */
  target: RefObject<Vector3>;
  /** While `holding` is true the pointer force is switched off (a hand holds the formation). */
  pointerSuspended?: RefObject<{ holding: boolean }>;
  /** Open-palm / fist force fields in this system's local space (optional). */
  gestureField?: RefObject<LocalForceField>;
};

export function ParticleSystem({
  interaction,
  formation,
  palette,
  target,
  pointerSuspended,
  gestureField,
}: ParticleSystemProps) {
  const points = useRef<Points>(null);
  const elapsed = useRef(0);
  const appliedPalette = useRef<PaletteName | null>(null);
  const buffers = useMemo(() => createParticleBuffers(particleConfig), []);
  // Same physics with the pointer force at zero; swapped in while suspended.
  const suspendedConfig = useMemo(
    () => ({ ...particleConfig, forceStrength: 0 }),
    [],
  );
  const formations = useMemo(
    () => createFormationTargets(particleConfig.count, particleConfig.bounds),
    [],
  );

  useFrame((_, delta) => {
    const geometry = points.current?.geometry;
    const position = geometry?.getAttribute("position");
    const color = geometry?.getAttribute("color");
    if (!(position instanceof BufferAttribute) || !(color instanceof BufferAttribute)) {
      return;
    }

    if (appliedPalette.current !== palette) {
      writePaletteColors(buffers.colors, palette);
      color.needsUpdate = true;
      appliedPalette.current = palette;
    }

    if (!target.current) {
      return;
    }

    elapsed.current += delta;
    const targets = formations[formation];
    if (formation === "wave") {
      writeWaveHeights(formations, elapsed.current);
    }

    stepParticles(
      buffers.positions,
      buffers.velocities,
      pointerSuspended?.current?.holding ? suspendedConfig : particleConfig,
      delta,
      interaction,
      target.current,
      targets,
      formationConfig.formationStrength,
      getCreativeSettings().ambientSpeed,
      gestureField?.current ?? null,
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
