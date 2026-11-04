"use client";

import { Canvas } from "@react-three/fiber";
import { ParticleSystem } from "@/components/particles/ParticleSystem";
import type { GestureName } from "@/types/hand-tracking";

type ParticleSceneProps = {
  gesture?: GestureName;
};

export function ParticleScene({ gesture = "none" }: ParticleSceneProps) {
  return (
    <Canvas
      className="h-full w-full"
      camera={{ position: [0, 0, 6], fov: 60 }}
      dpr={[1, 1.5]}
    >
      <color attach="background" args={["#09090b"]} />
      <ParticleSystem gesture={gesture} />
    </Canvas>
  );
}
