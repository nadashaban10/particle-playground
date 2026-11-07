"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

type CameraPreviewProps = {
  videoRef?: RefObject<HTMLVideoElement | null>;
  className?: string;
};

export function CameraPreview({ videoRef, className }: CameraPreviewProps) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = internalRef.current;
    if (!video) {
      return;
    }

    let stream: MediaStream | null = null;
    let cancelled = false;

    async function start(element: HTMLVideoElement) {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser cannot access a camera.");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });

        if (cancelled) {
          stopCamera(stream);
          return;
        }

        element.srcObject = stream;
        await element.play();
      } catch (caught) {
        if (!cancelled) {
          setError(cameraErrorMessage(caught));
        }
      }
    }

    void start(video);

    return () => {
      cancelled = true;
      video.srcObject = null;
      if (stream) {
        stopCamera(stream);
      }
    };
  }, []);

  const setVideo = useCallback(
    (node: HTMLVideoElement | null) => {
      internalRef.current = node;
      if (videoRef) {
        videoRef.current = node;
      }
    },
    [videoRef],
  );

  return (
    <div className={className ?? "w-full max-w-xl"}>
      <video
        ref={setVideo}
        className="aspect-video w-full rounded-xl bg-black object-cover [transform:scaleX(-1)]"
        playsInline
        muted
        autoPlay
      />
      {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
    </div>
  );
}

function stopCamera(stream: MediaStream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function cameraErrorMessage(caught: unknown): string {
  if (!(caught instanceof DOMException)) {
    return "The camera could not be started.";
  }

  switch (caught.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera permission was denied.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera is already in use.";
    case "SecurityError":
      return "Camera access requires a secure connection.";
    default:
      return "The camera could not be started.";
  }
}
