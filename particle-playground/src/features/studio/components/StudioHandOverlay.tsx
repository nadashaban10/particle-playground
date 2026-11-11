"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type { StudioHandFeedback } from "@/features/studio/lib/hand-adapter";

type StudioHandOverlayProps = {
  feedbackRef: MutableRefObject<StudioHandFeedback>;
  active: boolean;
};

/**
 * High-frequency hand cursor overlay. Reads feedback from a ref — no React
 * state on tracking frames.
 */
export function StudioHandOverlay({
  feedbackRef,
  active,
}: StudioHandOverlayProps) {
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const secondaryRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const frameRef = useRef(0);

  useEffect(() => {
    if (!active) {
      const cursor = cursorRef.current;
      const secondary = secondaryRef.current;
      if (cursor) {
        cursor.style.opacity = "0";
      }
      if (secondary) {
        secondary.style.opacity = "0";
      }
      return;
    }

    const tick = () => {
      const feedback = feedbackRef.current;
      const cursor = cursorRef.current;
      const secondary = secondaryRef.current;
      const label = labelRef.current;

      if (cursor) {
        if (feedback.cursor && feedback.tracking) {
          const color = cursorColor(feedback);
          cursor.style.opacity = "1";
          cursor.style.borderColor = color.border;
          cursor.style.backgroundColor = color.fill;
          cursor.style.transform = `translate3d(${feedback.cursor.x}px, ${feedback.cursor.y}px, 0) translate(-50%, -50%)`;
        } else {
          cursor.style.opacity = "0";
        }
      }

      if (secondary) {
        if (feedback.secondary && feedback.scaling) {
          secondary.style.opacity = "1";
          secondary.style.transform = `translate3d(${feedback.secondary.x}px, ${feedback.secondary.y}px, 0) translate(-50%, -50%)`;
        } else {
          secondary.style.opacity = "0";
        }
      }

      if (label) {
        label.textContent = labelFor(feedback);
      }

      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [active, feedbackRef]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-2xl">
      <div
        ref={cursorRef}
        className="absolute top-0 left-0 h-5 w-5 rounded-full border-2 opacity-0 shadow-[0_0_0_1px_rgba(15,23,42,0.35)] will-change-transform"
        aria-hidden="true"
      />
      <div
        ref={secondaryRef}
        className="absolute top-0 left-0 h-4 w-4 rounded-full border-2 border-teal-300 bg-teal-300/25 opacity-0 will-change-transform"
        aria-hidden="true"
      />
      <span
        ref={labelRef}
        className="absolute bottom-3 left-3 rounded-full bg-slate-950/55 px-2.5 py-1 text-[10px] text-slate-200 backdrop-blur-sm"
      />
    </div>
  );
}

function cursorColor(feedback: StudioHandFeedback): {
  border: string;
  fill: string;
} {
  if (feedback.mode === "open_palm") {
    return { border: "#fb7185", fill: "rgba(251, 113, 133, 0.25)" };
  }
  if (feedback.scaling) {
    return { border: "#2dd4bf", fill: "rgba(45, 212, 191, 0.3)" };
  }
  if (feedback.pinch) {
    return { border: "#38bdf8", fill: "rgba(56, 189, 248, 0.35)" };
  }
  if (feedback.mode === "draw") {
    return { border: "#f8fafc", fill: "rgba(248, 250, 252, 0.2)" };
  }
  return { border: "#fbbf24", fill: "rgba(251, 191, 36, 0.25)" };
}

function labelFor(feedback: StudioHandFeedback): string {
  if (!feedback.tracking) {
    return "Waiting for hand";
  }
  switch (feedback.mode) {
    case "draw":
      return "Drawing";
    case "pinch_grab":
      return "Pinch grab";
    case "two_hand_scale":
      return "Two-hand scale";
    case "open_palm":
      return "Paused";
    case "lost":
      return "Hand lost…";
    case "hover":
      return "Ready";
    default:
      return "Tracking";
  }
}
