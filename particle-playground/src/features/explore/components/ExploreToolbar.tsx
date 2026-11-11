"use client";

import { useEffect, useId, useState } from "react";
import { CreativeControls } from "@/features/explore/components/particles/CreativeControls";
import type { CreativeControlName } from "@/shared/lib/creative-settings";
import { FORMATION_NAMES, type FormationName } from "@/shared/lib/formations";
import { PALETTE_NAMES, PALETTES, type PaletteName } from "@/shared/lib/palettes";
import type { InteractionMode } from "@/shared/types/particles";

const FORMATION_LABELS: Record<FormationName, string> = {
  galaxy: "Galaxy",
  sphere: "Sphere",
  nebula: "Nebula",
  wave: "Wave",
};

const chip =
  "min-h-10 rounded-full px-3 text-xs ring-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 sm:text-sm";
const chipActive =
  "bg-violet-400/20 text-white ring-cyan-200/50 shadow-[0_0_16px_rgba(34,211,238,0.16)]";
const chipIdle = "bg-white/5 text-zinc-300 ring-white/10 hover:bg-white/10 hover:text-white";

type ExploreToolbarProps = {
  formation?: FormationName;
  onFormationChange?: (formation: FormationName) => void;
  palette?: PaletteName;
  onPaletteChange?: (palette: PaletteName) => void;
  interaction?: InteractionMode;
  onToggleInteraction?: () => void;
  /** When both are set, the toolbar shows a camera enable/disable control. */
  cameraEnabled?: boolean;
  onToggleCamera?: () => void;
  controls?: readonly CreativeControlName[];
};

export function ExploreToolbar({
  formation,
  onFormationChange,
  palette,
  onPaletteChange,
  interaction,
  onToggleInteraction,
  cameraEnabled,
  onToggleCamera,
  controls,
}: ExploreToolbarProps) {
  const [open, setOpen] = useState(false);
  const settingsId = useId();
  const showFormations = formation !== undefined && onFormationChange !== undefined;
  const showPalettes = palette !== undefined && onPaletteChange !== undefined;
  const showInteraction = interaction !== undefined && onToggleInteraction !== undefined;
  const showCamera = cameraEnabled !== undefined && onToggleCamera !== undefined;

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-5">
      <div className="pointer-events-auto flex w-full max-w-3xl min-w-0 flex-col items-center gap-2">
        <div
          id={settingsId}
          role="region"
          aria-label="Creative settings"
          className={`${open ? "block" : "hidden"} w-full max-h-[min(24rem,45dvh)] overflow-y-auto overscroll-contain rounded-2xl bg-zinc-950/75 px-3 py-3 ring-1 ring-cyan-200/15 backdrop-blur-md`}
        >
          <CreativeControls controls={controls} />
        </div>
        <div className="flex w-fit max-w-full flex-col gap-2 rounded-2xl bg-zinc-950/70 px-2 py-2 ring-1 ring-white/10 backdrop-blur-md sm:px-3">
          {showFormations ? (
            <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="Formation">
              {FORMATION_NAMES.map((name) => {
                const active = name === formation;
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onFormationChange(name)}
                    className={`${chip} ${active ? chipActive : chipIdle}`}
                  >
                    {FORMATION_LABELS[name]}
                  </button>
                );
              })}
            </div>
          ) : null}
          {showPalettes ? (
            <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="Color palette">
              {PALETTE_NAMES.map((name) => {
                const active = name === palette;
                const entry = PALETTES[name];
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={active}
                    aria-label={`${entry.label} palette`}
                    onClick={() => onPaletteChange(name)}
                    className={`${chip} inline-flex items-center gap-1.5 ${active ? chipActive : chipIdle}`}
                  >
                    <span className="flex gap-0.5" aria-hidden="true">
                      {entry.colors.map((hex) => (
                        <span
                          key={hex}
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </span>
                    <span className="sr-only sm:not-sr-only">{entry.label}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={settingsId}
              onClick={() => setOpen((current) => !current)}
              className={`${chip} ${open ? chipActive : chipIdle}`}
            >
              Settings
            </button>
            {showInteraction ? (
              <button
                type="button"
                aria-pressed={interaction === "attraction"}
                onClick={onToggleInteraction}
                className={`${chip} ${chipIdle}`}
              >
                {interaction === "attraction" ? "Attraction" : "Repulsion"}
              </button>
            ) : null}
            {showCamera ? (
              <button
                type="button"
                aria-pressed={cameraEnabled}
                aria-label={
                  cameraEnabled
                    ? "Disable camera hand tracking"
                    : "Enable camera hand tracking"
                }
                onClick={onToggleCamera}
                className={`${chip} ${cameraEnabled ? chipActive : chipIdle}`}
              >
                {cameraEnabled ? "Camera On" : "Camera Off"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
