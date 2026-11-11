import {
  cloneDocument,
  createDocument,
  type StudioDocument,
} from "@/features/studio/lib/document";
import type {
  BrushStyle,
  ShapeKind,
  ShapeObject,
  StrokeObject,
  StudioObject,
} from "@/features/studio/lib/types";

export const STUDIO_PERSIST_VERSION = 1;
export const STUDIO_PERSIST_KEY = "cosmic-canvas.studio.draft.v1";

export type StudioPersistPayload = {
  version: number;
  savedAt: string;
  document: StudioDocument;
};

export type PersistResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "quota" | "error"; message: string };

export type RestoreResult =
  | { ok: true; document: StudioDocument; savedAt: string }
  | {
      ok: false;
      reason: "missing" | "invalid" | "unavailable" | "error";
      message: string;
    };

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

export function serializeStudioDocument(doc: StudioDocument): StudioPersistPayload {
  return {
    version: STUDIO_PERSIST_VERSION,
    savedAt: new Date().toISOString(),
    document: cloneDocument(doc),
  };
}

export function validateStudioPersistPayload(
  value: unknown,
): StudioPersistPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== STUDIO_PERSIST_VERSION) {
    return null;
  }
  if (typeof record.savedAt !== "string") {
    return null;
  }
  const document = validateDocument(record.document);
  if (!document) {
    return null;
  }
  return {
    version: STUDIO_PERSIST_VERSION,
    savedAt: record.savedAt,
    document,
  };
}

function validateDocument(value: unknown): StudioDocument | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.objects) || typeof record.nextZ !== "number") {
    return null;
  }
  if (
    record.selectedId !== null &&
    typeof record.selectedId !== "string"
  ) {
    return null;
  }

  const objects: StudioObject[] = [];
  for (const entry of record.objects) {
    const object = validateObject(entry);
    if (!object) {
      return null;
    }
    objects.push(object);
  }

  return {
    objects,
    nextZ: record.nextZ,
    selectedId: (record.selectedId as string | null) ?? null,
  };
}

function validateObject(value: unknown): StudioObject | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.z !== "number") {
    return null;
  }

  if (record.kind === "stroke") {
    if (
      !Array.isArray(record.points) ||
      typeof record.color !== "string" ||
      typeof record.width !== "number" ||
      (record.style !== "pencil" && record.style !== "marker")
    ) {
      return null;
    }
    const points = [];
    for (const point of record.points) {
      if (
        !point ||
        typeof point !== "object" ||
        typeof (point as { x: unknown }).x !== "number" ||
        typeof (point as { y: unknown }).y !== "number"
      ) {
        return null;
      }
      points.push({
        x: (point as { x: number }).x,
        y: (point as { y: number }).y,
      });
    }
    const stroke: StrokeObject = {
      kind: "stroke",
      id: record.id,
      points,
      color: record.color,
      width: record.width,
      style: record.style as BrushStyle,
      z: record.z,
    };
    return stroke;
  }

  if (record.kind === "shape") {
    const shape = record.shape as ShapeKind;
    const allowed: ShapeKind[] = [
      "circle",
      "square",
      "rectangle",
      "triangle",
      "line",
    ];
    if (!allowed.includes(shape)) {
      return null;
    }
    if (
      typeof record.x !== "number" ||
      typeof record.y !== "number" ||
      typeof record.w !== "number" ||
      typeof record.h !== "number" ||
      typeof record.color !== "string" ||
      typeof record.strokeWidth !== "number" ||
      typeof record.filled !== "boolean"
    ) {
      return null;
    }
    const shapeObject: ShapeObject = {
      kind: "shape",
      id: record.id,
      shape,
      x: record.x,
      y: record.y,
      w: record.w,
      h: record.h,
      color: record.color,
      strokeWidth: record.strokeWidth,
      filled: record.filled,
      z: record.z,
    };
    return shapeObject;
  }

  return null;
}

export function saveStudioDocument(doc: StudioDocument): PersistResult {
  const storage = getStorage();
  if (!storage) {
    return {
      ok: false,
      reason: "unavailable",
      message: "Local storage is not available.",
    };
  }

  try {
    const payload = serializeStudioDocument(doc);
    storage.setItem(STUDIO_PERSIST_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "Could not save the drawing.";
    if (
      caught instanceof DOMException &&
      (caught.name === "QuotaExceededError" ||
        caught.name === "NS_ERROR_DOM_QUOTA_REACHED")
    ) {
      return { ok: false, reason: "quota", message };
    }
    return { ok: false, reason: "error", message };
  }
}

export function loadStudioDocument(): RestoreResult {
  const storage = getStorage();
  if (!storage) {
    return {
      ok: false,
      reason: "unavailable",
      message: "Local storage is not available.",
    };
  }

  try {
    const raw = storage.getItem(STUDIO_PERSIST_KEY);
    if (!raw) {
      return {
        ok: false,
        reason: "missing",
        message: "No saved drawing.",
      };
    }
    const parsed: unknown = JSON.parse(raw);
    const payload = validateStudioPersistPayload(parsed);
    if (!payload) {
      return {
        ok: false,
        reason: "invalid",
        message: "Saved drawing could not be restored.",
      };
    }
    return {
      ok: true,
      document: cloneDocument(payload.document),
      savedAt: payload.savedAt,
    };
  } catch (caught) {
    return {
      ok: false,
      reason: "error",
      message:
        caught instanceof Error
          ? caught.message
          : "Could not read the saved drawing.",
    };
  }
}

export function clearStudioDocumentStorage(): PersistResult {
  const storage = getStorage();
  if (!storage) {
    return {
      ok: false,
      reason: "unavailable",
      message: "Local storage is not available.",
    };
  }
  try {
    storage.removeItem(STUDIO_PERSIST_KEY);
    return { ok: true };
  } catch (caught) {
    return {
      ok: false,
      reason: "error",
      message:
        caught instanceof Error
          ? caught.message
          : "Could not clear the saved drawing.",
    };
  }
}

/** Apply a restored document onto a live engine document object. */
export function applyRestoredDocument(
  target: StudioDocument,
  source: StudioDocument,
): void {
  const cloned = cloneDocument(source);
  target.objects = cloned.objects;
  target.nextZ = cloned.nextZ;
  target.selectedId = cloned.selectedId;
}

export function emptyStudioDocument(): StudioDocument {
  return createDocument();
}
