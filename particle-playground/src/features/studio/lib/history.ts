import { cloneDocument, type StudioDocument } from "@/features/studio/lib/document";

/**
 * Snapshot-based undo/redo. Each completed user action pushes one snapshot of
 * the document *before* the mutation, so undo restores that prior state.
 */
export type StudioHistory = {
  undoStack: StudioDocument[];
  redoStack: StudioDocument[];
  limit: number;
};

export function createHistory(limit = 60): StudioHistory {
  return {
    undoStack: [],
    redoStack: [],
    limit,
  };
}

export function canUndo(history: StudioHistory): boolean {
  return history.undoStack.length > 0;
}

export function canRedo(history: StudioHistory): boolean {
  return history.redoStack.length > 0;
}

/** Call immediately before applying a coherent document mutation. */
export function pushHistory(
  history: StudioHistory,
  doc: StudioDocument,
): void {
  history.undoStack.push(cloneDocument(doc));
  if (history.undoStack.length > history.limit) {
    history.undoStack.shift();
  }
  history.redoStack = [];
}

export function undo(
  history: StudioHistory,
  doc: StudioDocument,
): StudioDocument | null {
  if (!canUndo(history)) {
    return null;
  }
  const previous = history.undoStack.pop()!;
  history.redoStack.push(cloneDocument(doc));
  return previous;
}

export function redo(
  history: StudioHistory,
  doc: StudioDocument,
): StudioDocument | null {
  if (!canRedo(history)) {
    return null;
  }
  const next = history.redoStack.pop()!;
  history.undoStack.push(cloneDocument(doc));
  return next;
}

export function clearHistory(history: StudioHistory): void {
  history.undoStack = [];
  history.redoStack = [];
}
