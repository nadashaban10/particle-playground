"use client";

import { useEffect, useState, type RefObject } from "react";
import { readHandTrackingSource } from "@/lib/hand-tracking-source";

type HandTrackingProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
};

export function HandTracking({ videoRef }: HandTrackingProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    function update() {
      setReady(readHandTrackingSource(videoRef.current) !== null);
    }

    update();
    video.addEventListener("loadeddata", update);
    video.addEventListener("emptied", update);

    return () => {
      video.removeEventListener("loadeddata", update);
      video.removeEventListener("emptied", update);
    };
  }, [videoRef]);

  return (
    <p className="mt-3 text-sm text-zinc-300">
      {ready
        ? "Camera video is ready. The hand landmarker is not loaded yet."
        : "Waiting for the camera video."}
    </p>
  );
}
