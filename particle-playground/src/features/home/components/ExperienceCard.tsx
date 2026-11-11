import Link from "next/link";

type ExperienceCardProps = {
  href: string;
  title: string;
  description: string;
  action: string;
  accent: "cyan" | "amber";
  delayClass?: string;
};

/**
 * Entry action for one Cosmic Canvas experience. Styled as an interactive
 * panel (not decorative chrome).
 */
export function ExperienceCard({
  href,
  title,
  description,
  action,
  accent,
  delayClass = "",
}: ExperienceCardProps) {
  const ring =
    accent === "cyan"
      ? "hover:ring-cyan-300/40 focus-visible:outline-cyan-200"
      : "hover:ring-amber-300/40 focus-visible:outline-amber-200";
  const label =
    accent === "cyan" ? "text-cyan-200/90" : "text-amber-200/90";

  return (
    <Link
      href={href}
      className={`home-rise group relative block rounded-3xl bg-slate-950/55 px-5 py-6 ring-1 ring-white/10 backdrop-blur-md transition duration-300 hover:-translate-y-0.5 hover:bg-slate-950/70 ${ring} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${delayClass}`}
    >
      <p className={`text-[11px] tracking-[0.28em] uppercase ${label}`}>
        Enter
      </p>
      <h2 className="mt-2 font-display text-2xl tracking-tight text-slate-50 sm:text-3xl">
        {title}
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-400">
        {description}
      </p>
      <span className="mt-5 inline-flex items-center gap-2 text-sm text-slate-100 transition group-hover:gap-3">
        {action}
        <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}
