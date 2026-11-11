"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { CameraStreamPhase } from "@/shared/lib/camera-experience";

export type CameraLifecycleState = {
  phase: CameraStreamPhase;
  error: string | null;
};

type CameraPreviewProps = {
  videoRef?: RefObject<HTMLVideoElement | null>;
  className?: string;
  fill?: boolean;
  /**
   * Optional lifecycle updates for a host UI. `/camera` does not need this;
   * the main world uses it to separate camera readiness from hand tracking.
   */
  onLifecycleChange?: (state: CameraLifecycleState) => void;
  /** When false, the host shows errors itself (avoids duplicate copy in the PIP). */
  showError?: boolean;
};

export function CameraPreview({
  videoRef,
  className,
  fill = false,
  onLifecycleChange,
  showError = true,
}: CameraPreviewProps) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onLifecycleRef = useRef(onLifecycleChange);

  useEffect(() => {
    onLifecycleRef.current = onLifecycleChange;
  }, [onLifecycleChange]);

  useEffect(() => {
    const video = internalRef.current;
    if (!video) {
      return;
    }

    let stream: MediaStream | null = null;
    let cancelled = false;
    const trackCleanups: Array<() => void> = [];

    function publish(phase: CameraStreamPhase, nextError: string | null) {
      onLifecycleRef.current?.({ phase, error: nextError });
    }

    function watchTracks(active: MediaStream) {
      for (const track of active.getVideoTracks()) {
        const onEnded = () => {
          if (cancelled) {
            return;
          }
          setError("Camera disconnected");
          publish("ended", "Camera disconnected");
        };
        track.addEventListener("ended", onEnded);
        trackCleanups.push(() => track.removeEventListener("ended", onEnded));
      }
    }

    async function start(element: HTMLVideoElement) {
      if (!navigator.mediaDevices?.getUserMedia) {
        const message = "This browser cannot access a camera.";
        setError(message);
        publish("error", message);
        return;
      }

      publish("requesting", null);

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
        watchTracks(stream);
        await element.play();

        if (!cancelled) {
          setError(null);
          publish("ready", null);
        }
      } catch (caught) {
        if (!cancelled) {
          const message = cameraErrorMessage(caught);
          setError(message);
          publish("error", message);
        }
      }
    }

    void start(video);

    return () => {
      cancelled = true;
      for (const cleanup of trackCleanups) {
        cleanup();
      }
      video.srcObject = null;
      if (stream) {
        stopCamera(stream);
      }
      publish("idle", null);
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
    <div className={`relative ${className ?? "w-full"}`}>
      <video
        ref={setVideo}
        className={
          fill
            ? "h-[calc(100%-2rem)] w-[95%]  m-auto bg-black object-cover [transform:scaleX(-1)]"
            : "aspect-video w-full rounded-xl m-auto bg-black object-cover [transform:scaleX(-1)]"
        }
        playsInline
        muted
        autoPlay
      />
      {showError && error ? (
        <p
          className={
            fill
              ? "absolute top-4 left-4 z-20 max-w-[calc(100%-9rem)] text-left text-sm text-rose-300"
              : "mt-3 text-sm text-rose-300"
          }
        >
          {error}
        </p>
      ) : null}
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
