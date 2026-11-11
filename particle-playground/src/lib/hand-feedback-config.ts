import { gestureForceConfig } from "@/lib/gesture-force-config";

/** Linear RGB, each channel 0..1. */
export type Rgb = { r: number; g: number; b: number };

function hex(value: number): Rgb {
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255,
  };
}

export type HandVisualMode =
  | "tracked"
  | "ready"
  | "pinch"
  | "grab"
  | "repel"
  | "attract"
  | "v_sign";

export type PulseKind =
  | "burst"
  | "release"
  | "ready"
  | "repel"
  | "attract"
  | "switch";

type PulseShape = {
  /** Seconds the pulse lives. */
  duration: number;
  /** World-unit radius at the start and at the end of its life. */
  from: number;
  to: number;
  /** Peak opacity (before the hand's emphasis). */
  opacity: number;
};

export type HandFeedbackConfig = {
  /** Seconds a hand must be tracked before it counts as ready. */
  readySeconds: number;
  /** Follow rates (per second) for the exponential smoothing of each quantity. */
  anchorSmoothing: number;
  shapeSmoothing: number;
  colorSmoothing: number;
  nearSmoothing: number;
  /** Presence fade rates (units of presence per second). */
  fadeInRate: number;
  fadeOutRate: number;
  /** Frames longer than this (s) are treated as this long. */
  maxStepSeconds: number;
  /** Core ring radius per mode, in world units, and the extra when near the formation. */
  radius: Record<HandVisualMode, number> & { near: number };
  ringOpacity: Record<HandVisualMode, number>;
  /** Opacity of the soft glow behind the ring, per mode. */
  glowOpacity: Record<HandVisualMode, number>;
  /** Glow radius as a multiple of the ring radius. */
  glowScale: number;
  /** Slow "breathing" of the holding ring: cycles per second and relative depth. */
  breathHz: number;
  breathDepth: number;
  colors: Record<HandVisualMode | "limit", Rgb>;
  pulses: Record<PulseKind, PulseShape>;
  /** Seconds between pulses while a force is held; scaled up by the force strength. */
  repelInterval: number;
  attractInterval: number;
  /** A held force below this strength shows no pulses (it is still fading in or out). */
  pulseMinEmphasis: number;
  twoHand: {
    fadeInRate: number;
    fadeOutRate: number;
    /** Follow rate of the activity glow, and how much each kind of change adds to it. */
    activitySmoothing: number;
    scaleGain: number;
    angleGain: number;
    /** Follow rate of the warm tint shown while pinned at a scale limit. */
    limitSmoothing: number;
    /** Opacity of the line and ring at rest, and the most added by activity. */
    lineOpacity: number;
    ringOpacity: number;
    activityBoost: number;
    /** Line thickness in world units. */
    lineThickness: number;
  };
};

/**
 * How hand interactions look. Everything is a world-unit size, an opacity, or a
 * time, so it can be tuned here without touching the logic. The camera sees about
 * 11.5 world units top to bottom.
 */
export const handFeedbackConfig: HandFeedbackConfig = {
  readySeconds: 0.35,
  anchorSmoothing: 24,
  shapeSmoothing: 14,
  colorSmoothing: 10,
  nearSmoothing: 10,
  fadeInRate: 7,
  fadeOutRate: 5,
  maxStepSeconds: 0.05,
  radius: {
    tracked: 0.09,
    ready: 0.2,
    pinch: 0.14,
    grab: 0.26,
    repel: 0.24,
    attract: 0.24,
    v_sign: 0.22,
    near: 0.05,
  },
  ringOpacity: {
    tracked: 0.22,
    ready: 0.42,
    pinch: 0.7,
    grab: 0.95,
    repel: 0.7,
    attract: 0.7,
    v_sign: 0.78,
  },
  glowOpacity: {
    tracked: 0.05,
    ready: 0.12,
    pinch: 0.22,
    grab: 0.38,
    repel: 0.26,
    attract: 0.26,
    v_sign: 0.3,
  },
  glowScale: 3.4,
  breathHz: 0.9,
  breathDepth: 0.06,
  colors: {
    tracked: hex(0xbae6fd),
    ready: hex(0xbae6fd),
    pinch: hex(0x67e8f9),
    grab: hex(0x67e8f9),
    repel: hex(0xfb7185),
    attract: hex(0xc084fc),
    v_sign: hex(0xa5f3fc),
    limit: hex(0xfbbf24),
  },
  pulses: {
    burst: { duration: 0.45, from: 0.15, to: 1.1, opacity: 0.9 },
    release: { duration: 0.6, from: 0.3, to: 1.5, opacity: 0.5 },
    ready: { duration: 0.8, from: 0.12, to: 0.7, opacity: 0.35 },
    // Outward from the hand, to just inside the force radius.
    repel: {
      duration: 0.75,
      from: 0.3,
      to: gestureForceConfig.radius * 0.9,
      opacity: 0.55,
    },
    // Inward, from just inside the force radius to the hand: the reverse motion.
    attract: {
      duration: 0.85,
      from: gestureForceConfig.radius * 0.9,
      to: 0.22,
      opacity: 0.6,
    },
    // Short confirmation when a V-sign hold completes a formation switch.
    switch: { duration: 0.55, from: 0.18, to: 0.95, opacity: 0.7 },
  },
  repelInterval: 0.5,
  attractInterval: 0.65,
  pulseMinEmphasis: 0.25,
  twoHand: {
    fadeInRate: 8,
    fadeOutRate: 6,
    activitySmoothing: 10,
    scaleGain: 0.8,
    angleGain: 0.35,
    limitSmoothing: 8,
    lineOpacity: 0.16,
    ringOpacity: 0.1,
    activityBoost: 0.3,
    lineThickness: 0.02,
  },
};
