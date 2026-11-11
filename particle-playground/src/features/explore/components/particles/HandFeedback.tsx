"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  type BufferGeometry,
  type Texture,
} from "three";
import {
  samplePulse,
  setHandFeedbackReducedMotion,
  type HandFeedbackState,
  type HandVisual,
  type PulseSample,
  type TwoHandVisual,
} from "@/shared/lib/hand-feedback";

/**
 * Draws the hand indicators and the two-hand overlay. It owns nothing but
 * meshes: all the state lives in `HandFeedbackState`, which is stepped by the
 * grab controller (priority -2) and only read here, so there is no React state
 * and no per-frame render. Every mesh and material is created once, then
 * reused: a frame only sets numbers on them.
 *
 * Per hand: a soft glow, a small centre dot, a thin core ring, and a few
 * pooled pulse rings. Per two-hand transform: one line, one ring.
 */

/** Visibility cutoffs: below this a mesh is hidden rather than drawn at ~0. */
const HIDDEN_BELOW = 0.004;
const RENDER_ORDER = 10;
/** The centre dot, as a fraction of the core ring. */
const DOT_SCALE = 0.32;

type HandRig = {
  root: Group;
  glow: Mesh;
  dot: Mesh;
  ring: Mesh;
  pulses: Mesh[];
};

type TwoRig = {
  root: Group;
  line: Mesh;
  ring: Mesh;
};

type Rig = {
  root: Group;
  hands: HandRig[];
  two: TwoRig;
  dispose: () => void;
};

/** A soft round falloff, drawn once. */
function createGlowTexture(): Texture | null {
  if (typeof document === "undefined") {
    return null;
  }

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.35)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  return new CanvasTexture(canvas);
}

function createRig(pulsesPerHand: number, handCount: number): Rig {
  const disposables: { dispose: () => void }[] = [];
  const glowTexture = createGlowTexture();

  if (glowTexture) {
    disposables.push(glowTexture);
  }

  const ringGeometry = new RingGeometry(0.88, 1, 56);
  const pulseGeometry = new RingGeometry(0.94, 1, 72);
  const hairlineGeometry = new RingGeometry(0.992, 1, 128);
  const planeGeometry = new PlaneGeometry(1, 1);
  disposables.push(ringGeometry, pulseGeometry, hairlineGeometry, planeGeometry);

  function mesh(geometry: BufferGeometry, map: Texture | null): Mesh {
    const material = new MeshBasicMaterial({
      map: map ?? null,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    disposables.push(material);

    const result = new Mesh(geometry, material);
    result.visible = false;
    result.frustumCulled = false;
    result.renderOrder = RENDER_ORDER;
    return result;
  }

  const root = new Group();
  const hands: HandRig[] = [];

  for (let index = 0; index < handCount; index += 1) {
    const handRoot = new Group();
    const glow = mesh(planeGeometry, glowTexture);
    const dot = mesh(planeGeometry, glowTexture);
    const ring = mesh(ringGeometry, null);
    const pulses: Mesh[] = [];

    handRoot.add(glow, dot, ring);

    for (let pulse = 0; pulse < pulsesPerHand; pulse += 1) {
      const ripple = mesh(pulseGeometry, null);
      pulses.push(ripple);
      handRoot.add(ripple);
    }

    handRoot.visible = false;
    root.add(handRoot);
    hands.push({ root: handRoot, glow, dot, ring, pulses });
  }

  const twoRoot = new Group();
  const line = mesh(planeGeometry, null);
  const twoRing = mesh(hairlineGeometry, null);
  twoRoot.add(line, twoRing);
  twoRoot.visible = false;
  root.add(twoRoot);

  return {
    root,
    hands,
    two: { root: twoRoot, line, ring: twoRing },
    dispose: () => {
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}

function setLook(
  target: Mesh,
  opacity: number,
  r: number,
  g: number,
  b: number,
): boolean {
  const visible = opacity > HIDDEN_BELOW;
  target.visible = visible;

  if (visible) {
    const material = target.material as MeshBasicMaterial;
    material.opacity = opacity > 1 ? 1 : opacity;
    material.color.setRGB(r, g, b);
  }

  return visible;
}

const pulseSample: PulseSample = { radius: 0, opacity: 0 };

function updateHand(rig: HandRig, hand: HandVisual, state: HandFeedbackState): void {
  const { config } = state;
  const shown = hand.key !== null && hand.placed;
  rig.root.visible = shown;

  if (!shown) {
    return;
  }

  const { r, g, b } = hand.color;
  const presence = hand.presence;

  rig.root.position.set(hand.x, hand.y, hand.z);

  const radius = hand.ringRadius;

  if (setLook(rig.ring, hand.ringOpacity * presence, r, g, b)) {
    rig.ring.scale.setScalar(radius);
  }

  if (setLook(rig.glow, hand.glowOpacity * presence, r, g, b)) {
    rig.glow.scale.setScalar(radius * config.glowScale);
  }

  // The dot is the hand's exact position inside the ring.
  if (setLook(rig.dot, hand.ringOpacity * presence * 0.6, r, g, b)) {
    rig.dot.scale.setScalar(radius * DOT_SCALE);
  }

  for (let index = 0; index < rig.pulses.length; index += 1) {
    const pulse = hand.pulses[index];
    const ripple = rig.pulses[index];

    if (!pulse.active) {
      ripple.visible = false;
      continue;
    }

    samplePulse(config, pulse, pulseSample);

    if (setLook(ripple, pulseSample.opacity, r, g, b)) {
      ripple.scale.setScalar(pulseSample.radius);
    }
  }
}

function updateTwo(rig: TwoRig, visual: TwoHandVisual, thickness: number): void {
  const lineShown = visual.lineOpacity > HIDDEN_BELOW;
  const ringShown = visual.ringOpacity > HIDDEN_BELOW;
  rig.root.visible = lineShown || ringShown;

  if (!rig.root.visible) {
    return;
  }

  const { r, g, b } = visual.color;

  rig.root.position.set(visual.mx, visual.my, 0);
  rig.root.rotation.z = visual.angle;

  if (setLook(rig.line, visual.lineOpacity, r, g, b)) {
    // 2 * radius is the distance between the hands; the line is a thin strip.
    rig.line.scale.set(visual.radius * 2, thickness, 1);
  }

  if (setLook(rig.ring, visual.ringOpacity, r, g, b)) {
    rig.ring.scale.setScalar(Math.max(visual.radius, 0.01));
  }
}

type HandFeedbackProps = {
  feedback: RefObject<HandFeedbackState>;
};

export function HandFeedback({ feedback }: HandFeedbackProps) {
  const holder = useRef<Group>(null);
  const rig = useRef<Rig | null>(null);

  useEffect(() => {
    const container = holder.current;
    const state = feedback.current;

    if (!container || !state) {
      return;
    }

    const built = createRig(state.hands[0].pulses.length, state.hands.length);
    container.add(built.root);
    rig.current = built;

    const query =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const apply = () => setHandFeedbackReducedMotion(state, query?.matches ?? false);

    apply();
    query?.addEventListener("change", apply);

    return () => {
      query?.removeEventListener("change", apply);
      container.remove(built.root);
      built.dispose();
      rig.current = null;
    };
  }, [feedback]);

  useFrame(() => {
    const built = rig.current;
    const state = feedback.current;

    if (!built || !state) {
      return;
    }

    for (let index = 0; index < built.hands.length; index += 1) {
      updateHand(built.hands[index], state.hands[index], state);
    }

    updateTwo(built.two, state.two, state.config.twoHand.lineThickness);
  });

  return <group ref={holder} />;
}
