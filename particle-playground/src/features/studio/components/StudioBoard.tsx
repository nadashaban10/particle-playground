"use client";

import {
  useEffect,
  useRef,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  pointerCancel,
  pointerDown,
  pointerMove,
  pointerUp,
  type EngineSession,
} from "@/features/studio/lib/engine";
import {
  clientToBoard,
  clearCanvas,
  renderStudioDocument,
  setupHiDpiCanvas,
} from "@/features/studio/lib/render-canvas";

type StudioBoardProps = {
  sessionRef: MutableRefObject<EngineSession>;
  onDocumentChange: () => void;
  className?: string;
};

/**
 * Canvas host for Creative Studio. Drawing mutations stay in the session ref;
 * React is notified only when a coherent action completes (or selection changes).
 */
export function StudioBoard({
  sessionRef,
  onDocumentChange,
  className,
}: StudioBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const activePointerRef = useRef<number | null>(null);

  function paint() {
    const ctx = ctxRef.current;
    if (!ctx) {
      return;
    }
    const { width, height } = sizeRef.current;
    clearCanvas(ctx, width, height);
    renderStudioDocument(
      ctx,
      sessionRef.current.engine.document,
      sessionRef.current.engine.draft,
    );
  }

  function resize() {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const parent = canvas.parentElement;
    if (!parent) {
      return;
    }
    const rect = parent.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    sizeRef.current = { width, height };
    sessionRef.current.boardSize = { width, height };
    ctxRef.current = setupHiDpiCanvas(canvas, width, height);
    paint();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    resize();
    const parent = canvas.parentElement;
    const observer =
      typeof ResizeObserver !== "undefined" && parent
        ? new ResizeObserver(() => resize())
        : null;
    observer?.observe(parent!);

    const onWindowResize = () => resize();
    window.addEventListener("resize", onWindowResize);

    const session = sessionRef.current;
    session.paint = () => paint();

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onWindowResize);
      session.paint = undefined;
      ctxRef.current = null;
    };
    // Mount-only canvas host; paint/resize close over latest sessionRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, []);

  function boardPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    return clientToBoard(event.currentTarget, event.clientX, event.clientY);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== null) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    sessionRef.current.physicalPointerActive = true;
    const point = boardPoint(event);
    pointerDown(sessionRef.current, point);
    paint();
    onDocumentChange();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) {
      return;
    }
    const changed = pointerMove(sessionRef.current, boardPoint(event));
    if (changed) {
      paint();
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) {
      return;
    }
    activePointerRef.current = null;
    sessionRef.current.physicalPointerActive = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerUp(sessionRef.current, boardPoint(event));
    paint();
    onDocumentChange();
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) {
      return;
    }
    activePointerRef.current = null;
    sessionRef.current.physicalPointerActive = false;
    pointerCancel(sessionRef.current);
    paint();
    onDocumentChange();
  }

  return (
    <div
      className={className}
      ref={(node) => {
        if (node) {
          sessionRef.current.boardHost = node;
        }
      }}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none select-none rounded-2xl"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        aria-label="Creative Studio drawing board"
      />
    </div>
  );
}
