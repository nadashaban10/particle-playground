type ExperienceIntroProps = {
  error: string | null;
  pending: boolean;
  onStart: () => void;
};

export function ExperienceIntro({
  error,
  pending,
  onStart,
}: ExperienceIntroProps) {
  return (
    <section className="flex h-dvh w-full flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-center text-zinc-50">
      <div className="max-w-md space-y-3">
        <p className="text-sm tracking-[0.2em] text-zinc-400 uppercase">
          Particle playground
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          Move particles with your hands
        </h1>
        <p className="text-zinc-400">
          Allow the camera, then try an open palm, a fist, a pinch, or a V-sign
          to change the formation.
        </p>
      </div>
      <button
        type="button"
        onClick={onStart}
        disabled={pending}
        className="rounded-full bg-zinc-50 px-6 py-3 text-sm font-medium text-zinc-950 transition-opacity disabled:opacity-60"
      >
        {pending ? "Starting camera…" : "Start"}
      </button>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
    </section>
  );
}
