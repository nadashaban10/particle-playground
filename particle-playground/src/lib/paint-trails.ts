import { Color, Vector3 } from "three";
import type { HandPositionSample } from "@/lib/hand-positions";
import { paintTrailConfig } from "@/lib/paint-trail-config";

type PaintTrailConfig = typeof paintTrailConfig;

type Brush = {
  key: string;
  seen: boolean;
  painting: boolean;
  armed: boolean;
  carry: number;
  previous: Vector3;
};

export type PaintTrailState = {
  capacity: number;
  positions: Float32Array;
  colors: Float32Array;
  baseColors: Float32Array;
  age: Float32Array;
  head: number;
  live: number;
  positionsDirty: boolean;
  colorsDirty: boolean;
  /** Multiplier applied when trail colors are written. Hand colors stay unscaled. */
  intensity: number;
  brushes: Brush[];
  scratch: Vector3;
  config: PaintTrailConfig;
  leftColor: readonly [number, number, number];
  rightColor: readonly [number, number, number];
};

export function createPaintTrailState(
  config: PaintTrailConfig = paintTrailConfig,
): PaintTrailState {
  const capacity = config.maxParticles;
  const left = new Color(config.leftColor);
  const right = new Color(config.rightColor);

  return {
    capacity,
    positions: new Float32Array(capacity * 3),
    colors: new Float32Array(capacity * 3),
    baseColors: new Float32Array(capacity * 3),
    age: new Float32Array(capacity).fill(-1),
    head: 0,
    live: 0,
    positionsDirty: false,
    colorsDirty: false,
    intensity: 1,
    brushes: [
      createBrush("Left"),
      createBrush("Right"),
      createBrush("hand-0"),
      createBrush("hand-1"),
    ],
    scratch: new Vector3(),
    config,
    leftColor: [left.r, left.g, left.b],
    rightColor: [right.r, right.g, right.b],
  };
}

/** Brightest channel written into a trail. Keeps maximum intensity from turning white. */
export const TRAIL_CHANNEL_CEILING = 0.92;

export function scaleTrailChannel(
  base: number,
  fade: number,
  intensity: number,
): number {
  const scaled = base * fade * intensity;
  return scaled > TRAIL_CHANNEL_CEILING ? TRAIL_CHANNEL_CEILING : scaled;
}

export function stepPaintTrails(
  state: PaintTrailState,
  samples: readonly HandPositionSample[],
  delta: number,
  intensity = 1,
): void {
  state.intensity = Number.isFinite(intensity) ? intensity : 1;
  state.positionsDirty = false;
  state.colorsDirty = false;
  ageParticles(state, delta);

  for (const brush of state.brushes) {
    brush.seen = false;
  }

  for (const sample of samples) {
    if (!sample.hasFingertip) {
      continue;
    }
    const brush = brushFor(state, sample.key);
    if (!brush) {
      continue;
    }
    brush.seen = true;
    followBrush(state, brush, sample);
  }

  for (const brush of state.brushes) {
    if (brush.seen) {
      continue;
    }
    disarm(brush);
  }
}

function followBrush(
  state: PaintTrailState,
  brush: Brush,
  sample: HandPositionSample,
): void {
  const tip = sample.fingertip;
  if (!sample.painting) {
    disarm(brush);
    return;
  }

  const color = colorFor(state, sample);
  if (!brush.painting || !brush.armed) {
    brush.painting = true;
    brush.armed = true;
    brush.carry = 0;
    brush.previous.copy(tip);
    spawn(state, tip.x, tip.y, tip.z, color);
    return;
  }

  const distance = brush.previous.distanceTo(tip);
  if (distance === 0) {
    return;
  }

  if (distance > state.config.maxSegment) {
    brush.previous.copy(tip);
    brush.carry = 0;
    spawn(state, tip.x, tip.y, tip.z, color);
    return;
  }

  emitAlong(state, brush, tip, distance, color);
}

function emitAlong(
  state: PaintTrailState,
  brush: Brush,
  tip: Vector3,
  distance: number,
  color: readonly [number, number, number],
): void {
  const spacing = state.config.spacing;
  const startCarry = brush.carry;
  brush.carry += distance;

  let index = 0;
  const limit = Math.ceil(state.config.maxSegment / spacing) + 1;
  while (brush.carry >= spacing - 1e-4 && index < limit) {
    const traveled = spacing - startCarry + index * spacing;
    const t = Math.min(1, Math.max(0, traveled / distance));
    state.scratch.lerpVectors(brush.previous, tip, t);
    spawn(state, state.scratch.x, state.scratch.y, state.scratch.z, color);
    brush.carry = Math.max(0, brush.carry - spacing);
    index += 1;
  }

  brush.previous.copy(tip);
}

function ageParticles(state: PaintTrailState, delta: number): void {
  if (state.live === 0) {
    return;
  }

  const lifetime = state.config.lifetime;
  for (let index = 0; index < state.capacity; index += 1) {
    if (state.age[index] < 0) {
      continue;
    }

    state.age[index] += delta;
    const offset = index * 3;
    if (state.age[index] >= lifetime) {
      state.age[index] = -1;
      state.live -= 1;
      state.colors[offset] = 0;
      state.colors[offset + 1] = 0;
      state.colors[offset + 2] = 0;
    } else {
      const fade = 1 - state.age[index] / lifetime;
      writeTrailColor(state, offset, fade);
    }
  }

  state.colorsDirty = true;
}

function spawn(
  state: PaintTrailState,
  x: number,
  y: number,
  z: number,
  color: readonly [number, number, number],
): void {
  const index = state.head;
  state.head = (state.head + 1) % state.capacity;
  const offset = index * 3;

  if (state.age[index] < 0) {
    state.live += 1;
  }

  state.age[index] = 0;
  state.positions[offset] = x;
  state.positions[offset + 1] = y;
  state.positions[offset + 2] = z;
  state.baseColors[offset] = color[0];
  state.baseColors[offset + 1] = color[1];
  state.baseColors[offset + 2] = color[2];
  writeTrailColor(state, offset, 1);
  state.positionsDirty = true;
  state.colorsDirty = true;
}

function writeTrailColor(state: PaintTrailState, offset: number, fade: number): void {
  const intensity = state.intensity;
  state.colors[offset] = scaleTrailChannel(state.baseColors[offset], fade, intensity);
  state.colors[offset + 1] = scaleTrailChannel(
    state.baseColors[offset + 1],
    fade,
    intensity,
  );
  state.colors[offset + 2] = scaleTrailChannel(
    state.baseColors[offset + 2],
    fade,
    intensity,
  );
}

function colorFor(
  state: PaintTrailState,
  sample: HandPositionSample,
): readonly [number, number, number] {
  if (
    sample.handedness === "Right" ||
    sample.key === "Right" ||
    sample.key === "hand-1"
  ) {
    return state.rightColor;
  }
  return state.leftColor;
}

function brushFor(state: PaintTrailState, key: string): Brush | null {
  for (const brush of state.brushes) {
    if (brush.key === key) {
      return brush;
    }
  }
  return null;
}

function disarm(brush: Brush): void {
  brush.painting = false;
  brush.armed = false;
  brush.carry = 0;
}

function createBrush(key: string): Brush {
  return {
    key,
    seen: false,
    painting: false,
    armed: false,
    carry: 0,
    previous: new Vector3(),
  };
}
