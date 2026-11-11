import { AmbientCosmos } from "@/features/home/components/AmbientCosmos";
import { ExperienceCard } from "@/features/home/components/ExperienceCard";

/**
 * Cosmic Canvas entry: brand-first hero and two experience paths.
 */
export function HomePage() {
  return (
    <main className="relative isolate min-h-dvh overflow-hidden bg-[#020617] text-slate-50">
      <AmbientCosmos />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(8,47,73,0.45),_transparent_55%)]"
      />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col justify-center px-5 py-16 sm:px-8">
        <header className="home-rise max-w-2xl">
          <p className="text-xs tracking-[0.35em] text-cyan-200/80 uppercase">
            Cosmic Canvas
          </p>
          <h1 className="mt-4 font-display text-5xl leading-[0.95] tracking-tight text-slate-50 sm:text-6xl md:text-7xl">
            Play in a living cosmos
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-slate-400 sm:text-lg">
            Sculpt galaxies with your hands, or draw on a shared creative board.
          </p>
        </header>

        <div className="mt-12 grid gap-4 sm:mt-14 sm:grid-cols-2 sm:gap-5">
          <ExperienceCard
            href="/explore"
            title="Explore Galaxies"
            description="Shape particle worlds with open palms, fists, pinches, and a V-sign."
            action="Start exploring"
            accent="cyan"
            delayClass="home-rise-delay-1"
          />
          <ExperienceCard
            href="/studio"
            title="Creative Studio"
            description="A playful drawing board for brushes, shapes, and hands-on making."
            action="Open studio"
            accent="amber"
            delayClass="home-rise-delay-2"
          />
        </div>
      </div>
    </main>
  );
}
