import { clonePoint, objectBounds } from "@/features/studio/lib/geometry";
import type {
  Bounds,
  BrushStyle,
  Point,
  ShapeKind,
  ShapeObject,
  StrokeObject,
  StudioObject,
} from "@/features/studio/lib/types";

let idCounter = 0;

export function createObjectId(prefix = "obj"): string {
  idCounter += 1;
  return `${prefix}_${idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

export type StudioDocument = {
  objects: StudioObject[];
  nextZ: number;
  selectedId: string | null;
};

export function createDocument(): StudioDocument {
  return {
    objects: [],
    nextZ: 1,
    selectedId: null,
  };
}

export function cloneDocument(doc: StudioDocument): StudioDocument {
  return {
    nextZ: doc.nextZ,
    selectedId: doc.selectedId,
    objects: doc.objects.map(cloneObject),
  };
}

export function cloneObject(object: StudioObject): StudioObject {
  if (object.kind === "stroke") {
    return {
      ...object,
      points: object.points.map(clonePoint),
    };
  }

  return { ...object };
}

export function sortedObjects(doc: StudioDocument): StudioObject[] {
  return [...doc.objects].sort((a, b) => a.z - b.z);
}

export function findObject(
  doc: StudioDocument,
  id: string | null,
): StudioObject | null {
  if (!id) {
    return null;
  }
  return doc.objects.find((object) => object.id === id) ?? null;
}

export function createStroke(options: {
  points: Point[];
  color: string;
  width: number;
  style: BrushStyle;
  z: number;
  id?: string;
}): StrokeObject {
  return {
    kind: "stroke",
    id: options.id ?? createObjectId("stroke"),
    points: options.points.map(clonePoint),
    color: options.color,
    width: options.width,
    style: options.style,
    z: options.z,
  };
}

export function createShape(options: {
  shape: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  strokeWidth: number;
  filled?: boolean;
  z: number;
  id?: string;
}): ShapeObject {
  return {
    kind: "shape",
    id: options.id ?? createObjectId("shape"),
    shape: options.shape,
    x: options.x,
    y: options.y,
    w: options.w,
    h: options.h,
    color: options.color,
    strokeWidth: options.strokeWidth,
    filled: options.filled ?? false,
    z: options.z,
  };
}

export function addObject(doc: StudioDocument, object: StudioObject): void {
  doc.objects.push(object);
  doc.nextZ = Math.max(doc.nextZ, object.z + 1);
}

export function removeObject(doc: StudioDocument, id: string): boolean {
  const index = doc.objects.findIndex((object) => object.id === id);
  if (index < 0) {
    return false;
  }
  doc.objects.splice(index, 1);
  if (doc.selectedId === id) {
    doc.selectedId = null;
  }
  return true;
}

export function clearDocument(doc: StudioDocument): void {
  doc.objects = [];
  doc.selectedId = null;
}

export function selectObject(doc: StudioDocument, id: string | null): void {
  doc.selectedId = id;
}

export function moveObject(
  doc: StudioDocument,
  id: string,
  dx: number,
  dy: number,
): boolean {
  const object = findObject(doc, id);
  if (!object) {
    return false;
  }

  if (object.kind === "stroke") {
    for (const point of object.points) {
      point.x += dx;
      point.y += dy;
    }
    return true;
  }

  object.x += dx;
  object.y += dy;
  return true;
}

export function setShapeBounds(
  doc: StudioDocument,
  id: string,
  bounds: Bounds,
): boolean {
  const object = findObject(doc, id);
  if (!object || object.kind !== "shape") {
    return false;
  }

  if (object.shape === "line") {
    // Preserve line endpoints relative to new AABB by mapping start/end.
    const start = { x: object.x, y: object.y };
    const end = { x: object.x + object.w, y: object.y + object.h };
    const old = objectBounds(object);
    if (old.w <= 0 || old.h <= 0) {
      object.x = bounds.x;
      object.y = bounds.y;
      object.w = bounds.w;
      object.h = bounds.h;
      return true;
    }

    const map = (point: Point): Point => ({
      x: bounds.x + ((point.x - old.x) / old.w) * bounds.w,
      y: bounds.y + ((point.y - old.y) / old.h) * bounds.h,
    });
    const nextStart = map(start);
    const nextEnd = map(end);
    object.x = nextStart.x;
    object.y = nextStart.y;
    object.w = nextEnd.x - nextStart.x;
    object.h = nextEnd.y - nextStart.y;
    return true;
  }

  object.x = bounds.x;
  object.y = bounds.y;
  object.w = Math.max(4, bounds.w);
  object.h = Math.max(4, bounds.h);
  return true;
}

/**
 * Replace a live object with a scaled copy of `source`, about the center of
 * `startBounds`. Used by two-hand camera scaling so each frame can re-apply
 * from the gesture baseline without compounding. Caller owns history.
 */
export function scaleObjectAboutCenter(
  doc: StudioDocument,
  id: string,
  source: StudioObject,
  startBounds: Bounds,
  factor: number,
): boolean {
  const index = doc.objects.findIndex((object) => object.id === id);
  if (index < 0 || !Number.isFinite(factor) || factor <= 0) {
    return false;
  }

  const cx = startBounds.x + startBounds.w / 2;
  const cy = startBounds.y + startBounds.h / 2;
  const next = cloneObject(source);

  if (next.kind === "stroke") {
    for (const point of next.points) {
      point.x = cx + (point.x - cx) * factor;
      point.y = cy + (point.y - cy) * factor;
    }
    next.width = Math.max(1, source.kind === "stroke" ? source.width * factor : next.width);
    doc.objects[index] = next;
    return true;
  }

  if (next.shape === "line") {
    const start = { x: source.kind === "shape" ? source.x : 0, y: source.kind === "shape" ? source.y : 0 };
    const end = {
      x: source.kind === "shape" ? source.x + source.w : 0,
      y: source.kind === "shape" ? source.y + source.h : 0,
    };
    const nextStart = {
      x: cx + (start.x - cx) * factor,
      y: cy + (start.y - cy) * factor,
    };
    const nextEnd = {
      x: cx + (end.x - cx) * factor,
      y: cy + (end.y - cy) * factor,
    };
    next.x = nextStart.x;
    next.y = nextStart.y;
    next.w = nextEnd.x - nextStart.x;
    next.h = nextEnd.y - nextStart.y;
    next.strokeWidth = Math.max(
      1,
      (source.kind === "shape" ? source.strokeWidth : 2) * Math.min(factor, 2),
    );
    doc.objects[index] = next;
    return true;
  }

  const nextW = Math.max(4, startBounds.w * factor);
  const nextH = Math.max(4, startBounds.h * factor);
  next.x = cx - nextW / 2;
  next.y = cy - nextH / 2;
  next.w = nextW;
  next.h = nextH;
  doc.objects[index] = next;
  return true;
}

export function eraseAtPoint(
  doc: StudioDocument,
  point: Point,
  hits: (object: StudioObject, point: Point) => boolean,
): string[] {
  const removed: string[] = [];
  // Top-most first.
  const ordered = sortedObjects(doc).reverse();
  for (const object of ordered) {
    if (hits(object, point)) {
      removeObject(doc, object.id);
      removed.push(object.id);
      break;
    }
  }
  return removed;
}

export function eraseObjectsTouching(
  doc: StudioDocument,
  point: Point,
  hits: (object: StudioObject, point: Point) => boolean,
): string[] {
  const removed: string[] = [];
  for (const object of [...doc.objects]) {
    if (hits(object, point)) {
      removeObject(doc, object.id);
      removed.push(object.id);
    }
  }
  return removed;
}
