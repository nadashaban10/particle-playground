"use client";

import { useCallback, useRef, useState } from "react";
import { CameraPreview } from "@/components/camera/CameraPreview";
import { ExperienceIntro } from "@/components/experience/ExperienceIntro";
import { HandTrackingDemo } from "@/components/hand-tracking/HandTrackingDemo";
import { ParticleScene } from "@/components/particles/ParticleScene";

export function Experience() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const handleGesture = useCallback(() => {}, []);

  if (!started) {
    return (
      <ExperienceIntro
        error={null}
        pending={false}
        onStart={() => setStarted(true)}
      />
    );
  }

  return (
    <main className="relative h-dvh w-full">
      <ParticleScene />
      <div className="absolute bottom-6 left-6 w-48 rounded-2xl bg-zinc-950/80 p-3 ring-1 ring-white/10 backdrop-blur">
        <CameraPreview videoRef={videoRef} />
        <HandTrackingDemo
          active
          videoRef={videoRef}
          onGesture={handleGesture}
        />
      </div>
    </main>
  );
}
