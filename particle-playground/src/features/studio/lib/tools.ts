import type { StudioSettings, StudioTool } from "@/features/studio/lib/types";
import { DEFAULT_STUDIO_SETTINGS } from "@/features/studio/lib/types";

export type ToolDescriptor = {
  id: StudioTool;
  label: string;
  hint: string;
};

export const STUDIO_TOOLS: readonly ToolDescriptor[] = [
  { id: "draw", label: "Draw", hint: "Freehand brush" },
  { id: "shape", label: "Shapes", hint: "Drag to make a shape" },
  { id: "select", label: "Select", hint: "Move and resize" },
  { id: "eraser", label: "Eraser", hint: "Tap art to erase" },
];

export function createStudioSettings(
  overrides: Partial<StudioSettings> = {},
): StudioSettings {
  return { ...DEFAULT_STUDIO_SETTINGS, ...overrides };
}

export function isDrawingTool(tool: StudioTool): boolean {
  return tool === "draw" || tool === "shape" || tool === "eraser";
}
