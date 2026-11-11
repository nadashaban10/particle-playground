import type { StudioDocument } from "@/features/studio/lib/document";
import {
  clearCanvas,
  renderStudioDocument,
  setupHiDpiCanvas,
} from "@/features/studio/lib/render-canvas";

export type ExportPngOptions = {
  width: number;
  height: number;
  /** Device pixel ratio for the export bitmap. */
  dpr?: number;
  filename?: string;
};

export type ExportPngResult =
  | { ok: true; blob: Blob; filename: string }
  | { ok: false; message: string };

/**
 * Rasterize the Studio document to a PNG blob without selection handles,
 * drafts, or UI chrome. Uses the same board renderer as the live canvas.
 */
export function composeStudioPng(
  doc: StudioDocument,
  options: ExportPngOptions,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const dpr = options.dpr ?? 2;

  const canvas = document.createElement("canvas");
  const ctx = setupHiDpiCanvas(canvas, width, height, dpr);
  if (!ctx) {
    return null;
  }

  // Export without selection: clone selectedId away for render.
  const exportDoc: StudioDocument = {
    objects: doc.objects,
    nextZ: doc.nextZ,
    selectedId: null,
  };

  clearCanvas(ctx, width, height);
  renderStudioDocument(ctx, exportDoc, null);
  return canvas;
}

export async function exportStudioPng(
  doc: StudioDocument,
  options: ExportPngOptions,
): Promise<ExportPngResult> {
  const canvas = composeStudioPng(doc, options);
  if (!canvas) {
    return { ok: false, message: "Could not create an export canvas." };
  }

  const filename =
    options.filename ??
    `cosmic-canvas-${new Date().toISOString().slice(0, 10)}.png`;

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/png");
  });

  if (!blob) {
    return { ok: false, message: "PNG export failed in this browser." };
  }

  return { ok: true, blob, filename };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
