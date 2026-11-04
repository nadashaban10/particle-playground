"use client";

import { useEffect, type RefObject } from "react";

type CameraPreviewProps = {
  stream: MediaStream | null;
  videoRef: RefObject<HTMLVideoElement | null>;
};

export function CameraPreview({ stream, videoRef }: CameraPreviewProps) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) {
      return;
    }

    video.srcObject = stream;
    void video.play();

    return () => {
      video.srcObject = null;
    };
  }, [stream, videoRef]);

  return (
    <video
      ref={videoRef}
      className="h-36 w-48 rounded-xl bg-black object-cover [transform:scaleX(-1)]"
      playsInline
      muted
      autoPlay
    />
  );
}

export function startCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
    audio: false,
  });
}

export function stopCamera(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}
