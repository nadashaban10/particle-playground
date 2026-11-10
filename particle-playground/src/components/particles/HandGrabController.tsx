"use client";

import { useMemo, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { PerspectiveCamera, type Group, type Vector3 } from "three";
import { particleConfig } from "@/components/particles/particle-config";
import { createFormationTargets, type FormationName } from "@/lib/formations";
import { measureFormationExtents } from "@/lib/formation-extents";
import {
  createGrabController,
  setGrabBounds,
  stepGrabController,
  writeLocalTarget,
  type GrabView,
} from "@/lib/grab-controller";
import type { LocalForceField } from "@/lib/gesture-force-field";
import { handInteractionSource } from "@/lib/hand-interaction-source";

/**
 * Frame order inside the Canvas. R3F runs subscribers from the lowest priority
 * to the highest, and only a priority above 0 takes over rendering, so these
 * negative values order the work without touching how the scene renders:
 *
 *   -3  HandInteractionBridge  detection -> world samples
 *   -2  HandGrabController     samples -> grab -> group position -> local pointer
 *    0  ParticleSystem         physics, using the local pointer target
 */
export const GRAB_CONTROLLER_PRIORITY = -2;

type HandGrabControllerProps = {
  /** The parent group that carries the formation's world translation. */
  groupRef: RefObject<Group | null>;
  formation: FormationName;
  /** Smoothed pointer target in world space (written by `useMouseTarget`). */
  worldTarget: RefObject<Vector3>;
  /** The same target in the group's local space, for the particle physics. */
  localTarget: RefObject<Vector3>;
  view: RefObject<GrabView>;
  /**
   * Receives the open-palm / fist force fields, in the group's local space,
   * for the particle physics. Rewritten in place every frame.
   */
  forceField: RefObject<LocalForceField>;
};

/**
 * Connects the hand interactions to the formation group. Renders nothing. Each
 * frame it reads the latest hand samples, steps the single-hand grab and the
 * two-hand transform, eases the group's position, roll and scale toward their
 * targets within the visible limits, and writes the pointer target in the
 * group's space (through its full inverse matrix). With no hand samples
 * (camera off) it does nothing but keep the local pointer target equal to the
 * world one while the group is untransformed, and correct after a transform.
 * It also derives the open-palm / fist force fields from the same samples.
 */
export function HandGrabController({
  groupRef,
  formation,
  worldTarget,
  localTarget,
  view,
  forceField,
}: HandGrabControllerProps) {
  const controller = useMemo(() => createGrabController(), []);
  // Formation targets are deterministic, so this matches the particle system's.
  const extents = useMemo(
    () =>
      measureFormationExtents(
        createFormationTargets(particleConfig.count, particleConfig.bounds),
      ),
    [],
  );

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) {
      return;
    }

    // The controller derives the limits itself, from this extent, the
    // camera, and the group's current scale and rotation.
    setGrabBounds(
      controller,
      state.camera instanceof PerspectiveCamera ? state.camera : null,
      extents[formation],
    );

    stepGrabController(
      controller,
      group,
      handInteractionSource.current,
      delta,
      view.current,
      forceField.current,
    );

    if (worldTarget.current && localTarget.current) {
      writeLocalTarget(controller, group, worldTarget.current, localTarget.current);
    }
  }, GRAB_CONTROLLER_PRIORITY);

  return null;
}
