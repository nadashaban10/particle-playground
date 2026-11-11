import {
  addObject,
  clearDocument,
  cloneDocument,
  createDocument,
  createShape,
  createStroke,
  eraseAtPoint,
  findObject,
  moveObject,
  removeObject,
  selectObject,
  setShapeBounds,
  type StudioDocument,
} from "@/features/studio/lib/document";
import { applyResize, objectBounds, shapeFromDrag } from "@/features/studio/lib/geometry";
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redo as historyRedo,
  undo as historyUndo,
  type StudioHistory,
} from "@/features/studio/lib/history";
import { hitsObject, hitTestDocument, hitTestSelection } from "@/features/studio/lib/hit-test";
import type { StudioDraft } from "@/features/studio/lib/render-canvas";
import type {
  Point,
  ResizeHandle,
  StudioObject,
  StudioSettings,
} from "@/features/studio/lib/types";
import { createStudioSettings } from "@/features/studio/lib/tools";

/**
 * Framework-free drawing engine. Pointer sources (mouse, touch, future hand
 * landmarks) should call the same down/move/up/tap APIs with board coordinates.
 */
export type StudioEngine = {
  document: StudioDocument;
  history: StudioHistory;
  settings: StudioSettings;
  draft: StudioDraft;
  /** True while a gesture is in progress (stroke, shape drag, move, resize). */
  isGesturing: boolean;
};

type Interaction =
  | { kind: "idle" }
  | {
      kind: "draw";
      points: Point[];
    }
  | {
      kind: "shape";
      origin: Point;
    }
  | {
      kind: "move";
      id: string;
      last: Point;
      moved: boolean;
    }
  | {
      kind: "resize";
      id: string;
      handle: ResizeHandle;
      startBounds: { x: number; y: number; w: number; h: number };
      keepSquare: boolean;
      changed: boolean;
    }
  | {
      kind: "erase";
      erased: boolean;
    };

export function createStudioEngine(
  settings: Partial<StudioSettings> = {},
): StudioEngine {
  return {
    document: createDocument(),
    history: createHistory(),
    settings: createStudioSettings(settings),
    draft: null,
    isGesturing: false,
  };
}

export type EngineSession = {
  engine: StudioEngine;
  interaction: Interaction;
  /** Optional UI hook so toolbar actions can request a canvas redraw. */
  paint?: () => void;
  /**
   * True while a mouse/touch pointer owns the board. Camera drawing must yield
   * to this to avoid conflicting input streams.
   */
  physicalPointerActive?: boolean;
  /** Live board size in CSS pixels (updated by StudioBoard). */
  boardSize?: { width: number; height: number };
  /** Board host element for hand→UI hit-testing. */
  boardHost?: HTMLElement | null;
};

export function createEngineSession(
  settings: Partial<StudioSettings> = {},
): EngineSession {
  return {
    engine: createStudioEngine(settings),
    interaction: { kind: "idle" },
  };
}

export function getEngineSnapshot(engine: StudioEngine): {
  canUndo: boolean;
  canRedo: boolean;
  selectedId: string | null;
  objectCount: number;
  tool: StudioSettings["tool"];
  isGesturing: boolean;
} {
  return {
    canUndo: canUndo(engine.history),
    canRedo: canRedo(engine.history),
    selectedId: engine.document.selectedId,
    objectCount: engine.document.objects.length,
    tool: engine.settings.tool,
    isGesturing: engine.isGesturing,
  };
}

export function setEngineSettings(
  engine: StudioEngine,
  patch: Partial<StudioSettings>,
): void {
  engine.settings = { ...engine.settings, ...patch };
}

export function pointerDown(session: EngineSession, point: Point): boolean {
  const { engine } = session;
  const { settings, document: doc } = engine;

  if (settings.tool === "draw") {
    session.interaction = { kind: "draw", points: [point] };
    engine.draft = {
      kind: "stroke",
      points: [{ ...point }],
      color: settings.color,
      width: settings.brushWidth,
      style: settings.brushStyle,
    };
    engine.isGesturing = true;
    selectObject(doc, null);
    return true;
  }

  if (settings.tool === "shape") {
    session.interaction = { kind: "shape", origin: point };
    const geom = shapeFromDrag(settings.shape, point, point);
    engine.draft = {
      kind: "shape",
      shape: settings.shape,
      ...geom,
      color: settings.color,
      strokeWidth: settings.brushWidth,
      filled: false,
    };
    engine.isGesturing = true;
    selectObject(doc, null);
    return true;
  }

  if (settings.tool === "eraser") {
    session.interaction = { kind: "erase", erased: false };
    engine.isGesturing = true;
    const removed = eraseAt(engine, point, true);
    session.interaction = { kind: "erase", erased: removed > 0 };
    return true;
  }

  // select tool
  const selected = findObject(doc, doc.selectedId);
  if (selected && selected.kind === "shape") {
    const hit = hitTestSelection(selected, point);
    if (hit?.kind === "handle") {
      pushHistory(engine.history, doc);
      session.interaction = {
        kind: "resize",
        id: selected.id,
        handle: hit.handle,
        startBounds: objectBounds(selected),
        keepSquare: selected.shape === "square" || selected.shape === "circle",
        changed: false,
      };
      engine.isGesturing = true;
      return true;
    }
    if (hit?.kind === "body") {
      pushHistory(engine.history, doc);
      session.interaction = {
        kind: "move",
        id: selected.id,
        last: point,
        moved: false,
      };
      engine.isGesturing = true;
      return true;
    }
  } else if (selected && selected.kind === "stroke") {
    const hit = hitTestSelection(selected, point);
    if (hit) {
      pushHistory(engine.history, doc);
      session.interaction = {
        kind: "move",
        id: selected.id,
        last: point,
        moved: false,
      };
      engine.isGesturing = true;
      return true;
    }
  }

  const hit = hitTestDocument(doc, point);
  selectObject(doc, hit?.id ?? null);
  if (hit) {
    pushHistory(engine.history, doc);
    session.interaction = {
      kind: "move",
      id: hit.id,
      last: point,
      moved: false,
    };
    engine.isGesturing = true;
  } else {
    session.interaction = { kind: "idle" };
  }
  return true;
}

export function pointerMove(session: EngineSession, point: Point): boolean {
  const { engine } = session;
  const interaction = session.interaction;

  if (interaction.kind === "draw") {
    const last = interaction.points[interaction.points.length - 1];
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 1.2) {
      return false;
    }
    interaction.points.push({ ...point });
    if (engine.draft?.kind === "stroke") {
      engine.draft.points = interaction.points.map((p) => ({ ...p }));
    }
    return true;
  }

  if (interaction.kind === "shape") {
    const geom = shapeFromDrag(
      engine.settings.shape,
      interaction.origin,
      point,
    );
    engine.draft = {
      kind: "shape",
      shape: engine.settings.shape,
      ...geom,
      color: engine.settings.color,
      strokeWidth: engine.settings.brushWidth,
      filled: false,
    };
    return true;
  }

  if (interaction.kind === "move") {
    const dx = point.x - interaction.last.x;
    const dy = point.y - interaction.last.y;
    if (dx === 0 && dy === 0) {
      return false;
    }
    moveObject(engine.document, interaction.id, dx, dy);
    interaction.last = point;
    interaction.moved = true;
    return true;
  }

  if (interaction.kind === "resize") {
    const object = findObject(engine.document, interaction.id);
    if (!object || object.kind !== "shape") {
      return false;
    }
    const next = applyResize(
      interaction.startBounds,
      interaction.handle,
      point,
      interaction.keepSquare,
    );
    setShapeBounds(engine.document, interaction.id, next);
    interaction.changed = true;
    return true;
  }

  if (interaction.kind === "erase") {
    const removed = eraseAt(engine, point, !interaction.erased);
    if (removed > 0) {
      interaction.erased = true;
      return true;
    }
    return false;
  }

  return false;
}

export function pointerUp(session: EngineSession, point?: Point): boolean {
  const { engine } = session;
  const interaction = session.interaction;
  let changed = false;

  if (interaction.kind === "draw") {
    const points = interaction.points;
    if (points.length > 0) {
      pushHistory(engine.history, engine.document);
      const stroke = createStroke({
        points,
        color: engine.settings.color,
        width: engine.settings.brushWidth,
        style: engine.settings.brushStyle,
        z: engine.document.nextZ,
      });
      addObject(engine.document, stroke);
      selectObject(engine.document, stroke.id);
      changed = true;
    }
  } else if (interaction.kind === "shape") {
    const end = point ?? interaction.origin;
    const geom = shapeFromDrag(engine.settings.shape, interaction.origin, end);
    const minSize =
      engine.settings.shape === "line"
        ? Math.hypot(geom.w, geom.h) >= 4
        : Math.abs(geom.w) >= 4 || Math.abs(geom.h) >= 4;
    if (minSize) {
      pushHistory(engine.history, engine.document);
      const shape = createShape({
        shape: engine.settings.shape,
        ...geom,
        color: engine.settings.color,
        strokeWidth: engine.settings.brushWidth,
        filled: false,
        z: engine.document.nextZ,
      });
      addObject(engine.document, shape);
      selectObject(engine.document, shape.id);
      changed = true;
    }
  } else if (interaction.kind === "move") {
    if (!interaction.moved) {
      // Selection-only click: drop the optimistic history push.
      engine.history.undoStack.pop();
    }
    changed = interaction.moved;
  } else if (interaction.kind === "resize") {
    if (!interaction.changed) {
      engine.history.undoStack.pop();
    }
    changed = interaction.changed;
  } else if (interaction.kind === "erase") {
    changed = interaction.erased;
  }

  engine.draft = null;
  engine.isGesturing = false;
  session.interaction = { kind: "idle" };
  return changed;
}

export function pointerCancel(session: EngineSession): void {
  const { engine } = session;
  const interaction = session.interaction;

  if (interaction.kind === "move" || interaction.kind === "resize") {
    // Restore pre-gesture snapshot.
    const previous = engine.history.undoStack.pop();
    if (previous) {
      replaceDocument(engine, previous);
    }
  }

  engine.draft = null;
  engine.isGesturing = false;
  session.interaction = { kind: "idle" };
}

export function deleteSelected(engine: StudioEngine): boolean {
  const id = engine.document.selectedId;
  if (!id) {
    return false;
  }
  pushHistory(engine.history, engine.document);
  return removeObject(engine.document, id);
}

export function clearBoard(engine: StudioEngine): boolean {
  if (engine.document.objects.length === 0) {
    return false;
  }
  pushHistory(engine.history, engine.document);
  clearDocument(engine.document);
  return true;
}

export function undo(engine: StudioEngine): boolean {
  if (engine.isGesturing) {
    return false;
  }
  const previous = historyUndo(engine.history, engine.document);
  if (!previous) {
    return false;
  }
  replaceDocument(engine, previous);
  engine.draft = null;
  return true;
}

export function redo(engine: StudioEngine): boolean {
  if (engine.isGesturing) {
    return false;
  }
  const next = historyRedo(engine.history, engine.document);
  if (!next) {
    return false;
  }
  replaceDocument(engine, next);
  engine.draft = null;
  return true;
}

function replaceDocument(engine: StudioEngine, next: StudioDocument): void {
  const cloned = cloneDocument(next);
  engine.document.objects = cloned.objects;
  engine.document.nextZ = cloned.nextZ;
  engine.document.selectedId = cloned.selectedId;
}

function eraseAt(
  engine: StudioEngine,
  point: Point,
  pushIfFirst: boolean,
): number {
  const before = engine.document.objects.length;
  if (pushIfFirst) {
    // Peek: only push history if something will be erased.
    const hit = engine.document.objects.some((object) => hitsObject(object, point));
    if (!hit) {
      return 0;
    }
    pushHistory(engine.history, engine.document);
  }
  eraseAtPoint(engine.document, point, hitsObject);
  return before - engine.document.objects.length;
}

/**
 * Future Milestone 18.4 entry points: map a normalized board point from hand
 * landmarks into the same operations mouse/touch already use.
 */
export type StudioPointerApi = {
  down: (point: Point) => boolean;
  move: (point: Point) => boolean;
  up: (point?: Point) => boolean;
  cancel: () => void;
  setTool: (tool: StudioSettings["tool"]) => void;
  setColor: (color: string) => void;
  setBrushWidth: (width: number) => void;
  undo: () => boolean;
  redo: () => boolean;
  clear: () => boolean;
  deleteSelected: () => boolean;
};

export function createPointerApi(session: EngineSession): StudioPointerApi {
  return {
    down: (point) => pointerDown(session, point),
    move: (point) => pointerMove(session, point),
    up: (point) => pointerUp(session, point),
    cancel: () => pointerCancel(session),
    setTool: (tool) => setEngineSettings(session.engine, { tool }),
    setColor: (color) => setEngineSettings(session.engine, { color }),
    setBrushWidth: (width) => setEngineSettings(session.engine, { brushWidth: width }),
    undo: () => undo(session.engine),
    redo: () => redo(session.engine),
    clear: () => clearBoard(session.engine),
    deleteSelected: () => deleteSelected(session.engine),
  };
}

export type { StudioObject };
