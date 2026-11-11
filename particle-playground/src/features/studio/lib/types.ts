/** Shared geometry for the Creative Studio document. */

export type Point = { x: number; y: number };

export type BrushStyle = "pencil" | "marker";

export type ShapeKind =
  | "circle"
  | "square"
  | "rectangle"
  | "triangle"
  | "line";

export type StudioTool = "draw" | "shape" | "select" | "eraser";

export type StrokeObject = {
  kind: "stroke";
  id: string;
  points: Point[];
  color: string;
  width: number;
  style: BrushStyle;
  z: number;
};

/**
 * Axis-aligned bounds for most shapes. For `line`, (x, y) is the start and
 * (x + w, y + h) is the end (w/h may be negative).
 */
export type ShapeObject = {
  kind: "shape";
  id: string;
  shape: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  strokeWidth: number;
  filled: boolean;
  z: number;
};

export type StudioObject = StrokeObject | ShapeObject;

export type Bounds = { x: number; y: number; w: number; h: number };

export type ResizeHandle =
  | "nw"
  | "ne"
  | "sw"
  | "se"
  | "n"
  | "s"
  | "e"
  | "w";

export type StudioSettings = {
  tool: StudioTool;
  shape: ShapeKind;
  brushStyle: BrushStyle;
  color: string;
  brushWidth: number;
};

export const STUDIO_COLORS: readonly string[] = [
  "#f8fafc",
  "#38bdf8",
  "#2dd4bf",
  "#fbbf24",
  "#fb7185",
  "#c084fc",
  "#4ade80",
  "#0f172a",
];

export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  tool: "draw",
  shape: "circle",
  brushStyle: "pencil",
  color: "#38bdf8",
  brushWidth: 6,
};
