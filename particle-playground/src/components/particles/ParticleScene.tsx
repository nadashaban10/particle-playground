"use client";

import { useRef, useState, type RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Vector3, type Group, type Mesh } from "three";
import { WorldHandCamera } from "@/components/hand-tracking/WorldHandCamera";
import { particleConfig } from "@/components/particles/particle-config";
import { GrabFeedback } from "@/components/particles/GrabFeedback";
import { HandGrabController } from "@/components/particles/HandGrabController";
import { HandInteractionBridge } from "@/components/particles/HandInteractionBridge";
import { ParticleSystem } from "@/components/particles/ParticleSystem";
import { StudioToolbar } from "@/components/studio/StudioToolbar";
import type { FormationName } from "@/lib/formations";
import { createLocalForceField } from "@/lib/gesture-force-field";
import { createGrabView, type GrabView } from "@/lib/grab-controller";
import type { PaletteName } from "@/lib/palettes";
import { useMouseTarget } from "@/hooks/use-mouse-target";
import type { InteractionMode } from "@/types/particles";

export function ParticleScene() {
  const [interaction, setInteraction] = useState<InteractionMode>(
    particleConfig.interaction,
  );
  const [formation, setFormation] = useState<FormationName>("galaxy");
  const [palette, setPalette] = useState<PaletteName>("cosmic");
  const [cameraEnabled, setCameraEnabled] = useState(false);

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
        <HandInteractionBridge />
        <MouseParticles
          interaction={interaction}
          formation={formation}
          palette={palette}
        />
      </Canvas>
      {cameraEnabled ? <WorldHandCamera /> : null}
      <StudioToolbar
        formation={formation}
        onFormationChange={setFormation}
        palette={palette}
        onPaletteChange={setPalette}
        interaction={interaction}
        onToggleInteraction={toggleInteraction}
        cameraEnabled={cameraEnabled}
        onToggleCamera={() => setCameraEnabled((current) => !current)}
      />
    </div>
  );
}

function MouseParticles({
  interaction,
  formation,
  palette,
}: {
  interaction: InteractionMode;
  formation: FormationName;
  palette: PaletteName;
}) {
  // The pointer target lives in world space; the formation lives in a group
  // that a hand can move, so the physics gets the target in the group's space.
  const target = useMouseTarget();
  const groupRef = useRef<Group>(null);
  const localTarget = useRef(
    new Vector3(
      particleConfig.target.x,
      particleConfig.target.y,
      particleConfig.target.z,
    ),
  );
  const grabView = useRef<GrabView>(createGrabView());
  // Open-palm / fist force fields: written by the grab controller, read by the physics.
  const [forceField] = useState(() => ({ current: createLocalForceField() }));

  return (
    <>
      <TargetMarker target={target} />
      <HandGrabController
        groupRef={groupRef}
        formation={formation}
        worldTarget={target}
        localTarget={localTarget}
        view={grabView}
        forceField={forceField}
      />
      <group ref={groupRef}>
        <ParticleSystem
          interaction={interaction}
          formation={formation}
          palette={palette}
          target={localTarget}
          pointerSuspended={grabView}
          gestureField={forceField}
        />
      </group>
      <GrabFeedback view={grabView} />
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
