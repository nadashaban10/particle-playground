import { paintTrailConfig } from "@/shared/lib/paint-trail-config";

export type CreativeControlName = "brushSize" | "trailIntensity" | "ambientSpeed";

export type CreativeSettings = {
  brushSize: number;
  trailIntensity: number;
  ambientSpeed: number;
};

type CreativeControl = {
  name: CreativeControlName;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
};

/** Slider ranges. Defaults keep today's point size and the current ambient pace. */
export const CREATIVE_CONTROLS: readonly CreativeControl[] = [
  {
    name: "brushSize",
    label: "Brush Size",
    min: 0.03,
    max: 0.2,
    step: 0.01,
    defaultValue: paintTrailConfig.size,
  },
  {
    name: "trailIntensity",
    label: "Trail Intensity",
    min: 0.2,
    max: 1,
    step: 0.01,
    defaultValue: 0.8,
  },
  {
    name: "ambientSpeed",
    label: "Ambient Speed",
    min: 0.25,
    max: 2.5,
    step: 0.05,
    defaultValue: 1,
  },
];

const CONTROL_BY_NAME = new Map(
  CREATIVE_CONTROLS.map((control) => [control.name, control]),
);

function defaults(): CreativeSettings {
  return {
    brushSize: controlDefault("brushSize"),
    trailIntensity: controlDefault("trailIntensity"),
    ambientSpeed: controlDefault("ambientSpeed"),
  };
}

function controlDefault(name: CreativeControlName): number {
  return CONTROL_BY_NAME.get(name)?.defaultValue ?? 1;
}

let current = defaults();
const listeners = new Set<() => void>();

export function getCreativeSettings(): CreativeSettings {
  return current;
}

export function setCreativeSettings(patch: Partial<CreativeSettings>): void {
  const next: CreativeSettings = {
    brushSize: clampControl("brushSize", patch.brushSize ?? current.brushSize),
    trailIntensity: clampControl(
      "trailIntensity",
      patch.trailIntensity ?? current.trailIntensity,
    ),
    ambientSpeed: clampControl(
      "ambientSpeed",
      patch.ambientSpeed ?? current.ambientSpeed,
    ),
  };

  if (
    next.brushSize === current.brushSize &&
    next.trailIntensity === current.trailIntensity &&
    next.ambientSpeed === current.ambientSpeed
  ) {
    return;
  }

  current = next;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeCreativeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function clampControl(name: CreativeControlName, value: number): number {
  const control = CONTROL_BY_NAME.get(name);
  if (!control || !Number.isFinite(value)) {
    return controlDefault(name);
  }
  return Math.min(control.max, Math.max(control.min, value));
}
