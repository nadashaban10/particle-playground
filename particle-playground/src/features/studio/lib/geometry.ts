import type { Bounds, Point, ShapeKind, ShapeObject, StrokeObject } from "@/features/studio/lib/types";

export function clonePoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

export function normalizeRect(x: number, y: number, w: number, h: number): Bounds {
  const x2 = x + w;
  const y2 = y + h;
  const left = Math.min(x, x2);
  const top = Math.min(y, y2);
  return { x: left, y: top, w: Math.abs(w), h: Math.abs(h) };
}

/** Square from drag origin toward pointer (equal sides, signed by drag). */
export function squareFromDrag(origin: Point, pointer: Point): Bounds {
  const dx = pointer.x - origin.x;
  const dy = pointer.y - origin.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  const w = dx < 0 ? -side : side;
  const h = dy < 0 ? -side : side;
  return normalizeRect(origin.x, origin.y, w, h);
}

export function shapeBounds(object: ShapeObject): Bounds {
  if (object.shape === "line") {
    return normalizeRect(object.x, object.y, object.w, object.h);
  }

  return normalizeRect(object.x, object.y, object.w, object.h);
}

export function strokeBounds(object: StrokeObject): Bounds {
  if (object.points.length === 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  let minX = object.points[0].x;
  let minY = object.points[0].y;
  let maxX = minX;
  let maxY = minY;

  for (const point of object.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const pad = object.width / 2;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + object.width,
    h: maxY - minY + object.width,
  };
}

export function objectBounds(
  object: StrokeObject | ShapeObject,
): Bounds {
  return object.kind === "stroke" ? strokeBounds(object) : shapeBounds(object);
}

export function inflate(bounds: Bounds, amount: number): Bounds {
  return {
    x: bounds.x - amount,
    y: bounds.y - amount,
    w: bounds.w + amount * 2,
    h: bounds.h + amount * 2,
  };
}

export function pointInBounds(point: Point, bounds: Bounds): boolean {
  return (
    point.x >= bounds.x &&
    point.y >= bounds.y &&
    point.x <= bounds.x + bounds.w &&
    point.y <= bounds.y + bounds.h
  );
}

export function distancePointToSegment(
  point: Point,
  a: Point,
  b: Point,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq <= 1e-9) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }

  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(point.x - px, point.y - py);
}

export function pointNearStroke(
  point: Point,
  object: StrokeObject,
  extra = 4,
): boolean {
  const threshold = object.width / 2 + extra;
  const points = object.points;

  if (points.length === 0) {
    return false;
  }

  if (points.length === 1) {
    return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= threshold;
  }

  for (let index = 1; index < points.length; index += 1) {
    if (distancePointToSegment(point, points[index - 1], points[index]) <= threshold) {
      return true;
    }
  }

  return false;
}

export function pointInShape(point: Point, object: ShapeObject, extra = 4): boolean {
  const bounds = shapeBounds(object);

  if (object.shape === "line") {
    const start = { x: object.x, y: object.y };
    const end = { x: object.x + object.w, y: object.y + object.h };
    return distancePointToSegment(point, start, end) <= object.strokeWidth / 2 + extra;
  }

  if (object.shape === "circle") {
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    const rx = bounds.w / 2;
    const ry = bounds.h / 2;
    if (rx <= 0 || ry <= 0) {
      return false;
    }
    const nx = (point.x - cx) / (rx + extra);
    const ny = (point.y - cy) / (ry + extra);
    const inside = nx * nx + ny * ny <= 1;
    if (object.filled) {
      return inside;
    }
    const outer = nx * nx + ny * ny <= 1;
    const innerRx = Math.max(0, rx - object.strokeWidth - extra);
    const innerRy = Math.max(0, ry - object.strokeWidth - extra);
    const ix = innerRx > 0 ? (point.x - cx) / innerRx : 2;
    const iy = innerRy > 0 ? (point.y - cy) / innerRy : 2;
    const deepInside = ix * ix + iy * iy <= 1;
    return outer && !deepInside;
  }

  if (object.shape === "triangle") {
    const a = { x: bounds.x + bounds.w / 2, y: bounds.y };
    const b = { x: bounds.x + bounds.w, y: bounds.y + bounds.h };
    const c = { x: bounds.x, y: bounds.y + bounds.h };
    return pointInTriangle(point, a, b, c);
  }

  // square / rectangle
  if (object.filled) {
    return pointInBounds(point, inflate(bounds, extra));
  }

  const outer = inflate(bounds, extra);
  const inner = inflate(bounds, -(object.strokeWidth + extra));
  return pointInBounds(point, outer) && !pointInBounds(point, inner);
}

function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const area =
    Math.abs((a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)) / 2);
  const a1 =
    Math.abs((p.x * (b.y - c.y) + b.x * (c.y - p.y) + c.x * (p.y - b.y)) / 2);
  const a2 =
    Math.abs((a.x * (p.y - c.y) + p.x * (c.y - a.y) + c.x * (a.y - p.y)) / 2);
  const a3 =
    Math.abs((a.x * (b.y - p.y) + b.x * (p.y - a.y) + p.x * (a.y - b.y)) / 2);
  return Math.abs(area - (a1 + a2 + a3)) < 0.5;
}

export function applyResize(
  bounds: Bounds,
  handle: import("@/features/studio/lib/types").ResizeHandle,
  pointer: Point,
  keepSquare: boolean,
): Bounds {
  let { x, y, w, h } = bounds;
  const right = x + w;
  const bottom = y + h;

  switch (handle) {
    case "nw":
      x = pointer.x;
      y = pointer.y;
      w = right - x;
      h = bottom - y;
      break;
    case "ne":
      y = pointer.y;
      w = pointer.x - x;
      h = bottom - y;
      break;
    case "sw":
      x = pointer.x;
      w = right - x;
      h = pointer.y - y;
      break;
    case "se":
      w = pointer.x - x;
      h = pointer.y - y;
      break;
    case "n":
      y = pointer.y;
      h = bottom - y;
      break;
    case "s":
      h = pointer.y - y;
      break;
    case "w":
      x = pointer.x;
      w = right - x;
      break;
    case "e":
      w = pointer.x - x;
      break;
  }

  if (keepSquare) {
    const side = Math.max(Math.abs(w), Math.abs(h));
    w = w < 0 ? -side : side;
    h = h < 0 ? -side : side;
  }

  return normalizeRect(x, y, w, h);
}

export function shapeFromDrag(
  shape: ShapeKind,
  origin: Point,
  pointer: Point,
): Pick<ShapeObject, "x" | "y" | "w" | "h"> {
  if (shape === "line") {
    return {
      x: origin.x,
      y: origin.y,
      w: pointer.x - origin.x,
      h: pointer.y - origin.y,
    };
  }

  if (shape === "square" || shape === "circle") {
    const box = squareFromDrag(origin, pointer);
    return { x: box.x, y: box.y, w: box.w, h: box.h };
  }

  const box = normalizeRect(origin.x, origin.y, pointer.x - origin.x, pointer.y - origin.y);
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}
