"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { StudioBoard } from "@/features/studio/components/StudioBoard";
import { StudioHandCamera } from "@/features/studio/components/StudioHandCamera";
import { StudioHandOverlay } from "@/features/studio/components/StudioHandOverlay";
import {
  clearBoard,
  createEngineSession,
  deleteSelected,
  getEngineSnapshot,
  redo,
  setEngineSettings,
  undo,
  type EngineSession,
} from "@/features/studio/lib/engine";
import {
  createStudioHandAdapter,
  tickStudioHandAdapter,
  type StudioHandAdapter,
  type StudioHandFeedback,
} from "@/features/studio/lib/hand-adapter";
import { downloadBlob, exportStudioPng } from "@/features/studio/lib/export-png";
import {
  applyRestoredDocument,
  loadStudioDocument,
  saveStudioDocument,
} from "@/features/studio/lib/persist";
import { STUDIO_TOOLS } from "@/features/studio/lib/tools";
import {
  STUDIO_COLORS,
  type BrushStyle,
  type ShapeKind,
  type StudioTool,
} from "@/features/studio/lib/types";
import type { TrackedHand } from "@/shared/types/hand-tracking";

const SHAPES: { id: ShapeKind; label: string }[] = [
  { id: "circle", label: "Circle" },
  { id: "square", label: "Square" },
  { id: "rectangle", label: "Rect" },
  { id: "triangle", label: "Triangle" },
  { id: "line", label: "Line" },
];

const BRUSHES: { id: BrushStyle; label: string }[] = [
  { id: "pencil", label: "Pencil" },
  { id: "marker", label: "Marker" },
];

type UiSnapshot = {
  canUndo: boolean;
  canRedo: boolean;
  selectedId: string | null;
  objectCount: number;
  tool: StudioTool;
  shape: ShapeKind;
  brushStyle: BrushStyle;
  color: string;
  brushWidth: number;
};

function readUi(session: EngineSession): UiSnapshot {
  const snap = getEngineSnapshot(session.engine);
  const { settings } = session.engine;
  return {
    canUndo: snap.canUndo,
    canRedo: snap.canRedo,
    selectedId: snap.selectedId,
    objectCount: snap.objectCount,
    tool: settings.tool,
    shape: settings.shape,
    brushStyle: settings.brushStyle,
    color: settings.color,
    brushWidth: settings.brushWidth,
  };
}

/**
 * Creative Studio shell: shared board, camera hand input, persist, export.
 */
export function StudioExperience() {
  const [session] = useState(() => createEngineSession());
  const sessionRef = useRef<EngineSession>(session);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const boardSectionRef = useRef<HTMLElement | null>(null);
  const adapterRef = useRef<StudioHandAdapter>(createStudioHandAdapter());
  const feedbackRef = useRef<StudioHandFeedback>(adapterRef.current.feedback);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [ui, setUi] = useState<UiSnapshot>(() => readUi(session));
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraSession, setCameraSession] = useState(0);
  const [persistNote, setPersistNote] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const syncUi = useCallback(() => {
    setUi(readUi(sessionRef.current));
  }, []);

  const paint = useCallback(() => {
    sessionRef.current.paint?.();
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      const result = saveStudioDocument(sessionRef.current.engine.document);
      if (!result.ok && result.reason !== "unavailable") {
        setPersistNote(result.message);
      } else if (result.ok) {
        setPersistNote(null);
      }
    }, 450);
  }, []);

  const onDocumentChange = useCallback(() => {
    syncUi();
    scheduleSave();
  }, [scheduleSave, syncUi]);

  // Restore draft once on mount.
  useEffect(() => {
    const restored = loadStudioDocument();
    if (restored.ok) {
      applyRestoredDocument(
        sessionRef.current.engine.document,
        restored.document,
      );
      syncUi();
      paint();
    }
  }, [paint, syncUi]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const live = sessionRef.current;
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        if (undo(live.engine)) {
          paint();
          onDocumentChange();
        }
        return;
      }

      if (
        meta &&
        (event.key.toLowerCase() === "y" ||
          (event.key.toLowerCase() === "z" && event.shiftKey))
      ) {
        event.preventDefault();
        if (redo(live.engine)) {
          paint();
          onDocumentChange();
        }
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (deleteSelected(live.engine)) {
          event.preventDefault();
          paint();
          onDocumentChange();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDocumentChange, paint]);

  function patchSettings(
    patch: Parameters<typeof setEngineSettings>[1],
  ): void {
    setEngineSettings(sessionRef.current.engine, patch);
    syncUi();
  }

  function runAction(action: () => boolean): void {
    if (action()) {
      paint();
      onDocumentChange();
    }
  }

  function activateControl(
    action: string,
    detail?: { value?: number },
  ): void {
    if (action.startsWith("tool:")) {
      patchSettings({ tool: action.slice(5) as StudioTool });
      return;
    }
    if (action.startsWith("shape:")) {
      patchSettings({ shape: action.slice(6) as ShapeKind, tool: "shape" });
      return;
    }
    if (action.startsWith("color:")) {
      patchSettings({ color: action.slice(6) });
      return;
    }
    if (action.startsWith("brush:")) {
      patchSettings({ brushStyle: action.slice(6) as BrushStyle });
      return;
    }
    if (action === "brush-width" && detail?.value !== undefined) {
      patchSettings({ brushWidth: detail.value });
      return;
    }
    if (action === "undo") {
      runAction(() => undo(sessionRef.current.engine));
      return;
    }
    if (action === "redo") {
      runAction(() => redo(sessionRef.current.engine));
      return;
    }
    if (action === "clear") {
      runAction(() => clearBoard(sessionRef.current.engine));
      return;
    }
    if (action === "delete") {
      runAction(() => deleteSelected(sessionRef.current.engine));
      return;
    }
    if (action === "export") {
      void handleExport();
      return;
    }
    if (action === "camera-toggle") {
      setCameraEnabled((value) => !value);
    }
  }

  async function handleExport(): Promise<void> {
    const board = sessionRef.current.boardSize ?? { width: 960, height: 640 };
    const result = await exportStudioPng(sessionRef.current.engine.document, {
      width: board.width,
      height: board.height,
      dpr: Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 2),
    });
    if (!result.ok) {
      setExportNote(result.message);
      return;
    }
    downloadBlob(result.blob, result.filename);
    setExportNote("PNG saved");
    window.setTimeout(() => setExportNote(null), 2000);
  }

  const onHands = useCallback(
    (hands: TrackedHand[], detectedAt: number) => {
      const stage = stageRef.current;
      const boardHost =
        sessionRef.current.boardHost ?? boardSectionRef.current;
      if (!stage || !boardHost) {
        return;
      }

      const stageRect = stage.getBoundingClientRect();
      const boardRect = boardHost.getBoundingClientRect();
      const painted = tickStudioHandAdapter(adapterRef.current, hands, {
        session: sessionRef.current,
        stageSize: { width: stageRect.width, height: stageRect.height },
        stageRect,
        boardRect,
        physicalPointerActive: Boolean(
          sessionRef.current.physicalPointerActive,
        ),
        cameraEnabled,
        now: detectedAt,
        onDocumentChange,
        activateControl,
      });
      feedbackRef.current = adapterRef.current.feedback;
      if (painted) {
        paint();
      }
    },
    // activateControl is stable enough via closures; keep deps tight.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- camera frame callback
    [cameraEnabled, onDocumentChange, paint],
  );

  // Reset hand adapter when camera turns off.
  useEffect(() => {
    if (!cameraEnabled) {
      tickStudioHandAdapter(adapterRef.current, [], {
        session: sessionRef.current,
        stageSize: { width: 1, height: 1 },
        stageRect: null,
        boardRect: null,
        physicalPointerActive: false,
        cameraEnabled: false,
        now: performance.now(),
        onDocumentChange,
      });
      feedbackRef.current = adapterRef.current.feedback;
      paint();
    }
  }, [cameraEnabled, onDocumentChange, paint]);

  const status = cameraEnabled
    ? ui.selectedId
      ? "Pinch to move · two hands to scale · open palm to pause"
      : ui.tool === "draw"
        ? "Point with your index finger to draw"
        : ui.tool === "shape"
          ? "Point and drag to place a shape"
          : ui.tool === "eraser"
            ? "Point over marks to erase"
            : "Pinch art to select and move"
    : ui.selectedId
      ? "Selected — drag to move, handles to resize"
      : ui.tool === "draw"
        ? "Draw freely on the board"
        : ui.tool === "shape"
          ? "Press and drag to place a shape"
          : ui.tool === "eraser"
            ? "Tap or drag over art to erase"
            : "Tap art to select it";

  return (
    <main className="relative flex min-h-dvh flex-col bg-[#020617] text-slate-50">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(120,53,15,0.22),_transparent_50%),radial-gradient(ellipse_at_bottom_right,_rgba(8,47,73,0.35),_transparent_45%)]"
      />

      <header className="relative z-10 flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.28em] text-amber-200/80 uppercase sm:text-xs">
            Creative Studio
          </p>
          <h1 className="truncate font-display text-xl tracking-tight sm:text-2xl">
            Cosmic Canvas
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-studio-action="camera-toggle"
            onClick={() => setCameraEnabled((value) => !value)}
            className={`rounded-full px-3 py-2 text-xs sm:text-sm ${
              cameraEnabled
                ? "bg-amber-200 text-slate-950"
                : "text-slate-300 ring-1 ring-white/15"
            }`}
          >
            {cameraEnabled ? "Camera on" : "Camera"}
          </button>
          <Link
            href="/"
            className="rounded-full px-3 py-2 text-xs text-slate-300 ring-1 ring-white/15 sm:text-sm"
          >
            Home
          </Link>
          <Link
            href="/explore"
            className="rounded-full bg-cyan-300/90 px-3 py-2 text-xs font-medium text-slate-950 sm:text-sm"
          >
            Explore
          </Link>
        </div>
      </header>

      <div
        ref={stageRef}
        className="relative z-10 flex min-h-0 flex-1 flex-col gap-3 px-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-1 sm:flex-row sm:gap-4 sm:px-6 sm:pb-6"
      >
        <aside className="hidden w-52 shrink-0 flex-col gap-4 sm:flex lg:w-56">
          <ToolGroup
            title="Tools"
            ui={ui}
            onTool={(tool) => patchSettings({ tool })}
          />
          {ui.tool === "draw" ? (
            <BrushGroup
              ui={ui}
              onStyle={(brushStyle) => patchSettings({ brushStyle })}
              onWidth={(brushWidth) => patchSettings({ brushWidth })}
            />
          ) : null}
          {ui.tool === "shape" ? (
            <ShapeGroup
              ui={ui}
              onShape={(shape) => patchSettings({ shape })}
              onWidth={(brushWidth) => patchSettings({ brushWidth })}
            />
          ) : null}
          {(ui.tool === "draw" || ui.tool === "shape") && (
            <ColorGroup
              ui={ui}
              onColor={(color) => patchSettings({ color })}
            />
          )}
          <ActionGroup
            ui={ui}
            onUndo={() => runAction(() => undo(sessionRef.current.engine))}
            onRedo={() => runAction(() => redo(sessionRef.current.engine))}
            onClear={() =>
              runAction(() => clearBoard(sessionRef.current.engine))
            }
            onDelete={() =>
              runAction(() => deleteSelected(sessionRef.current.engine))
            }
            onExport={() => void handleExport()}
          />
          <p
            className="text-xs leading-relaxed text-slate-400"
            aria-live="polite"
          >
            {status}
          </p>
          {persistNote ? (
            <p className="text-[11px] text-rose-300">{persistNote}</p>
          ) : null}
          {exportNote ? (
            <p className="text-[11px] text-teal-300">{exportNote}</p>
          ) : null}
        </aside>

        <section
          ref={boardSectionRef}
          className="relative min-h-[52dvh] flex-1 overflow-hidden rounded-2xl ring-1 ring-white/10 sm:min-h-0"
        >
          <StudioBoard
            sessionRef={sessionRef as MutableRefObject<EngineSession>}
            onDocumentChange={onDocumentChange}
            className="absolute inset-0"
          />
          <StudioHandOverlay
            feedbackRef={feedbackRef}
            active={cameraEnabled}
          />
          {cameraEnabled ? (
            <StudioHandCamera
              key={cameraSession}
              onHands={onHands}
              onRetry={() => setCameraSession((value) => value + 1)}
            />
          ) : null}
          <div className="pointer-events-none absolute top-3 left-3 rounded-full bg-slate-950/55 px-3 py-1 text-[11px] text-slate-300 backdrop-blur-sm sm:hidden">
            {ui.objectCount} marks
          </div>
        </section>

        <div className="flex flex-col gap-2 sm:hidden">
          {(ui.tool === "draw" || ui.tool === "shape") && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {STUDIO_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  data-studio-action={`color:${color}`}
                  aria-label={`Color ${color}`}
                  onClick={() => patchSettings({ color })}
                  className={`h-9 w-9 shrink-0 rounded-full ring-2 ${
                    ui.color === color ? "ring-amber-200" : "ring-white/20"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          )}
          {ui.tool === "shape" ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {SHAPES.map((shape) => (
                <button
                  key={shape.id}
                  type="button"
                  data-studio-action={`shape:${shape.id}`}
                  onClick={() => patchSettings({ shape: shape.id })}
                  className={`shrink-0 rounded-full px-3 py-2 text-xs ${
                    ui.shape === shape.id
                      ? "bg-amber-200 text-slate-950"
                      : "bg-white/5 text-slate-200 ring-1 ring-white/10"
                  }`}
                >
                  {shape.label}
                </button>
              ))}
            </div>
          ) : null}
          {ui.tool === "draw" ? (
            <div className="flex items-center gap-2">
              {BRUSHES.map((brush) => (
                <button
                  key={brush.id}
                  type="button"
                  data-studio-action={`brush:${brush.id}`}
                  onClick={() => patchSettings({ brushStyle: brush.id })}
                  className={`rounded-full px-3 py-2 text-xs ${
                    ui.brushStyle === brush.id
                      ? "bg-amber-200 text-slate-950"
                      : "bg-white/5 text-slate-200 ring-1 ring-white/10"
                  }`}
                >
                  {brush.label}
                </button>
              ))}
              <label className="ml-auto flex items-center gap-2 text-xs text-slate-300">
                Size
                <input
                  type="range"
                  min={2}
                  max={28}
                  value={ui.brushWidth}
                  data-studio-action="brush-width"
                  data-min="2"
                  data-max="28"
                  onChange={(event) =>
                    patchSettings({ brushWidth: Number(event.target.value) })
                  }
                  className="w-24 accent-amber-200"
                />
              </label>
            </div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              data-studio-action="export"
              onClick={() => void handleExport()}
              className="rounded-full bg-white/5 px-3 py-2 text-xs text-slate-200 ring-1 ring-white/10"
            >
              Export PNG
            </button>
            {exportNote ? (
              <span className="self-center text-[11px] text-teal-300">
                {exportNote}
              </span>
            ) : null}
          </div>
          <p className="text-center text-[11px] text-slate-400">{status}</p>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#020617]/95 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:hidden">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-1">
          {STUDIO_TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              data-studio-action={`tool:${tool.id}`}
              onClick={() => patchSettings({ tool: tool.id })}
              className={`flex min-h-12 min-w-[3.5rem] flex-1 flex-col items-center justify-center rounded-xl px-1 text-[11px] ${
                ui.tool === tool.id
                  ? "bg-amber-200 text-slate-950"
                  : "text-slate-300"
              }`}
            >
              <span className="font-medium">{tool.label}</span>
            </button>
          ))}
          <button
            type="button"
            data-studio-action="undo"
            aria-label="Undo"
            disabled={!ui.canUndo}
            onClick={() => runAction(() => undo(sessionRef.current.engine))}
            className="min-h-12 min-w-11 rounded-xl text-xs text-slate-200 disabled:opacity-30"
          >
            Undo
          </button>
          <button
            type="button"
            data-studio-action="redo"
            aria-label="Redo"
            disabled={!ui.canRedo}
            onClick={() => runAction(() => redo(sessionRef.current.engine))}
            className="min-h-12 min-w-11 rounded-xl text-xs text-slate-200 disabled:opacity-30"
          >
            Redo
          </button>
        </div>
      </nav>
    </main>
  );
}

function ToolGroup({
  title,
  ui,
  onTool,
}: {
  title: string;
  ui: UiSnapshot;
  onTool: (tool: StudioTool) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-[10px] tracking-[0.2em] text-slate-500 uppercase">
        {title}
      </p>
      <div className="flex flex-col gap-1.5">
        {STUDIO_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            data-studio-action={`tool:${tool.id}`}
            onClick={() => onTool(tool.id)}
            className={`rounded-xl px-3 py-2.5 text-left text-sm ${
              ui.tool === tool.id
                ? "bg-amber-200 text-slate-950"
                : "bg-white/5 text-slate-200 ring-1 ring-white/10 hover:bg-white/10"
            }`}
          >
            <span className="font-medium">{tool.label}</span>
            <span className="mt-0.5 block text-[11px] opacity-70">
              {tool.hint}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BrushGroup({
  ui,
  onStyle,
  onWidth,
}: {
  ui: UiSnapshot;
  onStyle: (style: BrushStyle) => void;
  onWidth: (width: number) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-[10px] tracking-[0.2em] text-slate-500 uppercase">
        Brush
      </p>
      <div className="flex gap-1.5">
        {BRUSHES.map((brush) => (
          <button
            key={brush.id}
            type="button"
            data-studio-action={`brush:${brush.id}`}
            onClick={() => onStyle(brush.id)}
            className={`flex-1 rounded-xl px-2 py-2 text-xs ${
              ui.brushStyle === brush.id
                ? "bg-cyan-300 text-slate-950"
                : "bg-white/5 text-slate-200 ring-1 ring-white/10"
            }`}
          >
            {brush.label}
          </button>
        ))}
      </div>
      <label className="mt-3 flex flex-col gap-1 text-xs text-slate-400">
        Thickness
        <input
          type="range"
          min={2}
          max={28}
          value={ui.brushWidth}
          data-studio-action="brush-width"
          data-min="2"
          data-max="28"
          onChange={(event) => onWidth(Number(event.target.value))}
          className="accent-amber-200"
        />
      </label>
    </div>
  );
}

function ShapeGroup({
  ui,
  onShape,
  onWidth,
}: {
  ui: UiSnapshot;
  onShape: (shape: ShapeKind) => void;
  onWidth: (width: number) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-[10px] tracking-[0.2em] text-slate-500 uppercase">
        Shape
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {SHAPES.map((shape) => (
          <button
            key={shape.id}
            type="button"
            data-studio-action={`shape:${shape.id}`}
            onClick={() => onShape(shape.id)}
            className={`rounded-xl px-2 py-2 text-xs ${
              ui.shape === shape.id
                ? "bg-cyan-300 text-slate-950"
                : "bg-white/5 text-slate-200 ring-1 ring-white/10"
            }`}
          >
            {shape.label}
          </button>
        ))}
      </div>
      <label className="mt-3 flex flex-col gap-1 text-xs text-slate-400">
        Outline
        <input
          type="range"
          min={2}
          max={20}
          value={ui.brushWidth}
          data-studio-action="brush-width"
          data-min="2"
          data-max="20"
          onChange={(event) => onWidth(Number(event.target.value))}
          className="accent-amber-200"
        />
      </label>
    </div>
  );
}

function ColorGroup({
  ui,
  onColor,
}: {
  ui: UiSnapshot;
  onColor: (color: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-[10px] tracking-[0.2em] text-slate-500 uppercase">
        Color
      </p>
      <div className="grid grid-cols-4 gap-2">
        {STUDIO_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            data-studio-action={`color:${color}`}
            aria-label={`Color ${color}`}
            onClick={() => onColor(color)}
            className={`h-9 w-full rounded-full ring-2 ${
              ui.color === color ? "ring-amber-200" : "ring-white/15"
            }`}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </div>
  );
}

function ActionGroup({
  ui,
  onUndo,
  onRedo,
  onClear,
  onDelete,
  onExport,
}: {
  ui: UiSnapshot;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="mb-1 text-[10px] tracking-[0.2em] text-slate-500 uppercase">
        Board
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          data-studio-action="undo"
          disabled={!ui.canUndo}
          onClick={onUndo}
          className="rounded-xl bg-white/5 px-2 py-2 text-xs text-slate-200 ring-1 ring-white/10 disabled:opacity-30"
        >
          Undo
        </button>
        <button
          type="button"
          data-studio-action="redo"
          disabled={!ui.canRedo}
          onClick={onRedo}
          className="rounded-xl bg-white/5 px-2 py-2 text-xs text-slate-200 ring-1 ring-white/10 disabled:opacity-30"
        >
          Redo
        </button>
      </div>
      <button
        type="button"
        data-studio-action="delete"
        disabled={!ui.selectedId}
        onClick={onDelete}
        className="rounded-xl bg-white/5 px-2 py-2 text-xs text-slate-200 ring-1 ring-white/10 disabled:opacity-30"
      >
        Delete selected
      </button>
      <button
        type="button"
        data-studio-action="clear"
        disabled={ui.objectCount === 0}
        onClick={onClear}
        className="rounded-xl bg-rose-400/15 px-2 py-2 text-xs text-rose-100 ring-1 ring-rose-300/20 disabled:opacity-30"
      >
        Clear board
      </button>
      <button
        type="button"
        data-studio-action="export"
        onClick={onExport}
        className="rounded-xl bg-teal-300/15 px-2 py-2 text-xs text-teal-100 ring-1 ring-teal-200/20"
      >
        Export PNG
      </button>
    </div>
  );
}
