import type { FormationSwitchState } from "@/shared/lib/formation-switch";
import type { GestureForceState } from "@/shared/lib/gesture-forces";
import type { GrabState } from "@/shared/lib/grab-interaction";
import {
  handFeedbackConfig,
  type HandFeedbackConfig,
  type HandVisualMode,
  type PulseKind,
  type Rgb,
} from "@/shared/lib/hand-feedback-config";
import type { TwoHandState } from "@/shared/lib/two-hand-transform";
import type { HandInteractionSample } from "@/shared/types/hand-interaction";

/**
 * What the hands look like. This module owns only animation state (fades,
 * smoothed positions, pulse timers, colours). It never decides anything about
 * interaction: each frame it reads the states that already exist (the
 * interaction samples, the grab, the two-hand transform, the gesture forces,
 * the formation switch) and turns them into something drawable. Nothing here
 * changes how the particles behave.
 *
 * Pure and three-free; nothing allocates after construction.
 *
 * Per hand, the mode is, in priority order:
 *   grab    holding the formation (single grab or part of a two-hand transform)
 *   pinch   pinching, but not holding anything (yet)
 *   v_sign  charging or confirming a formation switch
 *   repel   open palm pushing particles away
 *   attract fist pulling particles in
 *   ready   tracked steadily for `readySeconds`
 *   tracked just detected
 */

export type { HandVisualMode, PulseKind } from "@/shared/lib/hand-feedback-config";

const PULSES_PER_HAND = 4;
const HAND_SLOTS = 4;

export type Pulse = {
  active: boolean;
  kind: PulseKind;
  age: number;
  duration: number;
  /** 0..1, the hand's emphasis when the pulse was spawned. */
  strength: number;
};

export type HandVisual = {
  key: string | null;
  mode: HandVisualMode;
  /** A valid sample for this hand arrived this frame. */
  present: boolean;
  /** 0..1 fade of the whole hand indicator. */
  presence: number;
  /** Seconds this hand has been tracked without a break. */
  trackedTime: number;
  /** Smoothed anchor in world space. */
  x: number;
  y: number;
  z: number;
  placed: boolean;
  /** 0..1: how strongly the current mode is expressed (force strength, pinch depth...). */
  emphasis: number;
  /** 0..1: within reach of the formation while not pinching. */
  near: number;
  /** Smoothed look of the core ring and the glow behind it. */
  ringRadius: number;
  ringOpacity: number;
  glowOpacity: number;
  color: Rgb;
  pulses: Pulse[];
  /** Seconds until the next pulse while a force is held. */
  spawnTimer: number;
};

export type TwoHandVisual = {
  /** 0..1 fade of the two-hand overlay. */
  presence: number;
  /** The two hands' smoothed anchors. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Midpoint, half the hand distance, and the angle from A to B. */
  mx: number;
  my: number;
  radius: number;
  angle: number;
  /** 0..1: how much the transform is changing right now. */
  activity: number;
  /** 0..1: pinned at a scale limit. */
  limit: number;
  /** Line / ring opacity, ready to draw (presence included). */
  lineOpacity: number;
  ringOpacity: number;
  color: Rgb;
  previousDistance: number;
  previousAngle: number;
  previousValid: boolean;
};

export type HandFeedbackState = {
  config: HandFeedbackConfig;
  hands: HandVisual[];
  two: TwoHandVisual;
  time: number;
  /** No pulses or breathing; the indicator still changes state. */
  reducedMotion: boolean;
};

function createPulse(): Pulse {
  return { active: false, kind: "burst", age: 0, duration: 1, strength: 1 };
}

function createRgb(): Rgb {
  return { r: 1, g: 1, b: 1 };
}

function createHand(config: HandFeedbackConfig): HandVisual {
  const pulses: Pulse[] = [];
  for (let index = 0; index < PULSES_PER_HAND; index += 1) {
    pulses.push(createPulse());
  }

  const hand: HandVisual = {
    key: null,
    mode: "tracked",
    present: false,
    presence: 0,
    trackedTime: 0,
    x: 0,
    y: 0,
    z: 0,
    placed: false,
    emphasis: 0,
    near: 0,
    ringRadius: config.radius.tracked,
    ringOpacity: 0,
    glowOpacity: 0,
    color: createRgb(),
    pulses,
    spawnTimer: 0,
  };

  copyColor(config.colors.tracked, hand.color);
  return hand;
}

function resetHand(hand: HandVisual, config: HandFeedbackConfig): void {
  hand.key = null;
  hand.mode = "tracked";
  hand.present = false;
  hand.presence = 0;
  hand.trackedTime = 0;
  hand.placed = false;
  hand.emphasis = 0;
  hand.near = 0;
  hand.ringRadius = config.radius.tracked;
  hand.ringOpacity = 0;
  hand.glowOpacity = 0;
  hand.spawnTimer = 0;
  copyColor(config.colors.tracked, hand.color);

  for (const pulse of hand.pulses) {
    pulse.active = false;
  }
}

export function createHandFeedbackState(
  config: HandFeedbackConfig = handFeedbackConfig,
): HandFeedbackState {
  const hands: HandVisual[] = [];
  for (let index = 0; index < HAND_SLOTS; index += 1) {
    hands.push(createHand(config));
  }

  const two: TwoHandVisual = {
    presence: 0,
    ax: 0,
    ay: 0,
    bx: 0,
    by: 0,
    mx: 0,
    my: 0,
    radius: 0,
    angle: 0,
    activity: 0,
    limit: 0,
    lineOpacity: 0,
    ringOpacity: 0,
    color: createRgb(),
    previousDistance: 0,
    previousAngle: 0,
    previousValid: false,
  };
  copyColor(config.colors.grab, two.color);

  return { config, hands, two, time: 0, reducedMotion: false };
}

export function setHandFeedbackReducedMotion(
  state: HandFeedbackState,
  reduced: boolean,
): void {
  state.reducedMotion = reduced;

  if (reduced) {
    for (const hand of state.hands) {
      for (const pulse of hand.pulses) {
        pulse.active = false;
      }
    }
  }
}

/** Removes every indicator at once (unmount, camera card closed for good). */
export function resetHandFeedback(state: HandFeedbackState): void {
  for (const hand of state.hands) {
    resetHand(hand, state.config);
  }

  const { two } = state;
  two.presence = 0;
  two.activity = 0;
  two.limit = 0;
  two.lineOpacity = 0;
  two.ringOpacity = 0;
  two.previousValid = false;
}

/* ---------- small helpers ---------- */

function copyColor(from: Rgb, to: Rgb): void {
  to.r = from.r;
  to.g = from.g;
  to.b = from.b;
}

/** Exponential approach: the share of the gap closed in `step` seconds at `rate`. */
function approach(current: number, target: number, rate: number, step: number): number {
  if (step <= 0) {
    return current;
  }

  return current + (target - current) * (1 - Math.exp(-rate * step));
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  return angle - turn * Math.round(angle / turn);
}

function findHand(state: HandFeedbackState, key: string | null): HandVisual | null {
  if (key === null) {
    return null;
  }

  for (const hand of state.hands) {
    if (hand.key === key) {
      return hand;
    }
  }

  return null;
}

function claimHand(state: HandFeedbackState, key: string): HandVisual | null {
  const existing = findHand(state, key);

  if (existing !== null) {
    return existing;
  }

  for (const hand of state.hands) {
    if (hand.key === null) {
      hand.key = key;
      return hand;
    }
  }

  return null;
}

function spawnPulse(
  state: HandFeedbackState,
  hand: HandVisual,
  kind: PulseKind,
  strength: number,
): void {
  if (state.reducedMotion) {
    return;
  }

  let slot: Pulse | null = null;
  let oldest = -1;

  for (const pulse of hand.pulses) {
    if (!pulse.active) {
      slot = pulse;
      break;
    }

    if (pulse.age > oldest) {
      oldest = pulse.age;
      slot = pulse;
    }
  }

  if (slot === null) {
    return;
  }

  slot.active = true;
  slot.kind = kind;
  slot.age = 0;
  slot.duration = state.config.pulses[kind].duration;
  slot.strength = clamp01(strength);
}

/* ---------- pulse shapes ---------- */

export type PulseSample = { radius: number; opacity: number };

/**
 * Where a pulse is and how visible it is, for the renderer.
 *
 * - burst / release / ready / repel expand outward (ease-out: fast, then
 *   settling) and fade as they go. A repel pulse also fades in over its first
 *   moments so it does not pop.
 * - attract runs the other way: it starts large and faint, and contracts with
 *   acceleration (ease-in) toward the hand, fading out as it arrives. Moving
 *   inward and speeding up is what tells it apart from the repel pulse.
 */
export function samplePulse(
  config: HandFeedbackConfig,
  pulse: Pulse,
  out: PulseSample,
): PulseSample {
  const shape = config.pulses[pulse.kind];
  const t = clamp01(pulse.duration > 0 ? pulse.age / pulse.duration : 1);

  if (pulse.kind === "attract") {
    const fadeIn = clamp01(t / 0.2);
    const fadeOut = 1 - clamp01((t - 0.75) / 0.25);

    out.radius = shape.from + (shape.to - shape.from) * t * t;
    out.opacity = shape.opacity * pulse.strength * fadeIn * fadeOut;
    return out;
  }

  const inverse = 1 - t;
  const eased = 1 - inverse * inverse * inverse;
  const fadeIn = pulse.kind === "repel" ? clamp01(t / 0.12) : 1;

  out.radius = shape.from + (shape.to - shape.from) * eased;
  out.opacity =
    shape.opacity * pulse.strength * fadeIn * Math.pow(inverse, 1.5);
  return out;
}

/* ---------- the step ---------- */

function pinchTracker(grab: GrabState, key: string) {
  for (const tracker of grab.trackers) {
    if (tracker.key === key) {
      return tracker;
    }
  }

  return null;
}

function isHolding(grab: GrabState, two: TwoHandState, key: string): boolean {
  return (
    (grab.phase === "grabbing" && grab.grabKey === key) ||
    (two.phase === "active" && (two.keyA === key || two.keyB === key))
  );
}

function forceFor(forces: GestureForceState, key: string) {
  for (let index = 0; index < forces.count; index += 1) {
    if (forces.forces[index].key === key) {
      return forces.forces[index];
    }
  }

  return null;
}

/**
 * Advances every indicator by one frame.
 *
 * `grab`, `two`, `forces` and `formationSwitch` are already stepped for this
 * frame; `samples` is the interaction source; `origin` is where the formation
 * sits (to tell when a hand is within reach of it).
 */
export function stepHandFeedback(
  state: HandFeedbackState,
  samples: readonly HandInteractionSample[],
  grab: GrabState,
  two: TwoHandState,
  forces: GestureForceState,
  origin: { x: number; y: number },
  delta: number,
  formationSwitch: FormationSwitchState | null = null,
): void {
  const { config } = state;
  const step = Math.min(
    Number.isFinite(delta) && delta > 0 ? delta : 0,
    config.maxStepSeconds,
  );

  state.time += step;

  for (const hand of state.hands) {
    hand.present = false;
  }

  for (const sample of samples) {
    if (!sample.valid) {
      continue;
    }

    const hand = claimHand(state, sample.key);

    if (hand === null || hand.present) {
      continue;
    }

    hand.present = true;
    stepPresentHand(
      state,
      hand,
      sample,
      grab,
      two,
      forces,
      origin,
      step,
      formationSwitch,
    );
  }

  for (const hand of state.hands) {
    if (hand.key === null) {
      continue;
    }

    if (!hand.present) {
      stepAbsentHand(state, hand, step);
    }

    advancePulses(hand, step);

    if (!hand.present && hand.presence <= 0.001 && !hasActivePulse(hand)) {
      resetHand(hand, config);
    }
  }

  stepTwoHand(state, two, step);
}

function hasActivePulse(hand: HandVisual): boolean {
  for (const pulse of hand.pulses) {
    if (pulse.active) {
      return true;
    }
  }

  return false;
}

function advancePulses(hand: HandVisual, step: number): void {
  for (const pulse of hand.pulses) {
    if (!pulse.active) {
      continue;
    }

    pulse.age += step;

    if (pulse.age >= pulse.duration) {
      pulse.active = false;
    }
  }
}

function setMode(
  state: HandFeedbackState,
  hand: HandVisual,
  mode: HandVisualMode,
): void {
  const previous = hand.mode;

  if (previous === mode) {
    return;
  }

  hand.mode = mode;

  if (mode === "grab") {
    spawnPulse(state, hand, "burst", 1);
  } else if (previous === "grab") {
    // Letting go: a softer, wider ripple than the grab burst.
    spawnPulse(state, hand, "release", 1);
  } else if (
    (previous === "repel" || previous === "attract" || previous === "v_sign") &&
    mode !== previous &&
    mode !== "repel" &&
    mode !== "attract" &&
    mode !== "v_sign"
  ) {
    // Force or V-sign ended: a soft release so cancellation is visible.
    spawnPulse(state, hand, "release", 0.55);
  } else if (mode === "ready" && previous === "tracked") {
    spawnPulse(state, hand, "ready", 1);
  }

  if (mode === "repel" || mode === "attract") {
    // First pulse right away, then on the timer.
    hand.spawnTimer = 0;
  }
}

/**
 * V-sign feedback follows the switcher state, not the raw classifier, so a
 * brief landmark flicker during the hold grace does not drop the charge ring.
 */
function switchingGesture(
  sample: HandInteractionSample,
  formationSwitch: FormationSwitchState | null,
): { active: boolean; progress: number; confirming: boolean } {
  if (formationSwitch === null) {
    return { active: false, progress: 0, confirming: false };
  }

  const charging =
    formationSwitch.phase === "holding" || formationSwitch.phase === "fired";

  if (!charging) {
    return { active: false, progress: 0, confirming: false };
  }

  const mine =
    sample.key === formationSwitch.activeKey || sample.gesture === "v_sign";

  if (!mine) {
    return { active: false, progress: 0, confirming: false };
  }

  return {
    active: true,
    progress: formationSwitch.progress,
    confirming: formationSwitch.fired || formationSwitch.phase === "fired",
  };
}

function stepPresentHand(
  state: HandFeedbackState,
  hand: HandVisual,
  sample: HandInteractionSample,
  grab: GrabState,
  two: TwoHandState,
  forces: GestureForceState,
  origin: { x: number; y: number },
  step: number,
  formationSwitch: FormationSwitchState | null,
): void {
  const { config } = state;
  const key = sample.key;

  hand.trackedTime += step;

  const holding = isHolding(grab, two, key);
  const tracker = pinchTracker(grab, key);
  const pinching = !holding && tracker !== null && tracker.closed;
  const switching = switchingGesture(sample, formationSwitch);
  const force =
    holding || pinching || switching.active ? null : forceFor(forces, key);

  let mode: HandVisualMode;
  let emphasis: number;

  if (holding) {
    mode = "grab";
    emphasis = 1;
  } else if (pinching) {
    mode = "pinch";
    // A pinch within reach of the formation "charges" toward the grab.
    const charging =
      grab.phase === "candidate" && grab.candidateKey === key
        ? clamp01(grab.candidateFrames / Math.max(1, grab.config.startFrames))
        : 0;
    emphasis = 0.65 + 0.3 * charging;
  } else if (switching.active) {
    mode = "v_sign";
    emphasis = 0.35 + 0.65 * switching.progress;
  } else if (force !== null) {
    mode = force.kind;
    emphasis = force.strength;
  } else if (hand.trackedTime >= config.readySeconds) {
    mode = "ready";
    emphasis = 0.35;
  } else {
    mode = "tracked";
    emphasis = 0.15;
  }

  setMode(state, hand, mode);

  // One confirmation ripple on the frame the formation advances.
  if (mode === "v_sign" && formationSwitch !== null && formationSwitch.fired) {
    spawnPulse(state, hand, "switch", 1);
  }

  // Pinches and grabs sit at the fingertips; everything else at the palm.
  const atFingers = mode === "grab" || mode === "pinch";
  const source = atFingers || !sample.palmValid ? sample.pinchPoint : sample.palmPoint;

  if (!hand.placed) {
    hand.x = source.x;
    hand.y = source.y;
    hand.z = source.z;
    hand.placed = true;
  } else {
    hand.x = approach(hand.x, source.x, config.anchorSmoothing, step);
    hand.y = approach(hand.y, source.y, config.anchorSmoothing, step);
    hand.z = approach(hand.z, source.z, config.anchorSmoothing, step);
  }

  hand.presence = clamp01(hand.presence + config.fadeInRate * step);

  const dx = hand.x - origin.x;
  const dy = hand.y - origin.y;
  const reach = grab.config.grabRadius;
  const inReach = mode === "ready" || mode === "tracked"
    ? dx * dx + dy * dy <= reach * reach
    : false;

  hand.near = approach(hand.near, inReach ? 1 : 0, config.nearSmoothing, step);
  hand.emphasis = approach(hand.emphasis, emphasis, config.shapeSmoothing, step);

  styleHand(state, hand, mode, step);
  stepPeriodicPulses(state, hand, mode, step);
}

function stepAbsentHand(state: HandFeedbackState, hand: HandVisual, step: number): void {
  const { config } = state;

  // The hand is gone: whatever it was doing ends, and it fades where it was.
  hand.trackedTime = 0;
  setMode(state, hand, "tracked");
  hand.presence = Math.max(0, hand.presence - config.fadeOutRate * step);
  hand.emphasis = approach(hand.emphasis, 0, config.shapeSmoothing, step);
  hand.near = approach(hand.near, 0, config.nearSmoothing, step);
  hand.spawnTimer = 0;
  styleHand(state, hand, "tracked", step);
}

/** Eases the ring, glow, and colour toward what the mode calls for. */
function styleHand(
  state: HandFeedbackState,
  hand: HandVisual,
  mode: HandVisualMode,
  step: number,
): void {
  const { config } = state;
  const resting = mode === "ready" || mode === "tracked";

  let radius = config.radius[mode];
  let opacity = config.ringOpacity[mode];

  if (resting) {
    radius += config.radius.near * hand.near;
    opacity = Math.min(1, opacity * (1 + 0.4 * hand.near));
  } else if (mode === "repel" || mode === "attract" || mode === "v_sign") {
    // Charge and force strength both grow the ring a little.
    radius *= 0.8 + 0.2 * hand.emphasis;
  } else if (mode === "grab" && !state.reducedMotion) {
    // A slow breath keeps the holding ring alive without being busy.
    radius *=
      1 +
      config.breathDepth *
        Math.sin(Math.PI * 2 * config.breathHz * state.time);
  }

  hand.ringRadius = approach(hand.ringRadius, radius, config.shapeSmoothing, step);
  hand.ringOpacity = approach(hand.ringOpacity, opacity, config.shapeSmoothing, step);
  hand.glowOpacity = approach(
    hand.glowOpacity,
    config.glowOpacity[mode] * (resting ? 1 + 0.6 * hand.near : hand.emphasis),
    config.shapeSmoothing,
    step,
  );

  const target = config.colors[mode];
  hand.color.r = approach(hand.color.r, target.r, config.colorSmoothing, step);
  hand.color.g = approach(hand.color.g, target.g, config.colorSmoothing, step);
  hand.color.b = approach(hand.color.b, target.b, config.colorSmoothing, step);
}

function stepPeriodicPulses(
  state: HandFeedbackState,
  hand: HandVisual,
  mode: HandVisualMode,
  step: number,
): void {
  const { config } = state;

  if (
    state.reducedMotion ||
    (mode !== "repel" && mode !== "attract") ||
    hand.emphasis < config.pulseMinEmphasis
  ) {
    // Not pulsing: the next pulse starts at once when a force begins.
    if (mode !== "repel" && mode !== "attract") {
      hand.spawnTimer = 0;
    }
    return;
  }

  hand.spawnTimer -= step;

  if (hand.spawnTimer > 0) {
    return;
  }

  spawnPulse(state, hand, mode, hand.emphasis);

  // A stronger force pulses a little faster.
  const interval = mode === "repel" ? config.repelInterval : config.attractInterval;
  hand.spawnTimer += interval / (0.6 + 0.4 * hand.emphasis);
}

function stepTwoHand(state: HandFeedbackState, two: TwoHandState, step: number): void {
  const { config } = state;
  const visual = state.two;
  const settings = config.twoHand;
  const handA = two.phase === "active" ? findHand(state, two.keyA) : null;
  const handB = two.phase === "active" ? findHand(state, two.keyB) : null;
  const active = handA !== null && handB !== null && handA.placed && handB.placed;

  if (active) {
    visual.ax = handA.x;
    visual.ay = handA.y;
    visual.bx = handB.x;
    visual.by = handB.y;
    visual.mx = (handA.x + handB.x) / 2;
    visual.my = (handA.y + handB.y) / 2;

    const dx = handB.x - handA.x;
    const dy = handB.y - handA.y;
    const distance = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);

    visual.radius = distance / 2;
    visual.angle = angle;

    // How fast the transform is changing: relative change in scale (distance)
    // plus turning rate. This makes the overlay answer to the gesture.
    let activity = 0;

    if (visual.previousValid && step > 0) {
      const scaleRate =
        Math.abs(distance - visual.previousDistance) /
        Math.max(distance, 0.5) /
        step;
      const turnRate = Math.abs(wrapAngle(angle - visual.previousAngle)) / step;

      activity = clamp01(
        scaleRate * settings.scaleGain + turnRate * settings.angleGain,
      );
    }

    visual.previousDistance = distance;
    visual.previousAngle = angle;
    visual.previousValid = true;
    visual.activity = approach(visual.activity, activity, settings.activitySmoothing, step);

    const atLimit =
      two.desired.scale <= two.config.minScale + 0.01 ||
      two.desired.scale >= two.config.maxScale - 0.01;

    visual.limit = approach(visual.limit, atLimit ? 1 : 0, settings.limitSmoothing, step);
    visual.presence = clamp01(visual.presence + settings.fadeInRate * step);
  } else {
    visual.previousValid = false;
    visual.activity = approach(visual.activity, 0, settings.activitySmoothing, step);
    visual.limit = approach(visual.limit, 0, settings.limitSmoothing, step);
    visual.presence = Math.max(0, visual.presence - settings.fadeOutRate * step);
  }

  const glow = settings.activityBoost * visual.activity;

  visual.lineOpacity = visual.presence * (settings.lineOpacity + glow);
  visual.ringOpacity = visual.presence * (settings.ringOpacity + glow);

  // The overlay is the grab colour, warming toward amber while pinned at a limit.
  const grab = config.colors.grab;
  const warm = config.colors.limit;

  visual.color.r = grab.r + (warm.r - grab.r) * visual.limit;
  visual.color.g = grab.g + (warm.g - grab.g) * visual.limit;
  visual.color.b = grab.b + (warm.b - grab.b) * visual.limit;
}
