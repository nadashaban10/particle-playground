import type { ParticleBounds } from "@/types/particles";

export type FormationName = "galaxy" | "sphere" | "nebula" | "wave";

export const FORMATION_NAMES: readonly FormationName[] = [
  "galaxy",
  "sphere",
  "nebula",
  "wave",
];

/** Tune the ambient shapes. Targets stay inside the particle bounds. */
export const formationConfig = {
  galaxy: { radius: 3.2, turns: 2.6, arms: 3, thickness: 0.55 },
  sphere: { radius: 2.75 },
  nebula: { spread: 1.05 },
  wave: { width: 6.2, depth: 6.2, amplitude: 0.65, frequency: 1.35, speed: 1.25 },
  /** Spring toward each particle's target, applied with the existing forces. */
  formationStrength: 1.8,
};

export type FormationTargets = {
  galaxy: Float32Array;
  sphere: Float32Array;
  nebula: Float32Array;
  wave: Float32Array;
  wavePhase: Float32Array;
};

export function createFormationTargets(
  count: number,
  bounds: ParticleBounds,
): FormationTargets {
  const limit = Math.min(Math.abs(bounds.min), Math.abs(bounds.max)) * 0.9;
  const galaxy = new Float32Array(count * 3);
  const sphere = new Float32Array(count * 3);
  const nebula = new Float32Array(count * 3);
  const wave = new Float32Array(count * 3);
  const wavePhase = new Float32Array(count);

  writeGalaxy(galaxy, count, limit);
  writeSphere(sphere, count, limit);
  writeNebula(nebula, count, limit);
  writeWaveLayout(wave, wavePhase, count, limit);

  return { galaxy, sphere, nebula, wave, wavePhase };
}

export function writeWaveHeights(
  targets: FormationTargets,
  time: number,
): void {
  const { amplitude, speed } = formationConfig.wave;
  const wave = targets.wave;
  const phase = targets.wavePhase;

  for (let index = 0; index < phase.length; index += 1) {
    wave[index * 3 + 1] = Math.sin(time * speed + phase[index]) * amplitude;
  }
}

function writeGalaxy(out: Float32Array, count: number, limit: number): void {
  const { turns, arms, thickness } = formationConfig.galaxy;
  const radiusLimit = Math.min(formationConfig.galaxy.radius, limit);

  for (let index = 0; index < count; index += 1) {
    const along = (index + 0.5) / count;
    const radius = Math.sqrt(along) * radiusLimit;
    const arm = index % arms;
    const angle =
      (radius / radiusLimit) * turns * Math.PI * 2 +
      (arm * Math.PI * 2) / arms;
    const y = (hashUnit(index, 1) - 0.5) * thickness;

    writePoint(
      out,
      index,
      Math.cos(angle) * radius,
      clamp(y, -limit, limit),
      Math.sin(angle) * radius,
    );
  }
}

function writeSphere(out: Float32Array, count: number, limit: number): void {
  const radius = Math.min(formationConfig.sphere.radius, limit);
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let index = 0; index < count; index += 1) {
    const y =
      count === 1 ? 0 : 1 - (index / (count - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * index;

    writePoint(
      out,
      index,
      Math.cos(theta) * ring * radius,
      y * radius,
      Math.sin(theta) * ring * radius,
    );
  }
}

function writeNebula(out: Float32Array, count: number, limit: number): void {
  const spread = formationConfig.nebula.spread;

  for (let index = 0; index < count; index += 1) {
    writePoint(
      out,
      index,
      clamp(gaussian(index, 1, 2) * spread, -limit, limit),
      clamp(gaussian(index, 3, 4) * spread, -limit, limit),
      clamp(gaussian(index, 5, 6) * spread, -limit, limit),
    );
  }
}

function writeWaveLayout(
  out: Float32Array,
  phase: Float32Array,
  count: number,
  limit: number,
): void {
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const width = Math.min(formationConfig.wave.width, limit * 2);
  const depth = Math.min(formationConfig.wave.depth, limit * 2);

  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = columns === 1 ? 0 : (column / (columns - 1) - 0.5) * width;
    const z = rows === 1 ? 0 : (row / (rows - 1) - 0.5) * depth;

    writePoint(out, index, x, 0, z);
    phase[index] = x * formationConfig.wave.frequency;
  }
}

function writePoint(
  out: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
): void {
  const offset = index * 3;
  out[offset] = x;
  out[offset + 1] = y;
  out[offset + 2] = z;
}

function gaussian(index: number, saltA: number, saltB: number): number {
  const u1 = Math.max(1e-4, hashUnit(index, saltA));
  const u2 = hashUnit(index, saltB);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(Math.PI * 2 * u2);
}

function hashUnit(index: number, salt: number): number {
  let value = Math.imul(index + 1, 374761393) ^ Math.imul(salt + 1, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
