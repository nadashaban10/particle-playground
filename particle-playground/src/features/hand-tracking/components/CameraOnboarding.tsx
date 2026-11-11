"use client";

import { cameraExperienceCopy } from "@/shared/lib/camera-experience";

type CameraOnboardingProps = {
  visible: boolean;
  onEnableCamera: () => void;
  onDismiss: () => void;
};

/** First-run tip for Explore. Soft card over the full-bleed scene — not a modal wizard. */
export function CameraOnboarding({
  visible,
  onEnableCamera,
  onDismiss,
}: CameraOnboardingProps) {
  if (!visible) {
    return null;
  }

  const copy = cameraExperienceCopy("idle", {
    streamError: null,
    trackerError: null,
    handCount: 0,
  });

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[max(5.5rem,12dvh)] z-20 flex justify-center px-4 sm:top-[max(6rem,14dvh)]">
      <div
        role="dialog"
        aria-modal="false"
        aria-label="Enable camera for hand tracking"
        className="pointer-events-auto w-full max-w-sm rounded-2xl bg-zinc-950/75 px-4 py-3 text-center ring-1 ring-white/10 backdrop-blur-md"
      >
        <p className="text-[10px] tracking-[0.22em] text-zinc-500 uppercase">
          Cosmic Canvas
        </p>
        <p className="mt-1.5 text-sm text-zinc-100">{copy.status}</p>
        {copy.hint ? (
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">{copy.hint}</p>
        ) : null}
        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={onEnableCamera}
            className="rounded-full bg-zinc-100 px-3.5 py-1.5 text-xs font-medium text-zinc-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
          >
            Enable camera
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full px-3 py-1.5 text-xs text-zinc-400 ring-1 ring-white/10 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
