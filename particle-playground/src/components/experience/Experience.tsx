"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CameraPreview,
  startCamera,
  stopCamera,
} from "@/components/camera/CameraPreview";
import { ExperienceIntro } from "@/components/experience/ExperienceIntro";
import { HandTrackingDemo } from "@/components/hand-tracking/HandTrackingDemo";
import { ParticleScene } from "@/components/particles/ParticleScene";
import type { GestureName } from "@/types/hand-tracking";

export function Experience() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gesture, setGesture] = useState<GestureName>("none");

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        stopCamera(streamRef.current);
      }
    };
  }, []);

  const handleStart = useCallback(async () => {
    setPending(true);
    setError(null);

    try {
      const next = await startCamera();
      streamRef.current = next;
      setStream(next);
    } catch {
      setError("Camera access is required to track your hands.");
    } finally {
      setPending(false);
    }
  }, []);

  const handleGesture = useCallback((next: GestureName) => {
    setGesture((current) => (current === next ? current : next));
  }, []);

  if (!stream) {
    return (
      <ExperienceIntro error={error} pending={pending} onStart={handleStart} />
    );
  }

  return (
    <main className="relative h-dvh w-full">
      <ParticleScene gesture={gesture} />
      <div className="absolute bottom-6 left-6 flex flex-col gap-3 rounded-2xl bg-zinc-950/80 p-3 ring-1 ring-white/10 backdrop-blur">
        <CameraPreview stream={stream} videoRef={videoRef} />
        <HandTrackingDemo
          active
          videoRef={videoRef}
          onGesture={handleGesture}
        />
      </div>
    </main>
  );
}
