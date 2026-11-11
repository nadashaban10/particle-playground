"use client";

import Link from "next/link";
import { GestureIllustration } from "@/features/explore/components/GestureIllustration";
import { EXPLORE_GESTURE_GUIDE } from "@/shared/lib/explore-gestures";

type GestureGuideProps = {
  onContinue: () => void;
  onBackHref?: string;
};

/**
 * Pre-play guide for Explore Galaxies. Copy matches implemented Stage 17 behavior.
 */
export function GestureGuide({ onContinue, onBackHref = "/" }: GestureGuideProps) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#020617] text-slate-50">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(8,47,73,0.5),_transparent_55%),linear-gradient(180deg,#020617_0%,#0f172a_100%)]"
      />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 py-10 sm:px-8 sm:py-14">
        <Link
          href={onBackHref}
          className="w-fit text-sm text-slate-400 transition hover:text-slate-200"
        >
          ← Cosmic Canvas
        </Link>

        <header className="home-rise mt-8 max-w-xl">
          <p className="text-xs tracking-[0.3em] text-cyan-200/80 uppercase">
            Explore Galaxies
          </p>
          <h1 className="mt-3 font-display text-4xl tracking-tight sm:text-5xl">
            Learn the gestures
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400 sm:text-base">
            These are the hand actions that already work in the particle world.
            Enable the camera after you continue — or explore with touch when the
            camera is off.
          </p>
        </header>

        <ul className="mt-10 space-y-3 sm:mt-12">
          {EXPLORE_GESTURE_GUIDE.map((gesture, index) => (
            <li
              key={gesture.id}
              className={`home-rise flex gap-4 rounded-2xl bg-slate-950/50 px-4 py-4 ring-1 ring-white/10 backdrop-blur-sm sm:gap-5 sm:px-5 ${
                index === 0
                  ? ""
                  : index === 1
                    ? "home-rise-delay-1"
                    : "home-rise-delay-2"
              }`}
            >
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-cyan-400/5 ring-1 ring-cyan-200/15">
                <GestureIllustration id={gesture.id} />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-lg text-slate-50">
                  {gesture.name}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">{gesture.pose}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
                  {gesture.description}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <div className="home-rise home-rise-delay-2 mt-10 flex flex-col gap-3 sm:mt-12 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onContinue}
            className="rounded-full bg-cyan-200 px-6 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-100"
          >
            Start exploring
          </button>
          <p className="text-xs text-slate-500 sm:max-w-xs">
            Tip: hold a V-sign briefly to cycle Galaxy → Sphere → Nebula → Wave.
          </p>
        </div>
      </div>
    </main>
  );
}
