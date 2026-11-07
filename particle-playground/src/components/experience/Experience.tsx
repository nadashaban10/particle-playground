"use client";

import { useRef, useState } from "react";
import { CameraPreview } from "@/components/camera/CameraPreview";
import { ExperienceIntro } from "@/components/experience/ExperienceIntro";
import { HandTracking } from "@/components/hand-tracking/HandTracking";
import { ParticleScene } from "@/components/particles/ParticleScene";

export function Experience() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

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
        <HandTracking videoRef={videoRef} />
      </div>
    </main>
  );
}
