import { Matrix4, type Object3D, type Vector3 } from "three";
import type { Vector3 as Point } from "@/shared/types/particles";

/** Reusable scratch for world -> group conversions. */
export type GroupSpace = { inverse: Matrix4 };

export function createGroupSpace(): GroupSpace {
  return { inverse: new Matrix4() };
}

/**
 * Converts a world-space point into `group`'s local space with the full
 * inverse of its world matrix, so it stays correct for any translation,
 * rotation, or scale the group gains later. `group.matrixWorld` must be
 * current (call `group.updateMatrixWorld()` after moving it).
 */
export function worldPointToLocal(
  space: GroupSpace,
  group: Object3D,
  world: Point,
  out: Vector3,
): Vector3 {
  space.inverse.copy(group.matrixWorld).invert();
  return out.set(world.x, world.y, world.z).applyMatrix4(space.inverse);
}
