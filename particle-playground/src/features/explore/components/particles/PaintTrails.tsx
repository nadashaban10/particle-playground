"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, PointsMaterial, type Points } from "three";
import { getCreativeSettings } from "@/shared/lib/creative-settings";
import { paintSampleSource } from "@/shared/lib/paint-sample-source";
import { paintTrailConfig } from "@/shared/lib/paint-trail-config";
import { createPaintTrailState, stepPaintTrails } from "@/shared/lib/paint-trails";

export function PaintTrails() {
  const points = useRef<Points>(null);
  const trails = useMemo(() => createPaintTrailState(paintTrailConfig), []);

  useFrame((_, delta) => {
    const pointsObject = points.current;
    const geometry = pointsObject?.geometry;
    const position = geometry?.getAttribute("position");
    const color = geometry?.getAttribute("color");
    if (!(position instanceof BufferAttribute) || !(color instanceof BufferAttribute)) {
      return;
    }

    const settings = getCreativeSettings();
    const material = pointsObject?.material;
    if (material instanceof PointsMaterial && material.size !== settings.brushSize) {
      material.size = settings.brushSize;
    }

    stepPaintTrails(
      trails,
      paintSampleSource.current,
      delta,
      settings.trailIntensity,
    );
    if (trails.positionsDirty) {
      position.needsUpdate = true;
    }
    if (trails.colorsDirty) {
      color.needsUpdate = true;
    }
  });

  useEffect(() => {
    const pointsObject = points.current;
    return () => {
      pointsObject?.geometry.dispose();
      const material = pointsObject?.material;
      if (material && !Array.isArray(material)) {
        material.dispose();
      }
    };
  }, []);

  return (
    <points ref={points} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[trails.positions, 3]}
        />
        <bufferAttribute attach="attributes-color" args={[trails.colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        vertexColors
        size={paintTrailConfig.size}
        sizeAttenuation
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}
