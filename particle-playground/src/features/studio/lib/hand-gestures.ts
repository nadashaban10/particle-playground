import { nextPinchClosed, measurePinchRatio } from "@/shared/lib/grab-pinch";
import type { Point } from "@/features/studio/lib/types";
import type { TrackedHand } from "@/shared/types/hand-tracking";

const INDEX_TIP = 8;

/** Studio-only gesture priorities (highest first). */
export type StudioHandMode =
  | "idle"
  | "hover"
  | "draw"
  | "pinch_grab"
  | "two_hand_scale"
  | "open_palm"
  | "lost";

export type StudioHandFrame = {
  now: number;
  hands: TrackedHand[];
  /** Board-space index tips, primary hand first. Empty when no hands. */
  tips: Point[];
  /** Distance between two hand tips when two hands are present. */
  twoHandDistance: number | null;
  primaryGesture: TrackedHand["gesture"] | "none";
  pinchClosed: boolean;
};

export type StudioHandGestureState = {
  mode: StudioHandMode;
  pinchClosed: boolean;
  /** Frames the current pinch has been held closed. */
  pinchHoldFrames: number;
  /** True after pinch grab has started (prevents duplicate grabs). */
  pinchArmed: boolean;
  /** Baseline distance for two-hand scale (null until locked). */
  scaleBaseline: number | null;
  /** Last time we had a usable tip while gesturing. */
  lastSeenAt: number;
  /** Tip used for the active board gesture. */
  activeTip: Point | null;
  /** Open-palm latch so one palm hold cancels once. */
  palmConsumed: boolean;
};

export const STUDIO_HAND_CONFIG = {
  pinchCloseBelow: 0.35,
  pinchOpenAbove: 0.55,
  pinchStartFrames: 2,
  lossGraceMs: 220,
  twoHandMinDistance: 40,
  /** Ignore tiny two-hand distance changes (CSS px). */
  scaleDeadzone: 0.02,
} as const;

export function createStudioHandGestureState(
  now = 0,
): StudioHandGestureState {
  return {
    mode: "idle",
    pinchClosed: false,
    pinchHoldFrames: 0,
    pinchArmed: false,
    scaleBaseline: null,
    lastSeenAt: now,
    activeTip: null,
    palmConsumed: false,
  };
}

export function buildStudioHandFrame(
  hands: TrackedHand[],
  tips: Point[],
  previousPinchClosed: boolean,
  now: number,
  aspect = 1,
): StudioHandFrame {
  const primary = hands[0] ?? null;
  const ratio = primary
    ? measurePinchRatio(primary.landmarks, aspect)
    : Number.NaN;
  const pinchClosed = nextPinchClosed(
    previousPinchClosed,
    ratio,
    STUDIO_HAND_CONFIG.pinchCloseBelow,
    STUDIO_HAND_CONFIG.pinchOpenAbove,
  );

  let twoHandDistance: number | null = null;
  if (tips.length >= 2) {
    twoHandDistance = Math.hypot(
      tips[0].x - tips[1].x,
      tips[0].y - tips[1].y,
    );
  }

  return {
    now,
    hands,
    tips,
    twoHandDistance,
    primaryGesture: primary?.gesture ?? "none",
    pinchClosed,
  };
}

/**
 * Advance the Studio hand mode machine.
 *
 * Priority: lost grace → two-hand scale → pinch grab → open palm → draw/hover.
 */
export function advanceStudioHandGesture(
  state: StudioHandGestureState,
  frame: StudioHandFrame,
): StudioHandGestureState {
  const next: StudioHandGestureState = { ...state };
  next.pinchClosed = frame.pinchClosed;

  if (frame.tips.length === 0) {
    if (
      state.mode !== "idle" &&
      state.mode !== "lost" &&
      frame.now - state.lastSeenAt < STUDIO_HAND_CONFIG.lossGraceMs
    ) {
      next.mode = "lost";
      return next;
    }
    next.mode = "idle";
    next.pinchHoldFrames = 0;
    next.pinchArmed = false;
    next.scaleBaseline = null;
    next.activeTip = null;
    next.palmConsumed = false;
    return next;
  }

  next.lastSeenAt = frame.now;
  next.activeTip = frame.tips[0];

  // Two-hand scaling takes priority when both hands are present.
  if (
    frame.tips.length >= 2 &&
    frame.twoHandDistance !== null &&
    frame.twoHandDistance >= STUDIO_HAND_CONFIG.twoHandMinDistance
  ) {
    if (next.scaleBaseline === null) {
      next.scaleBaseline = frame.twoHandDistance;
    }
    next.mode = "two_hand_scale";
    next.pinchHoldFrames = 0;
    next.pinchArmed = false;
    next.palmConsumed = false;
    return next;
  }

  next.scaleBaseline = null;

  if (frame.pinchClosed) {
    next.pinchHoldFrames = state.pinchClosed ? state.pinchHoldFrames + 1 : 1;
    if (
      next.pinchHoldFrames >= STUDIO_HAND_CONFIG.pinchStartFrames ||
      state.mode === "pinch_grab"
    ) {
      next.mode = "pinch_grab";
      next.pinchArmed = true;
      next.palmConsumed = false;
      return next;
    }
  } else {
    next.pinchHoldFrames = 0;
    if (state.mode === "pinch_grab") {
      // Release happens in the adapter; mode returns to hover/draw below.
      next.pinchArmed = false;
    }
  }

  if (frame.primaryGesture === "open_palm") {
    next.mode = "open_palm";
    return next;
  }

  next.palmConsumed = false;

  // Index point draws; other non-pinch poses only hover the cursor.
  // Fist eraser is intentionally not camera-driven (conflicts with grab).
  if (frame.primaryGesture === "point") {
    next.mode = "draw";
    return next;
  }

  next.mode = "hover";
  return next;
}

export function indexTipLandmark(hand: TrackedHand) {
  return hand.landmarks[INDEX_TIP] ?? hand.position;
}
