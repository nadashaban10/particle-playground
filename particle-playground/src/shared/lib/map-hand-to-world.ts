import { Plane, Raycaster, Vector2, Vector3, type Camera } from "three";
import { handWorldConfig, type ActiveRegion } from "@/shared/lib/hand-world-config";

const MIN_SPAN = 1e-6;

export type HandWorldMapper = {
  raycaster: Raycaster;
  ndc: Vector2;
  /** The plane the particle pointer uses (see `useMouseTarget`): z = 0, facing +z. */
  plane: Plane;
};

export function createHandWorldMapper(): HandWorldMapper {
  return {
    raycaster: new Raycaster(),
    ndc: new Vector2(),
    plane: new Plane(new Vector3(0, 0, 1), 0),
  };
}

/**
 * Maps a normalized camera-frame point into the world, for the Canvas camera.
 *
 *   u  = mirrored ? 1 - x : x          // the orientation the user sees
 *   nx = clamp((u - minX) / (maxX - minX), 0, 1)
 *   ny = clamp((y - minY) / (maxY - minY), 0, 1)
 *   ndc = (nx * 2 - 1, 1 - ny * 2)
 *   world = ray(camera, ndc) intersect plane z = 0
 *
 * x and y come from the ray-plane intersection, so they follow the Canvas
 * camera and aspect ratio. z is the plane's z; MediaPipe depth plays no part.
 * Returns false when the ray misses the plane.
 */
export function mapFrameToWorld(
  mapper: HandWorldMapper,
  camera: Camera,
  frameX: number,
  frameY: number,
  mirrored: boolean,
  out: Vector3,
  region: ActiveRegion = handWorldConfig.region,
): boolean {
  const u = mirrored ? 1 - frameX : frameX;

  mapper.ndc.set(
    normalize(u, region.minX, region.maxX) * 2 - 1,
    1 - normalize(frameY, region.minY, region.maxY) * 2,
  );
  mapper.raycaster.setFromCamera(mapper.ndc, camera);

  return mapper.raycaster.ray.intersectPlane(mapper.plane, out) !== null;
}

/** Position within [min, max], clamped to 0..1. A degenerate range uses the whole frame. */
function normalize(value: number, min: number, max: number): number {
  const span = max - min;
  const fraction =
    span > MIN_SPAN && Number.isFinite(span) ? (value - min) / span : value;

  return Math.min(Math.max(fraction, 0), 1);
}
