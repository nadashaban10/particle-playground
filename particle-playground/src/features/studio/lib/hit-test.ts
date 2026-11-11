import {
  inflate,
  objectBounds,
  pointInBounds,
  pointInShape,
  pointNearStroke,
} from "@/features/studio/lib/geometry";
import { sortedObjects, type StudioDocument } from "@/features/studio/lib/document";
import type {
  Bounds,
  Point,
  ResizeHandle,
  StudioObject,
} from "@/features/studio/lib/types";

const HANDLE_SIZE = 10;

export function hitsObject(object: StudioObject, point: Point): boolean {
  if (object.kind === "stroke") {
    return pointNearStroke(point, object);
  }
  // Treat shape interiors as hittable even when drawn as outlines so select
  // and eraser feel natural for kids tapping "on" a shape.
  return pointInShape(point, { ...object, filled: true });
}

/** Top-most object under the pointer, or null. */
export function hitTestDocument(
  doc: StudioDocument,
  point: Point,
): StudioObject | null {
  const ordered = sortedObjects(doc).reverse();
  for (const object of ordered) {
    if (hitsObject(object, point)) {
      return object;
    }
  }
  return null;
}

export type HandleHit = {
  handle: ResizeHandle;
  bounds: Bounds;
};

export function selectionBoundsFor(
  object: StudioObject,
): Bounds {
  return inflate(objectBounds(object), 4);
}

export function handlePositions(bounds: Bounds): Record<ResizeHandle, Point> {
  const midX = bounds.x + bounds.w / 2;
  const midY = bounds.y + bounds.h / 2;
  const right = bounds.x + bounds.w;
  const bottom = bounds.y + bounds.h;

  return {
    nw: { x: bounds.x, y: bounds.y },
    n: { x: midX, y: bounds.y },
    ne: { x: right, y: bounds.y },
    e: { x: right, y: midY },
    se: { x: right, y: bottom },
    s: { x: midX, y: bottom },
    sw: { x: bounds.x, y: bottom },
    w: { x: bounds.x, y: midY },
  };
}

export function hitTestHandle(
  bounds: Bounds,
  point: Point,
  handleSize = HANDLE_SIZE,
): ResizeHandle | null {
  const positions = handlePositions(bounds);
  const half = handleSize / 2;

  const order: ResizeHandle[] = [
    "nw",
    "ne",
    "sw",
    "se",
    "n",
    "s",
    "e",
    "w",
  ];

  for (const handle of order) {
    const pos = positions[handle];
    if (
      pointInBounds(point, {
        x: pos.x - half,
        y: pos.y - half,
        w: handleSize,
        h: handleSize,
      })
    ) {
      return handle;
    }
  }

  return null;
}

export function hitTestSelection(
  object: StudioObject,
  point: Point,
): { kind: "handle"; handle: ResizeHandle } | { kind: "body" } | null {
  const bounds = selectionBoundsFor(object);
  const handle = hitTestHandle(bounds, point);
  if (handle) {
    return { kind: "handle", handle };
  }
  if (hitsObject(object, point) || pointInBounds(point, bounds)) {
    return { kind: "body" };
  }
  return null;
}

export { HANDLE_SIZE };
