import {
  cloneObject,
  findObject,
  scaleObjectAboutCenter,
} from "@/features/studio/lib/document";
import {
  createPointerApi,
  type EngineSession,
  type StudioPointerApi,
} from "@/features/studio/lib/engine";
import { objectBounds } from "@/features/studio/lib/geometry";
import {
  clientToBoardPoint,
  landmarkToClientPoint,
  landmarkToStagePoint,
  type BoardSize,
} from "@/features/studio/lib/hand-coords";
import {
  advanceStudioHandGesture,
  buildStudioHandFrame,
  createStudioHandGestureState,
  indexTipLandmark,
  STUDIO_HAND_CONFIG,
  type StudioHandGestureState,
  type StudioHandMode,
} from "@/features/studio/lib/hand-gestures";
import { pushHistory } from "@/features/studio/lib/history";
import type {
  Bounds,
  Point,
  StudioObject,
  StudioTool,
} from "@/features/studio/lib/types";
import type { TrackedHand } from "@/shared/types/hand-tracking";

export type StudioHandFeedback = {
  mode: StudioHandMode;
  /** Cursor in board CSS pixels (null when off-board or no hand). */
  cursor: Point | null;
  secondary: Point | null;
  scaling: boolean;
  pinch: boolean;
  tracking: boolean;
};

export type StudioHandAdapter = {
  state: StudioHandGestureState;
  feedback: StudioHandFeedback;
  cameraGesturing: boolean;
  scaleStart: { id: string; bounds: Bounds; source: StudioObject } | null;
  savedTool: StudioTool | null;
  uiDragControl: string | null;
  lastUiFireAt: number;
  prevPinchClosed: boolean;
};

export function createStudioHandAdapter(): StudioHandAdapter {
  return {
    state: createStudioHandGestureState(),
    feedback: emptyFeedback(),
    cameraGesturing: false,
    scaleStart: null,
    savedTool: null,
    uiDragControl: null,
    lastUiFireAt: 0,
    prevPinchClosed: false,
  };
}

export type HandAdapterContext = {
  session: EngineSession;
  /** Full studio interactive stage size (sidebar + board + docks). */
  stageSize: BoardSize;
  stageRect: DOMRect | null;
  boardRect: DOMRect | null;
  physicalPointerActive: boolean;
  cameraEnabled: boolean;
  now: number;
  onDocumentChange: () => void;
  activateControl?: (action: string, detail?: { value?: number }) => void;
};

/**
 * Process one landmark frame into Studio pointer / scale / UI actions.
 * Returns whether the board should repaint.
 */
export function tickStudioHandAdapter(
  adapter: StudioHandAdapter,
  hands: TrackedHand[],
  ctx: HandAdapterContext,
): boolean {
  const api = createPointerApi(ctx.session);
  let needsPaint = false;

  if (!ctx.cameraEnabled) {
    return resetAdapter(adapter, api, ctx);
  }

  const stageTips = hands.map((hand) =>
    landmarkToStagePoint(indexTipLandmark(hand), ctx.stageSize),
  );

  // Board-space tips for drawing / gesture distances.
  const boardTips: Point[] = [];
  if (ctx.stageRect && ctx.boardRect) {
    for (const hand of hands) {
      const client = landmarkToClientPoint(
        indexTipLandmark(hand),
        ctx.stageRect,
      );
      boardTips.push(
        clientToBoardPoint(client.clientX, client.clientY, ctx.boardRect),
      );
    }
  } else {
    boardTips.push(...stageTips);
  }

  adapter.prevPinchClosed = adapter.state.pinchClosed;
  const frame = buildStudioHandFrame(
    hands,
    boardTips,
    adapter.state.pinchClosed,
    ctx.now,
  );
  const previousMode = adapter.state.mode;
  adapter.state = advanceStudioHandGesture(adapter.state, frame);

  const primaryBoard = boardTips[0] ?? null;
  const onBoard =
    primaryBoard !== null &&
    ctx.boardRect !== null &&
    primaryBoard.x >= -8 &&
    primaryBoard.y >= -8 &&
    primaryBoard.x <= ctx.boardRect.width + 8 &&
    primaryBoard.y <= ctx.boardRect.height + 8;

  adapter.feedback = {
    mode: adapter.state.mode,
    cursor: onBoard ? primaryBoard : primaryBoard,
    secondary: boardTips[1] ?? null,
    scaling: adapter.state.mode === "two_hand_scale",
    pinch: adapter.state.mode === "pinch_grab",
    tracking: boardTips.length > 0,
  };

  if (ctx.physicalPointerActive) {
    if (adapter.cameraGesturing) {
      api.cancel();
      adapter.cameraGesturing = false;
      restoreTool(adapter, api);
      adapter.scaleStart = null;
      needsPaint = true;
      ctx.onDocumentChange();
    }
    return needsPaint;
  }

  if (adapter.state.mode === "lost") {
    return needsPaint;
  }

  if (adapter.state.mode === "idle") {
    if (adapter.cameraGesturing) {
      api.up(adapter.state.activeTip ?? undefined);
      adapter.cameraGesturing = false;
      restoreTool(adapter, api);
      needsPaint = true;
      ctx.onDocumentChange();
    }
    if (adapter.scaleStart) {
      adapter.scaleStart = null;
      needsPaint = true;
      ctx.onDocumentChange();
    }
    return needsPaint;
  }

  if (adapter.state.mode === "open_palm") {
    if (adapter.cameraGesturing && !adapter.state.palmConsumed) {
      api.cancel();
      adapter.cameraGesturing = false;
      adapter.state.palmConsumed = true;
      restoreTool(adapter, api);
      adapter.scaleStart = null;
      needsPaint = true;
      ctx.onDocumentChange();
    }
    return needsPaint;
  }

  if (adapter.state.mode === "two_hand_scale") {
    return (
      applyTwoHandScale(
        adapter,
        ctx,
        twoHandFactor(adapter, frame.twoHandDistance),
      ) || needsPaint
    );
  }

  if (previousMode === "two_hand_scale" && adapter.scaleStart) {
    adapter.scaleStart = null;
    needsPaint = true;
    ctx.onDocumentChange();
  }

  const tip = boardTips[0];
  if (!tip) {
    return needsPaint;
  }

  // UI controls first when the tip is over chrome (not the canvas).
  const ui = tryUiInteraction(adapter, hands[0], ctx);
  if (ui.handled) {
    if (adapter.cameraGesturing && previousMode === "draw") {
      // already cancelled inside tryUiInteraction when needed
    }
    return needsPaint || ui.paint;
  }

  if (adapter.state.mode === "pinch_grab") {
    if (!adapter.cameraGesturing) {
      if (adapter.savedTool === null) {
        adapter.savedTool = ctx.session.engine.settings.tool;
      }
      api.setTool("select");
      api.down(tip);
      adapter.cameraGesturing = true;
      needsPaint = true;
      ctx.onDocumentChange();
    } else if (api.move(tip)) {
      needsPaint = true;
    }
    return needsPaint;
  }

  if (previousMode === "pinch_grab" && adapter.cameraGesturing) {
    api.up(tip);
    adapter.cameraGesturing = false;
    restoreTool(adapter, api);
    needsPaint = true;
    ctx.onDocumentChange();
  }

  const tool = ctx.session.engine.settings.tool;
  if (
    adapter.state.mode === "draw" &&
    onBoard &&
    (tool === "draw" || tool === "shape" || tool === "eraser")
  ) {
    if (!adapter.cameraGesturing) {
      api.down(tip);
      adapter.cameraGesturing = true;
      needsPaint = true;
      ctx.onDocumentChange();
    } else if (api.move(tip)) {
      needsPaint = true;
    }
    return needsPaint;
  }

  if (adapter.cameraGesturing && (adapter.state.mode === "hover" || !onBoard)) {
    api.up(tip);
    adapter.cameraGesturing = false;
    needsPaint = true;
    ctx.onDocumentChange();
  }

  return needsPaint;
}

function emptyFeedback(): StudioHandFeedback {
  return {
    mode: "idle",
    cursor: null,
    secondary: null,
    scaling: false,
    pinch: false,
    tracking: false,
  };
}

function twoHandFactor(
  adapter: StudioHandAdapter,
  distance: number | null,
): number {
  if (
    adapter.state.scaleBaseline === null ||
    distance === null ||
    adapter.state.scaleBaseline < 1
  ) {
    return 1;
  }
  const raw = distance / adapter.state.scaleBaseline;
  if (Math.abs(raw - 1) < STUDIO_HAND_CONFIG.scaleDeadzone) {
    return 1;
  }
  return Math.min(4, Math.max(0.25, raw));
}

function applyTwoHandScale(
  adapter: StudioHandAdapter,
  ctx: HandAdapterContext,
  factor: number,
): boolean {
  const id = ctx.session.engine.document.selectedId;
  if (!id) {
    return false;
  }
  const object = findObject(ctx.session.engine.document, id);
  if (!object) {
    return false;
  }

  if (!adapter.scaleStart) {
    pushHistory(ctx.session.engine.history, ctx.session.engine.document);
    adapter.scaleStart = {
      id,
      bounds: objectBounds(object),
      source: cloneObject(object),
    };
  }

  const start = adapter.scaleStart;
  if (!start || start.id !== id) {
    return false;
  }

  return scaleObjectAboutCenter(
    ctx.session.engine.document,
    id,
    start.source,
    start.bounds,
    factor,
  );
}

function restoreTool(adapter: StudioHandAdapter, api: StudioPointerApi): void {
  if (adapter.savedTool !== null) {
    api.setTool(adapter.savedTool);
    adapter.savedTool = null;
  }
}

function resetAdapter(
  adapter: StudioHandAdapter,
  api: StudioPointerApi,
  ctx: HandAdapterContext,
): boolean {
  let painted = false;
  if (adapter.cameraGesturing) {
    api.cancel();
    adapter.cameraGesturing = false;
    painted = true;
    ctx.onDocumentChange();
  }
  restoreTool(adapter, api);
  adapter.scaleStart = null;
  adapter.state = createStudioHandGestureState(ctx.now);
  adapter.feedback = emptyFeedback();
  adapter.uiDragControl = null;
  adapter.prevPinchClosed = false;
  return painted;
}

type UiResult = { handled: boolean; paint: boolean };

function tryUiInteraction(
  adapter: StudioHandAdapter,
  hand: TrackedHand | undefined,
  ctx: HandAdapterContext,
): UiResult {
  if (!ctx.stageRect || !hand || !ctx.activateControl) {
    return { handled: false, paint: false };
  }

  if (typeof document === "undefined") {
    return { handled: false, paint: false };
  }

  const client = landmarkToClientPoint(indexTipLandmark(hand), ctx.stageRect);
  const el = document.elementFromPoint(client.clientX, client.clientY);
  const control = el?.closest?.("[data-studio-action]") as HTMLElement | null;
  if (!control) {
    adapter.uiDragControl = null;
    return { handled: false, paint: false };
  }

  const action = control.dataset.studioAction;
  if (!action) {
    return { handled: false, paint: false };
  }

  if (adapter.cameraGesturing) {
    createPointerApi(ctx.session).cancel();
    adapter.cameraGesturing = false;
  }

  if (action === "brush-width" && adapter.state.pinchClosed) {
    const min = Number(control.dataset.min ?? 2);
    const max = Number(control.dataset.max ?? 28);
    const rect = control.getBoundingClientRect();
    const t = Math.min(
      1,
      Math.max(0, (client.clientX - rect.left) / Math.max(1, rect.width)),
    );
    const value = Math.round(min + t * (max - min));
    ctx.activateControl(action, { value });
    adapter.uiDragControl = action;
    return { handled: true, paint: false };
  }

  if (adapter.state.pinchClosed && !adapter.prevPinchClosed) {
    if (action !== "brush-width" && ctx.now - adapter.lastUiFireAt > 400) {
      ctx.activateControl(action);
      adapter.lastUiFireAt = ctx.now;
      adapter.uiDragControl = action;
      return { handled: true, paint: true };
    }
  }

  if (!adapter.state.pinchClosed) {
    adapter.uiDragControl = null;
  }

  return { handled: true, paint: false };
}
