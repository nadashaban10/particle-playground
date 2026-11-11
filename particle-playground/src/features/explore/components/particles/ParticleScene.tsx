"use client";

import { useRef, useState, type RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Vector3, type Group, type Mesh } from "three";
import { CameraOnboarding } from "@/features/hand-tracking/components/CameraOnboarding";
import { WorldHandCamera } from "@/features/hand-tracking/components/WorldHandCamera";
import { particleConfig } from "@/shared/config/particle-config";
import { HandFeedback } from "@/features/explore/components/particles/HandFeedback";
import { HandGrabController } from "@/features/explore/components/particles/HandGrabController";
import { HandInteractionBridge } from "@/features/explore/components/particles/HandInteractionBridge";
import { ParticleSystem } from "@/features/explore/components/particles/ParticleSystem";
import { ExploreToolbar } from "@/features/explore/components/ExploreToolbar";
import type { FormationName } from "@/shared/lib/formations";
import {
  createFormationSwitchRequest,
  takeFormationSwitchRequest,
  type FormationSwitchRequest,
} from "@/shared/lib/formation-switch";
import { createLocalForceField } from "@/shared/lib/gesture-force-field";
import { createGrabView, type GrabView } from "@/shared/lib/grab-controller";
import { createHandFeedbackState } from "@/shared/lib/hand-feedback";
import type { PaletteName } from "@/shared/lib/palettes";
import { useMouseTarget } from "@/shared/hooks/use-mouse-target";
import type { InteractionMode } from "@/shared/types/particles";

export function ParticleScene() {
  const [interaction, setInteraction] = useState<InteractionMode>(
    particleConfig.interaction,
  );
  const [formation, setFormation] = useState<FormationName>("galaxy");
  const [palette, setPalette] = useState<PaletteName>("cosmic");
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraSession, setCameraSession] = useState(0);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  function toggleInteraction() {
    setInteraction((current) =>
      current === "attraction" ? "repulsion" : "attraction",
    );
  }

  function enableCamera() {
    setOnboardingDismissed(true);
    setCameraEnabled(true);
  }

  function toggleCamera() {
    setCameraEnabled((current) => {
      const next = !current;
      if (next) {
        setOnboardingDismissed(true);
      }
      return next;
    });
  }

  function retryCamera() {
    setCameraSession((value) => value + 1);
    setCameraEnabled(true);
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden">
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
          onFormationChange={setFormation}
          palette={palette}
          cameraEnabled={cameraEnabled}
        />
      </Canvas>
      {cameraEnabled ? (
        <WorldHandCamera key={cameraSession} onRetry={retryCamera} />
      ) : null}
      <CameraOnboarding
        visible={!cameraEnabled && !onboardingDismissed}
        onEnableCamera={enableCamera}
        onDismiss={() => setOnboardingDismissed(true)}
      />
      <ExploreToolbar
        formation={formation}
        onFormationChange={setFormation}
        palette={palette}
        onPaletteChange={setPalette}
        interaction={interaction}
        onToggleInteraction={toggleInteraction}
        cameraEnabled={cameraEnabled}
        onToggleCamera={toggleCamera}
      />
    </div>
  );
}

function MouseParticles({
  interaction,
  formation,
  onFormationChange,
  palette,
  cameraEnabled,
}: {
  interaction: InteractionMode;
  formation: FormationName;
  onFormationChange: (formation: FormationName) => void;
  palette: PaletteName;
  cameraEnabled: boolean;
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
  // While the camera is on, hands own the artwork: the pointer force is off.
  const pointerGate = useRef({ holding: false });
  // Open-palm / fist force fields: written by the grab controller, read by the physics.
  const [forceField] = useState(() => ({ current: createLocalForceField() }));
  // Animation state for the hand indicators: stepped by the controller, drawn by HandFeedback.
  const [feedback] = useState(() => ({ current: createHandFeedbackState() }));
  // V-sign formation requests: written by the controller, drained into React once.
  const [formationRequest] = useState(() => ({
    current: createFormationSwitchRequest(),
  }));

  useFrame(() => {
    pointerGate.current.holding = cameraEnabled || grabView.current.holding;
  });

  return (
    <>
      {!cameraEnabled ? <TargetMarker target={target} /> : null}
      <FormationSwitchDrain
        request={formationRequest}
        onChange={onFormationChange}
      />
      <HandGrabController
        groupRef={groupRef}
        formation={formation}
        worldTarget={target}
        localTarget={localTarget}
        view={grabView}
        forceField={forceField}
        feedback={feedback}
        formationRequest={formationRequest}
        trackingActive={cameraEnabled}
      />
      <group ref={groupRef}>
        <ParticleSystem
          interaction={interaction}
          formation={formation}
          palette={palette}
          target={localTarget}
          pointerSuspended={pointerGate}
          gestureField={forceField}
        />
      </group>
      <HandFeedback feedback={feedback} />
    </>
  );
}

/**
 * Applies a pending V-sign formation change to React state. Runs after the
 * grab controller (default priority), so a request published this frame is
 * consumed the same frame. Only calls React when something actually fired.
 */
function FormationSwitchDrain({
  request,
  onChange,
}: {
  request: RefObject<FormationSwitchRequest>;
  onChange: (formation: FormationName) => void;
}) {
  useFrame(() => {
    const next = takeFormationSwitchRequest(request.current);
    if (next !== null) {
      onChange(next);
    }
  });

  return null;
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
