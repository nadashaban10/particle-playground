import type { PerspectiveCamera } from "three";
import type { Vector3 } from "@/shared/types/particles";

export const grabMotionConfig = {
  /**
   * How fast the group catches up with the hand (per second). Same
   * exponential smoothing used by the pointer and hand positions; larger is
   * snappier.
   */
  followSmoothing: 10,
  /** Frames longer than this (s) are treated as this long when smoothing. */
  maxSmoothingDelta: 0.05,
  /** Closer than this (world units) the group settles exactly on its target. */
  snapDistance: 1e-4,
  /**
   * Share of the formation's extent that must stay inside the view when the
   * group is pushed to a limit. 1 keeps it fully visible, 0 lets it slide out
   * until it only touches the edge. Between, the formation can be moved partly
   * off screen but never lost.
   */
  minVisibleFraction: 0.75,
  /**
   * Formation extent is measured with this percentile of each axis rather than
   * the single farthest particle, so a few sparse outliers (nebula tails) do
   * not shrink the usable area.
   */
  extentPercentile: 0.98,
};

/** Half-size of a formation along each axis, in its own local units. */
export type FormationExtent = { x: number; y: number; z: number };

/** Largest |position| the group centre may take on each axis (world units). */
export type GrabLimits = { x: number; y: number; z: number };

export function createGrabLimits(): GrabLimits {
  return { x: 0, y: 0, z: 0 };
}

/** `1 - exp(-rate * delta)`: the share of the remaining gap to close this frame. */
export function smoothingAlpha(rate: number, delta: number): number {
  if (!Number.isFinite(delta) || delta <= 0 || !Number.isFinite(rate) || rate <= 0) {
    return 0;
  }

  return 1 - Math.exp(-rate * delta);
}

/**
 * Per-axis extent of a packed xyz array: the `percentile` of |coordinate|
 * (1 means the farthest point). An empty array has no extent.
 */
export function measureFormationExtent(
  targets: Float32Array,
  percentile: number = grabMotionConfig.extentPercentile,
): FormationExtent {
  const count = Math.floor(targets.length / 3);
  const extent: FormationExtent = { x: 0, y: 0, z: 0 };

  if (count === 0) {
    return extent;
  }

  const values = new Float32Array(count);
  const rank = Math.min(
    count - 1,
    Math.max(0, Math.floor(Math.min(1, Math.max(0, percentile)) * (count - 1))),
  );

  extent.x = percentileOfAxis(targets, values, 0, rank);
  extent.y = percentileOfAxis(targets, values, 1, rank);
  extent.z = percentileOfAxis(targets, values, 2, rank);

  return extent;
}

function percentileOfAxis(
  targets: Float32Array,
  scratch: Float32Array,
  axis: number,
  rank: number,
): number {
  for (let index = 0; index < scratch.length; index += 1) {
    scratch[index] = Math.abs(targets[index * 3 + axis]);
  }

  scratch.sort();
  return scratch[rank];
}

/**
 * Translation limits for a formation seen by `camera`.
 *
 * The visible half-size is taken at the depth of the formation's nearest
 * point, where the view is narrowest, so the result is conservative for the
 * whole formation. The group centre may go until only `minVisibleFraction` of
 * the formation's extent remains inside:
 *
 *   limit = halfView + extent * (1 - 2 * fraction)      (never below 0)
 *
 * z is locked (limit 0): the group slides in the view plane only. Limits are
 * symmetric about the formation's home at the world origin.
 */
export function computeGrabLimits(
  camera: PerspectiveCamera,
  extent: FormationExtent,
  out: GrabLimits,
  fraction: number = grabMotionConfig.minVisibleFraction,
): GrabLimits {
  const share = Math.min(1, Math.max(0, fraction));
  const distance = Math.max(camera.position.z - extent.z, camera.near);
  const halfHeight = Math.tan((camera.fov * Math.PI) / 360) * distance;
  const halfWidth = halfHeight * camera.aspect;

  out.x = Math.max(0, halfWidth + extent.x * (1 - 2 * share));
  out.y = Math.max(0, halfHeight + extent.y * (1 - 2 * share));
  out.z = 0;

  return out;
}

/**
 * Half-size of the axis-aligned box around `extent` after the group is
 * rolled by `rotation` (radians, about Z) and scaled uniformly by `scale`:
 *
 *   x' = s (|cos| x + |sin| y)      y' = s (|sin| x + |cos| y)      z' = s z
 *
 * The extent is itself a per-axis box, so this is the box of a rotated box.
 * It is slightly larger than the true outline of a round formation at
 * in-between angles (up to about 41% at 45 degrees), which makes the limits
 * conservative: the formation is never allowed further out than it should be.
 */
export function transformedExtent(
  extent: FormationExtent,
  rotation: number,
  scale: number,
  out: FormationExtent,
): FormationExtent {
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  const size = Math.abs(scale);

  out.x = size * (cos * extent.x + sin * extent.y);
  out.y = size * (sin * extent.x + cos * extent.y);
  out.z = size * extent.z;

  return out;
}

/** Clamps `origin` into the limits in place. Returns true when it changed. */
export function clampOrigin(limits: GrabLimits, origin: Vector3): boolean {
  const x = Math.min(limits.x, Math.max(-limits.x, origin.x));
  const y = Math.min(limits.y, Math.max(-limits.y, origin.y));
  const z = Math.min(limits.z, Math.max(-limits.z, origin.z));
  const changed = x !== origin.x || y !== origin.y || z !== origin.z;

  origin.x = x;
  origin.y = y;
  origin.z = z;

  return changed;
}
