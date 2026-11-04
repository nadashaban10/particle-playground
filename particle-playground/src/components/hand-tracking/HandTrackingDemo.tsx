"use client";

import { useEffect, useState, type RefObject } from "react";
import { createHandLandmarker, readHands } from "@/services/hand-landmarker";
import type { GestureName } from "@/types/hand-tracking";

type HandTrackingDemoProps = {
  active: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  onGesture: (gesture: GestureName) => void;
};

const GESTURE_LABEL: Record<GestureName, string> = {
  none: "No gesture",
  open_palm: "Open palm",
  closed_fist: "Closed fist",
  pinch: "Pinch",
  point: "Point",
};

export function HandTrackingDemo({
  active,
  videoRef,
  onGesture,
}: HandTrackingDemoProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [gesture, setGesture] = useState<GestureName>("none");

  useEffect(() => {
    if (!active) {
      return;
    }

    let frame = 0;
    let stopped = false;

    async function track() {
      setStatus("loading");

      try {
        const landmarker = await createHandLandmarker();
        if (stopped) {
          return;
        }

        setStatus("ready");

        const tick = () => {
          if (stopped) {
            return;
          }

          const video = videoRef.current;
          if (video) {
            const hands = readHands(landmarker, video, performance.now());
            const next = hands[0]?.gesture ?? "none";
            setGesture((current) => (current === next ? current : next));
            onGesture(next);
          }

          frame = requestAnimationFrame(tick);
        };

        frame = requestAnimationFrame(tick);
      } catch {
        if (!stopped) {
          setStatus("error");
        }
      }
    }

    void track();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [active, onGesture, videoRef]);

  return (
    <p className="text-sm text-zinc-200">
      {status === "loading" && "Loading hand tracking…"}
      {status === "error" && "Hand tracking failed to start."}
      {status === "ready" && GESTURE_LABEL[gesture]}
    </p>
  );
}
