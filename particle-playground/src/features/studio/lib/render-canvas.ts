import { shapeBounds } from "@/features/studio/lib/geometry";
import { sortedObjects, type StudioDocument } from "@/features/studio/lib/document";
import {
  HANDLE_SIZE,
  handlePositions,
  selectionBoundsFor,
} from "@/features/studio/lib/hit-test";
import type {
  Point,
  ShapeObject,
  StrokeObject,
  StudioObject,
} from "@/features/studio/lib/types";

export type DraftStroke = {
  kind: "stroke";
  points: Point[];
  color: string;
  width: number;
  style: "pencil" | "marker";
};

export type DraftShape = {
  kind: "shape";
  shape: ShapeObject["shape"];
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  strokeWidth: number;
  filled: boolean;
};

export type StudioDraft = DraftStroke | DraftShape | null;

export function clearCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);

  // Soft board wash so strokes read against cosmic UI chrome.
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#0b1224");
  gradient.addColorStop(1, "#111827");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Subtle grid for playful guidance.
  ctx.save();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
  ctx.lineWidth = 1;
  const step = 32;
  for (let x = step; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = step; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

export function renderStudioDocument(
  ctx: CanvasRenderingContext2D,
  doc: StudioDocument,
  draft: StudioDraft = null,
): void {
  for (const object of sortedObjects(doc)) {
    drawObject(ctx, object);
  }

  if (draft) {
    if (draft.kind === "stroke") {
      drawStroke(ctx, draft);
    } else {
      drawShape(ctx, draft);
    }
  }

  const selected = doc.selectedId
    ? doc.objects.find((object) => object.id === doc.selectedId) ?? null
    : null;

  if (selected) {
    drawSelection(ctx, selected);
  }
}

function drawObject(ctx: CanvasRenderingContext2D, object: StudioObject): void {
  if (object.kind === "stroke") {
    drawStroke(ctx, object);
  } else {
    drawShape(ctx, object);
  }
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Pick<StrokeObject, "points" | "color" | "width" | "style">,
): void {
  const points = stroke.points;
  if (points.length === 0) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (stroke.style === "marker") {
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = stroke.width * 1.6;
  }

  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const curr = points[index];
    const midX = (prev.x + curr.x) / 2;
    const midY = (prev.y + curr.y) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: Pick<
    ShapeObject,
    "shape" | "x" | "y" | "w" | "h" | "color" | "strokeWidth" | "filled"
  >,
): void {
  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = shape.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (shape.shape === "line") {
    ctx.beginPath();
    ctx.moveTo(shape.x, shape.y);
    ctx.lineTo(shape.x + shape.w, shape.y + shape.h);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const bounds = shapeBounds(shape as ShapeObject);

  ctx.beginPath();
  if (shape.shape === "circle") {
    ctx.ellipse(
      bounds.x + bounds.w / 2,
      bounds.y + bounds.h / 2,
      Math.max(0.5, bounds.w / 2),
      Math.max(0.5, bounds.h / 2),
      0,
      0,
      Math.PI * 2,
    );
  } else if (shape.shape === "triangle") {
    ctx.moveTo(bounds.x + bounds.w / 2, bounds.y);
    ctx.lineTo(bounds.x + bounds.w, bounds.y + bounds.h);
    ctx.lineTo(bounds.x, bounds.y + bounds.h);
    ctx.closePath();
  } else {
    // square / rectangle
    ctx.rect(bounds.x, bounds.y, bounds.w, bounds.h);
  }

  if (shape.filled) {
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.stroke();
  ctx.restore();
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  object: StudioObject,
): void {
  const bounds = selectionBoundsFor(object);
  ctx.save();
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
  ctx.setLineDash([]);

  if (object.kind === "shape") {
    const positions = handlePositions(bounds);
    const half = HANDLE_SIZE / 2;
    ctx.fillStyle = "#fbbf24";
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 1;
    for (const point of Object.values(positions)) {
      ctx.beginPath();
      ctx.rect(point.x - half, point.y - half, HANDLE_SIZE, HANDLE_SIZE);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.restore();
}

export function setupHiDpiCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
  canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Map a pointer event into canvas CSS-pixel coordinates. */
/**
 * Map client coordinates into board space (CSS pixels). Matches the document
 * model when the canvas was configured with setTransform(dpr…).
 */
export function clientToBoard(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

/** @deprecated Prefer clientToBoard — same CSS-pixel mapping. */
export function pointerToCanvasPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): Point {
  return clientToBoard(canvas, clientX, clientY);
}
