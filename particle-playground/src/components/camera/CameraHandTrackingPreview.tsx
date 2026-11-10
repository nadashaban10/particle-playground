"use client";

import { useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { CameraPreview } from "@/components/camera/CameraPreview";
import { HandTracking } from "@/components/hand-tracking/HandTracking";
import { particleConfig } from "@/components/particles/particle-config";
import { PaintTrails } from "@/components/particles/PaintTrails";
import { StudioToolbar } from "@/components/studio/StudioToolbar";

export function CameraHandTrackingPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <div className="relative h-dvh w-full">
      <CameraPreview videoRef={videoRef} fill className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 z-[5]">
        <Canvas
          camera={{
            position: [0, 0, particleConfig.cameraZ],
            fov: particleConfig.cameraFov,
          }}
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: true }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0);
          }}
          style={{ background: "transparent" }}
        >
          <PaintTrails />
        </Canvas>
      </div>
      <HandTracking videoRef={videoRef} />
      <StudioToolbar controls={["brushSize", "trailIntensity"]} />
    </div>
  );
}
