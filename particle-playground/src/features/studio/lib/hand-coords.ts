import type { Point } from "@/features/studio/lib/types";

export type BoardSize = { width: number; height: number };

/**
 * Map a MediaPipe landmark into a rectangular stage (CSS pixels relative to
 * the stage origin). Selfie preview is mirrored; we mirror X so motion matches
 * the user's left/right.
 */
export function landmarkToStagePoint(
  landmark: { x: number; y: number },
  stage: BoardSize,
  options: { mirrorX?: boolean } = {},
): Point {
  const mirrorX = options.mirrorX !== false;
  const nx = mirrorX ? 1 - landmark.x : landmark.x;
  return {
    x: nx * stage.width,
    y: landmark.y * stage.height,
  };
}

/** @deprecated Alias — board-sized stages use the same mapping. */
export function landmarkToBoardPoint(
  landmark: { x: number; y: number },
  board: BoardSize,
  options: { mirrorX?: boolean } = {},
): Point {
  return landmarkToStagePoint(landmark, board, options);
}

export function stagePointToClient(
  point: Point,
  stageRect: DOMRect,
): { clientX: number; clientY: number } {
  return {
    clientX: stageRect.left + point.x,
    clientY: stageRect.top + point.y,
  };
}

export function landmarkToClientPoint(
  landmark: { x: number; y: number },
  stageRect: DOMRect,
  options: { mirrorX?: boolean } = {},
): { clientX: number; clientY: number } {
  const local = landmarkToStagePoint(
    landmark,
    { width: stageRect.width, height: stageRect.height },
    options,
  );
  return stagePointToClient(local, stageRect);
}

/** Convert a viewport client point into board CSS pixels. */
export function clientToBoardPoint(
  clientX: number,
  clientY: number,
  boardRect: DOMRect,
): Point {
  return {
    x: clientX - boardRect.left,
    y: clientY - boardRect.top,
  };
}

export function pointInRect(
  point: Point,
  rect: { width: number; height: number },
): boolean {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= rect.width &&
    point.y <= rect.height
  );
}

export function distance2d(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
