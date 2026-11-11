"use client";

import { useEffect, useMemo, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { PerspectiveCamera, type Group, type Vector3 } from "three";
import { particleConfig } from "@/shared/config/particle-config";
import { createFormationTargets, type FormationName } from "@/shared/lib/formations";
import { measureFormationExtents } from "@/shared/lib/formation-extents";
import {
  createFormationSwitchState,
  publishFormationSwitch,
  resetFormationSwitch,
  stepFormationSwitch,
  type FormationSwitchRequest,
} from "@/shared/lib/formation-switch";
import {
  createGrabController,
  setGrabBounds,
  stepGrabController,
  writeLocalTarget,
  type GrabView,
} from "@/shared/lib/grab-controller";
import { clearGestureForces } from "@/shared/lib/gesture-forces";
import type { LocalForceField } from "@/shared/lib/gesture-force-field";
import { cancelGrab } from "@/shared/lib/grab-interaction";
import {
  resetHandFeedback,
  stepHandFeedback,
  type HandFeedbackState,
} from "@/shared/lib/hand-feedback";
import { handInteractionSource } from "@/shared/lib/hand-interaction-source";
import { resetTwoHand } from "@/shared/lib/two-hand-transform";

/**
 * Frame order inside the Canvas. R3F runs subscribers from the lowest priority
 * to the highest, and only a priority above 0 takes over rendering, so these
 * negative values order the work without touching how the scene renders:
 *
 *   -3  HandInteractionBridge  detection -> world samples
 *   -2  HandGrabController     grab/two -> forces -> V-switch -> feedback
 *    0  ParticleSystem         physics / FormationSwitchDrain
 *
 * Interaction priority is documented on `stepGrabController`. This component
 * only sequences the steppers; it does not add a second source of truth.
 */
export const GRAB_CONTROLLER_PRIORITY = -2;

type HandGrabControllerProps = {
  /** The parent group that carries the formation's world translation. */
  groupRef: RefObject<Group | null>;
  /** Current formation (React). Used for grab bounds and V-sign cycling. */
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
  /**
   * Animation state for the hand indicators. Stepped here, after the grab, the
   * two-hand transform, the forces and the formation switch for the frame.
   */
  feedback: RefObject<HandFeedbackState>;
  /**
   * One-shot drain slot for a V-sign formation change. Written here; React
   * consumes it outside the animation loop.
   */
  formationRequest: RefObject<FormationSwitchRequest>;
  /**
   * True while the world camera card is mounted. When it becomes false, grab,
   * two-hand, forces, V-sign and feedback are hard-reset so nothing stale
   * survives a camera stop.
   */
  trackingActive: boolean;
};

/**
 * Connects the hand interactions to the formation group. Renders nothing. Each
 * frame it reads the latest hand samples, steps the single-hand grab and the
 * two-hand transform, eases the group's position, roll and scale toward their
 * targets within the visible limits, and writes the pointer target in the
 * group's space (through its full inverse matrix). With no hand samples
 * (camera off) it does nothing but keep the local pointer target equal to the
 * world one while the group is untransformed, and correct after a transform.
 * It also derives the open-palm / fist force fields from the same samples, and
 * advances the V-sign formation switcher (without owning formation React state).
 */
export function HandGrabController({
  groupRef,
  formation,
  worldTarget,
  localTarget,
  view,
  forceField,
  feedback,
  formationRequest,
  trackingActive,
}: HandGrabControllerProps) {
  const controller = useMemo(() => createGrabController(), []);
  const formationSwitch = useMemo(() => createFormationSwitchState(), []);
  // Formation targets are deterministic, so this matches the particle system's.
  const extents = useMemo(
    () =>
      measureFormationExtents(
        createFormationTargets(particleConfig.count, particleConfig.bounds),
      ),
    [],
  );

  useEffect(() => {
    if (trackingActive) {
      return;
    }

    cancelGrab(controller.grab);
    resetTwoHand(controller.two);
    clearGestureForces(controller.forces);
    resetFormationSwitch(formationSwitch);

    clearLocalForceField(forceField.current);
    if (feedback.current) {
      resetHandFeedback(feedback.current);
    }
    clearGrabView(view.current);
    clearFormationRequest(formationRequest.current);
  }, [
    trackingActive,
    controller,
    formationSwitch,
    forceField,
    feedback,
    view,
    formationRequest,
  ]);

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

    const samples = trackingActive ? handInteractionSource.current : [];

    stepGrabController(
      controller,
      group,
      samples,
      delta,
      view.current,
      forceField.current,
    );

    if (worldTarget.current && localTarget.current) {
      writeLocalTarget(controller, group, worldTarget.current, localTarget.current);
    }

    if (!trackingActive) {
      return;
    }

    stepFormationSwitch(
      formationSwitch,
      samples,
      controller.grab,
      controller.two,
      formation,
      delta,
    );

    if (formationRequest.current) {
      publishFormationSwitch(formationSwitch, formationRequest.current);
    }

    if (feedback.current) {
      stepHandFeedback(
        feedback.current,
        samples,
        controller.grab,
        controller.two,
        controller.forces,
        group.position,
        delta,
        formationSwitch,
      );
    }
  }, GRAB_CONTROLLER_PRIORITY);

  return null;
}

function clearLocalForceField(field: LocalForceField | null | undefined): void {
  if (field) {
    field.count = 0;
  }
}

function clearGrabView(grabView: GrabView | null | undefined): void {
  if (!grabView) {
    return;
  }

  grabView.holding = false;
  grabView.hint = "none";
  grabView.mode = "none";
}

function clearFormationRequest(
  request: FormationSwitchRequest | null | undefined,
): void {
  if (request) {
    request.pending = null;
  }
}
