import { Color } from "three";
import type {
  InteractionMode,
  ParticleBuffers,
  ParticleConfig,
  Vector3,
} from "@/types/particles";

export function createParticleBuffers(config: ParticleConfig): ParticleBuffers {
  const positions = new Float32Array(config.count * 3);
  const velocities = new Float32Array(config.count * 3);
  const colors = new Float32Array(config.count * 3);
  const span = config.bounds.max - config.bounds.min;
  const palette = config.colors.map((hex) => new Color(hex));

  for (let index = 0; index < config.count; index += 1) {
    const offset = index * 3;

    positions[offset] = config.bounds.min + Math.random() * span;
    positions[offset + 1] = config.bounds.min + Math.random() * span;
    positions[offset + 2] = config.bounds.min + Math.random() * span;

    velocities[offset] = randomSignedSpeed();
    velocities[offset + 1] = randomSignedSpeed();
    velocities[offset + 2] = randomSignedSpeed();

    const color = palette[index % palette.length];
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }

  return { positions, velocities, colors };
}

export function stepParticles(
  positions: Float32Array,
  velocities: Float32Array,
  config: ParticleConfig,
  delta: number,
  interaction: InteractionMode = config.interaction,
  target: Vector3 = config.target,
): void {
  const { min, max } = config.bounds;
  const frameDelta = Math.min(delta, 0.05);
  const step = config.velocityMultiplier * frameDelta;
  const { x: targetX, y: targetY, z: targetZ } = target;
  const radius = config.interactionRadius;
  const radiusSquared = radius * radius;
  const directionSign = interaction === "repulsion" ? -1 : 1;
  const drag = Math.exp(-config.damping * frameDelta);

  for (let index = 0; index < config.count; index += 1) {
    const offset = index * 3;
    let vx = velocities[offset];
    let vy = velocities[offset + 1];
    let vz = velocities[offset + 2];

    const dx = targetX - positions[offset];
    const dy = targetY - positions[offset + 1];
    const dz = targetZ - positions[offset + 2];
    const distanceSquared = dx * dx + dy * dy + dz * dz;

    if (distanceSquared > 1e-8 && distanceSquared <= radiusSquared) {
      const distance = Math.sqrt(distanceSquared);
      const falloff = 1 - distance / radius;
      const force = directionSign * config.forceStrength * falloff * frameDelta;
      vx += (dx / distance) * force;
      vy += (dy / distance) * force;
      vz += (dz / distance) * force;
    }

    vx *= drag;
    vy *= drag;
    vz *= drag;

    const speed = Math.hypot(vx, vy, vz);
    if (speed > config.maxSpeed) {
      const scale = config.maxSpeed / speed;
      vx *= scale;
      vy *= scale;
      vz *= scale;
    }

    const movedX = moveAxis(positions[offset], vx, min, max, step);
    const movedY = moveAxis(positions[offset + 1], vy, min, max, step);
    const movedZ = moveAxis(positions[offset + 2], vz, min, max, step);

    positions[offset] = movedX.position;
    positions[offset + 1] = movedY.position;
    positions[offset + 2] = movedZ.position;
    velocities[offset] = movedX.velocity;
    velocities[offset + 1] = movedY.velocity;
    velocities[offset + 2] = movedZ.velocity;
  }
}

function moveAxis(
  position: number,
  velocity: number,
  min: number,
  max: number,
  step: number,
): { position: number; velocity: number } {
  const next = position + velocity * step;

  if (next > max) {
    return { position: max, velocity: -Math.abs(velocity) };
  }

  if (next < min) {
    return { position: min, velocity: Math.abs(velocity) };
  }

  return { position: next, velocity };
}

function randomSignedSpeed(): number {
  const direction = Math.random() < 0.5 ? -1 : 1;
  return direction * (0.35 + Math.random() * 0.65);
}
