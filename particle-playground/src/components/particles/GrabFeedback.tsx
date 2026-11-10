"use client";

import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh, MeshBasicMaterial } from "three";
import type { GrabView } from "@/lib/grab-controller";

const NEAR_COLOR = 0xa78bfa;
const HELD_COLOR = 0x67e8f9;

/**
 * A ring at the hand's pinch point. Dim and small when the hand is close
 * enough to grab the formation; bright and larger while it is being held.
 * Driven by refs, so it never causes a React update.
 */
export function GrabFeedback({ view }: { view: RefObject<GrabView> }) {
  const ring = useRef<Mesh>(null);
  const material = useRef<MeshBasicMaterial>(null);

  useFrame(() => {
    const mesh = ring.current;
    const paint = material.current;
    if (!mesh || !paint) {
      return;
    }

    const { hint, hintPoint } = view.current;
    mesh.visible = hint !== "none";
    if (hint === "none") {
      return;
    }

    const held = hint === "held";
    mesh.position.set(hintPoint.x, hintPoint.y, hintPoint.z);
    mesh.scale.setScalar(held ? 1 : 0.7);
    paint.color.setHex(held ? HELD_COLOR : NEAR_COLOR);
    paint.opacity = held ? 0.95 : 0.45;
  });

  return (
    <mesh ref={ring} visible={false} renderOrder={10}>
      <ringGeometry args={[0.28, 0.34, 40]} />
      <meshBasicMaterial
        ref={material}
        transparent
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}
