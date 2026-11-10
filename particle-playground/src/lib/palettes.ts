import { Color } from "three";

export type PaletteName = "cosmic" | "aurora" | "sunset" | "monochrome";

export type Palette = {
  label: string;
  colors: readonly [string, string, string];
};

export const PALETTE_NAMES: readonly PaletteName[] = [
  "cosmic",
  "aurora",
  "sunset",
  "monochrome",
];

export const PALETTES: Record<PaletteName, Palette> = {
  cosmic: {
    label: "Cosmic",
    colors: ["#7c3aed", "#3b82f6", "#22d3ee"],
  },
  aurora: {
    label: "Aurora",
    colors: ["#4ade80", "#2dd4bf", "#38bdf8"],
  },
  sunset: {
    label: "Sunset",
    colors: ["#fb923c", "#f472b6", "#a78bfa"],
  },
  monochrome: {
    label: "Monochrome",
    colors: ["#f8fafc", "#cbd5e1", "#94a3b8"],
  },
};

/** Defaults for the paint trails. They do not follow the ambient palette. */
export const trailHandColors = {
  left: "#c084fc",
  right: "#67e8f9",
} as const;

const STOP_CACHE = new Map<PaletteName, ReadonlyArray<readonly [number, number, number]>>();

export function writePaletteColors(
  colors: Float32Array,
  palette: PaletteName,
): void {
  const stops = paletteStops(palette);
  const span = stops.length - 1;
  const count = colors.length / 3;

  for (let index = 0; index < count; index += 1) {
    const scaled = hashUnit(index) * span;
    const stop = Math.min(span - 1, Math.floor(scaled));
    const mix = scaled - stop;
    const from = stops[stop];
    const to = stops[stop + 1];
    const offset = index * 3;

    colors[offset] = from[0] + (to[0] - from[0]) * mix;
    colors[offset + 1] = from[1] + (to[1] - from[1]) * mix;
    colors[offset + 2] = from[2] + (to[2] - from[2]) * mix;
  }
}

function paletteStops(
  palette: PaletteName,
): ReadonlyArray<readonly [number, number, number]> {
  const cached = STOP_CACHE.get(palette);
  if (cached) {
    return cached;
  }

  const stops = PALETTES[palette].colors.map((hex) => {
    const color = new Color(hex);
    return [color.r, color.g, color.b] as const;
  });
  STOP_CACHE.set(palette, stops);
  return stops;
}

function hashUnit(index: number): number {
  let value = Math.imul(index + 1, 374761393);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}
