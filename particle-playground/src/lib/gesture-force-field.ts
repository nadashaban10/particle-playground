import type { Object3D, Vector3 } from "three";
import type { GestureForceState } from "@/lib/gesture-forces";
import { worldPointToLocal, type GroupSpace } from "@/lib/group-space";

/**
 * Gesture force fields in the particles' own (group-local) space, ready for
 * the physics step. Built from the world-space forces each frame; the arrays
 * are reused, so nothing allocates per frame.
 */

/** One spherical force field in local units. */
export type LocalForce = {
  x: number;
  y: number;
  z: number;
  /** Local radius. Beyond it the field does nothing. */
  radius: number;
  /** Local radius inside which the force fades toward zero at the centre. */
  core: number;
  /** Peak acceleration (local units / s^2). Positive attracts, negative repels. */
  strength: number;
};

export type LocalForceField = {
  /** The first `count` entries are live. */
  count: number;
  forces: LocalForce[];
};

const MAX_FIELDS = 4;
/** A group scaled below this is treated as degenerate: no field. */
const MIN_SCALE = 1e-6;

export function createLocalForceField(capacity: number = MAX_FIELDS): LocalForceField {
  const forces: LocalForce[] = [];

  for (let index = 0; index < capacity; index += 1) {
    forces.push({ x: 0, y: 0, z: 0, radius: 0, core: 0, strength: 0 });
  }

  return { count: 0, forces };
}

/**
 * Converts the world-space forces into `group`'s local space.
 *
 * - Position: the full inverse of the group's world matrix, so translation,
 *   rotation, and scale are all handled (`group.matrixWorld` must be current).
 * - Radius and strength: divided by the group's scale. A local unit is `scale`
 *   world units long, so this keeps the field the same size on screen, and
 *   the push the same speed on screen, whatever the formation's scale.
 * - Sign: repulsion is negative, attraction positive; the fade is applied to
 *   the configured peak.
 *
 * A degenerate scale produces no field instead of non-finite numbers.
 */
export function writeLocalForceField(
  state: GestureForceState,
  group: Object3D,
  space: GroupSpace,
  scratch: Vector3,
  out: LocalForceField,
): LocalForceField {
  const scale = group.matrixWorld.getMaxScaleOnAxis();

  out.count = 0;

  if (!Number.isFinite(scale) || scale < MIN_SCALE) {
    return out;
  }

  const { config } = state;
  const radius = config.radius / scale;

  for (let index = 0; index < state.count && out.count < out.forces.length; index += 1) {
    const world = state.forces[index];
    const peak =
      world.kind === "repel" ? -config.repulsionStrength : config.attractionStrength;
    const local = out.forces[out.count];

    worldPointToLocal(space, group, world, scratch);
    local.x = scratch.x;
    local.y = scratch.y;
    local.z = scratch.z;
    local.radius = radius;
    local.core = radius * config.coreFraction;
    local.strength = (peak * world.strength) / scale;
    out.count += 1;
  }

  return out;
}

/**
 * Acceleration toward a field's centre (positive) or away from it
 * (negative) for a particle `distance` from the centre.
 *
 *   t      = 1 - distance / radius                  (1 at the centre, 0 at the edge)
 *   result = strength * t^2 * shape(distance)
 *
 * `shape` is 1 outside the core, so beyond the core the force only falls with
 * distance, smoothly, reaching zero with zero slope at the radius. Inside the
 * core it is softened so nothing is flung through, or piles onto, the exact
 * centre:
 *
 *   repulsion  shape = distance / core                (0 at the centre: no singularity)
 *   attraction shape = 2 * distance / core - 1        (-1 at the centre, 0 at core / 2)
 *
 * The attraction reverses gently inside half the core, so a pulled cloud
 * settles on a small shell around the hand (radius about core / 2) instead of
 * collapsing onto one point, where additive blending would burn a hot spot.
 * Both shapes are continuous at the core.
 *
 * Bounded: |result| <= |strength|, and it is 0 at or beyond the radius.
 */
export function gestureForceMagnitude(
  distance: number,
  radius: number,
  core: number,
  strength: number,
): number {
  if (!(radius > 0) || !(distance >= 0) || !(distance < radius)) {
    return 0;
  }

  const t = 1 - distance / radius;
  let shape = 1;

  if (core > 0 && distance < core) {
    shape = strength < 0 ? distance / core : (2 * distance) / core - 1;
  }

  return strength * t * t * shape;
}
