"use client";

import { useRef } from "react";
import { CameraPreview } from "@/components/camera/CameraPreview";
import { HandTracking } from "@/components/hand-tracking/HandTracking";

export function CameraHandTrackingPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <div className="w-full max-w-xl">
      <CameraPreview videoRef={videoRef} />
      <HandTracking videoRef={videoRef} />
    </div>
  );
}
