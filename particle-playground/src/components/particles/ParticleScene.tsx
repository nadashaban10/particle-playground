"use client";

import { useRef, useState, type RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { type Mesh, type Vector3 } from "three";
import { particleConfig } from "@/components/particles/particle-config";
import { ParticleSystem } from "@/components/particles/ParticleSystem";
import { useMouseTarget } from "@/hooks/use-mouse-target";
import type { InteractionMode } from "@/types/particles";

export function ParticleScene() {
  const [interaction, setInteraction] = useState<InteractionMode>(
    particleConfig.interaction,
  );

  function toggleInteraction() {
    setInteraction((current) =>
      current === "attraction" ? "repulsion" : "attraction",
    );
  }

  return (
    <div className="relative h-dvh w-full">
      <Canvas
        camera={{
          position: [0, 0, particleConfig.cameraZ],
          fov: particleConfig.cameraFov,
        }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={[particleConfig.background]} />
        <MouseParticles interaction={interaction} />
      </Canvas>
      <button
        type="button"
        onClick={toggleInteraction}
        className="absolute top-6 right-6 rounded-full bg-zinc-950/80 px-4 py-2 text-sm text-zinc-100 ring-1 ring-white/15"
      >
        {interaction === "attraction" ? "Attraction" : "Repulsion"}
      </button>
    </div>
  );
}

function MouseParticles({ interaction }: { interaction: InteractionMode }) {
  const target = useMouseTarget();

  return (
    <>
      <TargetMarker target={target} />
      <ParticleSystem interaction={interaction} target={target} />
    </>
  );
}

function TargetMarker({ target }: { target: RefObject<Vector3> }) {
  const marker = useRef<Mesh>(null);

  useFrame(() => {
    if (!marker.current || !target.current) {
      return;
    }

    marker.current.position.copy(target.current);
  });

  return (
    <mesh ref={marker}>
      <sphereGeometry args={[0.06, 16, 16]} />
      <meshBasicMaterial color="#f4f4f5" />
    </mesh>
  );
}
