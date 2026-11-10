/** MediaPipe hand skeleton: palm chain plus each finger. */
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

const CONNECTION_COLOR: Record<number, string> = {
  0: "#67e8f9",
  1: "#67e8f9",
  2: "#67e8f9",
  3: "#67e8f9",
  5: "#38bdf8",
  6: "#38bdf8",
  7: "#38bdf8",
  9: "#22d3ee",
  10: "#22d3ee",
  11: "#22d3ee",
  13: "#a78bfa",
  14: "#a78bfa",
  15: "#a78bfa",
  17: "#818cf8",
  18: "#818cf8",
  19: "#818cf8",
};

export function connectionColor(start: number): string {
  return CONNECTION_COLOR[start] ?? "#38bdf8";
}

const LEFT_CONNECTION_COLOR: Record<number, string> = {
  0: "#e879f9",
  1: "#e879f9",
  2: "#e879f9",
  3: "#e879f9",
  5: "#c084fc",
  6: "#c084fc",
  7: "#c084fc",
  9: "#818cf8",
  10: "#818cf8",
  11: "#818cf8",
  13: "#67e8f9",
  14: "#67e8f9",
  15: "#67e8f9",
  17: "#38bdf8",
  18: "#38bdf8",
  19: "#38bdf8",
};

export type HandPalette = {
  bone: (start: number) => string;
  point: string;
  pointGlow: string;
  bright: string;
  brightGlow: string;
};

/** Original cyan / blue / violet skeleton. */
export const RIGHT_HAND_PALETTE: HandPalette = {
  bone: connectionColor,
  point: "#67e8f9",
  pointGlow: "#38bdf8",
  bright: "#f0f9ff",
  brightGlow: "#c4b5fd",
};

/** Same neon family, shifted toward violet so the other hand stays distinct. */
export const LEFT_HAND_PALETTE: HandPalette = {
  bone: (start) => LEFT_CONNECTION_COLOR[start] ?? "#a78bfa",
  point: "#e879f9",
  pointGlow: "#a78bfa",
  bright: "#fdf4ff",
  brightGlow: "#67e8f9",
};

export const BRIGHT_LANDMARKS = new Set([0, 4, 8, 12, 16, 20]);
