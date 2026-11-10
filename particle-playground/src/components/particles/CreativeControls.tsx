"use client";

import { useSyncExternalStore } from "react";
import {
  CREATIVE_CONTROLS,
  getCreativeSettings,
  setCreativeSettings,
  subscribeCreativeSettings,
  type CreativeControlName,
} from "@/lib/creative-settings";

const ALL_CONTROLS: readonly CreativeControlName[] = [
  "brushSize",
  "trailIntensity",
  "ambientSpeed",
];

type CreativeControlsProps = {
  controls?: readonly CreativeControlName[];
};

export function CreativeControls({
  controls = ALL_CONTROLS,
}: CreativeControlsProps) {
  const settings = useSyncExternalStore(
    subscribeCreativeSettings,
    getCreativeSettings,
    getCreativeSettings,
  );
  const visible = CREATIVE_CONTROLS.filter((control) =>
    controls.includes(control.name),
  );

  return (
    <div
      className={`grid w-full min-w-0 grid-cols-1 gap-4 ${
        visible.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2"
      }`}
      role="group"
      aria-label="Brush and motion"
    >
      {visible.map((control) => (
        <label
          key={control.name}
          className="flex min-w-0 flex-col gap-2 text-xs text-zinc-300"
        >
          <span>
            {control.label}
            <span className="ml-2 tabular-nums text-cyan-100/80">
              {settings[control.name].toFixed(2)}
            </span>
          </span>
          <input
            type="range"
            min={control.min}
            max={control.max}
            step={control.step}
            value={settings[control.name]}
            aria-label={control.label}
            onChange={(event) => {
              setCreativeSettings({
                [control.name]: Number(event.target.value),
              });
            }}
            className="h-8 w-full min-w-0 cursor-pointer accent-cyan-300"
          />
        </label>
      ))}
    </div>
  );
}
