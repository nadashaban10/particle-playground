import {
  gestureForceMagnitude,
  type LocalForce,
  type LocalForceField,
} from "@/lib/gesture-force-field";
import { writePaletteColors } from "@/lib/palettes";
import type {
  InteractionMode,
  ParticleBuffers,
  ParticleConfig,
  Vector3,
} from "@/types/particles";

const NO_GESTURE_FORCES: readonly LocalForce[] = [];

export function createParticleBuffers(config: ParticleConfig): ParticleBuffers {
  const positions = new Float32Array(config.count * 3);
  const velocities = new Float32Array(config.count * 3);
  const colors = new Float32Array(config.count * 3);
  const span = config.bounds.max - config.bounds.min;

  for (let index = 0; index < config.count; index += 1) {
    const offset = index * 3;

    positions[offset] = config.bounds.min + Math.random() * span;
    positions[offset + 1] = config.bounds.min + Math.random() * span;
    positions[offset + 2] = config.bounds.min + Math.random() * span;

    velocities[offset] = randomSignedSpeed();
    velocities[offset + 1] = randomSignedSpeed();
    velocities[offset + 2] = randomSignedSpeed();
  }

  writePaletteColors(colors, "cosmic");

  return { positions, velocities, colors };
}

export function stepParticles(
  positions: Float32Array,
  velocities: Float32Array,
  config: ParticleConfig,
  delta: number,
  interaction: InteractionMode = config.interaction,
  target: Vector3 = config.target,
  formationTargets?: Float32Array | null,
  formationStrength = 0,
  ambientSpeed = 1,
  gestureField: LocalForceField | null = null,
): void {
  const { min, max } = config.bounds;
  const frameDelta = Math.min(delta, 0.05);
  const speed = Number.isFinite(ambientSpeed) ? ambientSpeed : 1;
  // Speed scales travel only. Forces, drag, the speed limit, and walls stay on real time.
  const step = config.velocityMultiplier * frameDelta * speed;
  const { x: targetX, y: targetY, z: targetZ } = target;
  const radius = config.interactionRadius;
  const radiusSquared = radius * radius;
  const directionSign = interaction === "repulsion" ? -1 : 1;
  const drag = Math.exp(-config.damping * frameDelta);
  // Gesture forces (open palm / fist), already in this system's local space.
  const gestureForces = gestureField?.forces ?? NO_GESTURE_FORCES;
  const gestureCount = gestureField ? gestureField.count : 0;

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

    for (let fieldIndex = 0; fieldIndex < gestureCount; fieldIndex += 1) {
      const field = gestureForces[fieldIndex];
      const fx = field.x - positions[offset];
      const fy = field.y - positions[offset + 1];
      const fz = field.z - positions[offset + 2];
      const fieldDistanceSquared = fx * fx + fy * fy + fz * fz;

      if (
        fieldDistanceSquared > 1e-12 &&
        fieldDistanceSquared < field.radius * field.radius
      ) {
        const fieldDistance = Math.sqrt(fieldDistanceSquared);
        // Toward the centre for positive strength, away for negative.
        const push =
          gestureForceMagnitude(
            fieldDistance,
            field.radius,
            field.core,
            field.strength,
          ) * frameDelta;

        vx += (fx / fieldDistance) * push;
        vy += (fy / fieldDistance) * push;
        vz += (fz / fieldDistance) * push;
      }
    }

    if (formationTargets && formationStrength > 0) {
      const pull = formationStrength * frameDelta;
      vx += (formationTargets[offset] - positions[offset]) * pull;
      vy += (formationTargets[offset + 1] - positions[offset + 1]) * pull;
      vz += (formationTargets[offset + 2] - positions[offset + 2]) * pull;
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
