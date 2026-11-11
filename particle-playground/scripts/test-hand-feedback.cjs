/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS script */
"use strict";

/**
 * Tests for the hand visual feedback state (Milestone 17B.6): readiness,
 * pinch / grab / release, open-palm and fist cues, two-hand overlay, smoothing,
 * fades, pooling (no allocation), reduced motion, and that it all follows the
 * real grab controller without changing it.
 *
 * Same approach as the other scripts: transpile the TypeScript modules with
 * the installed `typescript` package into a temp folder, rewrite "@/" imports,
 * and run plain assertions.
 *
 * Run from the app folder:  node scripts/test-hand-feedback.cjs
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
process.env.NODE_PATH = path.join(root, "node_modules");
Module._initPaths();

const ts = require(path.join(root, "node_modules", "typescript"));
const THREE = require("three");

const MODULES = [
  "src/lib/grab-config.ts",
  "src/lib/grab-pinch.ts",
  "src/lib/grab-interaction.ts",
  "src/lib/formations.ts",
  "src/lib/grab-motion.ts",
  "src/lib/formation-extents.ts",
  "src/lib/group-space.ts",
  "src/lib/two-hand-config.ts",
  "src/lib/two-hand-transform.ts",
  "src/lib/gesture-force-config.ts",
  "src/lib/gesture-forces.ts",
  "src/lib/gesture-force-field.ts",
  "src/lib/hand-feedback-config.ts",
  "src/lib/hand-feedback.ts",
  "src/lib/grab-controller.ts",
];

const out = fs.mkdtempSync(path.join(os.tmpdir(), "hand-feedback-"));

function rewriteImports(source, file) {
  const fileDir = path.posix.dirname(file);
  return source.replace(/from\s+["'](@\/[^"']+)["']/g, (_match, spec) => {
    let relative = path.posix.relative(fileDir, spec.replace("@/", "src/"));
    if (!relative.startsWith(".")) {
      relative = `./${relative}`;
    }
    return `from "${relative}"`;
  });
}

for (const file of MODULES) {
  const sourcePath = path.join(root, file);
  const source = rewriteImports(fs.readFileSync(sourcePath, "utf8"), file);
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: sourcePath,
  }).outputText;
  const destination = path.join(out, file.replace(/\.ts$/, ".js"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, compiled);
}

const load = (name) => require(path.join(out, `src/lib/${name}.js`));
const { grabConfig } = load("grab-config");
const { createGrabState } = load("grab-interaction");
const { createTwoHandState } = load("two-hand-transform");
const {
  createGestureForceState,
  stepGestureForces,
} = load("gesture-forces");
const { gestureForceConfig } = load("gesture-force-config");
const { handFeedbackConfig } = load("hand-feedback-config");
const {
  createHandFeedbackState,
  stepHandFeedback,
  setHandFeedbackReducedMotion,
  resetHandFeedback,
  samplePulse,
} = load("hand-feedback");
const {
  createGrabController,
  createGrabView,
  stepGrabController,
} = load("grab-controller");

const results = [];

function test(name, body) {
  try {
    body();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}

function near(actual, expected, label, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${label ?? "value"}: expected ${expected}, got ${actual}`,
  );
}

/* ---------- fixtures ---------- */

const DT = 1 / 60;
const ORIGIN = { x: 0, y: 0 };

function sample(key, x, y, gesture = "none", ratio = 0.8, extra = {}) {
  return {
    key,
    handedness: key === "Left" || key === "Right" ? key : null,
    pinchPoint: { x, y, z: 0 },
    palmPoint: { x: x + 0.3, y: y - 0.3, z: 0 },
    pinchRatio: ratio,
    valid: true,
    gesture,
    palmValid: true,
    ...extra,
  };
}

function rig() {
  return {
    feedback: createHandFeedbackState(),
    grab: createGrabState(),
    two: createTwoHandState(),
    forces: createGestureForceState(),
  };
}

/** Steps the force state, then the feedback, like the controller does. */
function run(r, samples, frames, origin = ORIGIN) {
  for (let index = 0; index < frames; index += 1) {
    stepGestureForces(r.forces, samples, DT, []);
    stepHandFeedback(r.feedback, samples, r.grab, r.two, r.forces, origin, DT);
  }
}

function hand(r, key) {
  return r.feedback.hands.find((candidate) => candidate.key === key) ?? null;
}

function activePulses(h, kind) {
  return h.pulses.filter((pulse) => pulse.active && (!kind || pulse.kind === kind));
}

function holdGrab(r, key) {
  r.grab.phase = "grabbing";
  r.grab.grabKey = key;
}

function releaseGrab(r) {
  r.grab.phase = "idle";
  r.grab.grabKey = null;
}

/* ---------- configuration ---------- */

test("configuration: colours are valid, modes are distinct, durations positive", () => {
  const c = handFeedbackConfig;
  for (const [name, color] of Object.entries(c.colors)) {
    for (const channel of ["r", "g", "b"]) {
      assert.ok(color[channel] >= 0 && color[channel] <= 1, `${name}.${channel}`);
    }
  }
  const distance = (a, b) =>
    Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  assert.ok(distance(c.colors.repel, c.colors.attract) > 0.4, "repel vs attract hue");
  assert.ok(distance(c.colors.grab, c.colors.repel) > 0.4, "grab vs repel hue");
  assert.ok(distance(c.colors.grab, c.colors.limit) > 0.4, "grab vs limit hue");
  for (const [name, pulse] of Object.entries(c.pulses)) {
    assert.ok(pulse.duration > 0 && pulse.opacity > 0 && pulse.opacity <= 1, name);
  }
  // Repel moves outward, attract inward.
  assert.ok(c.pulses.repel.to > c.pulses.repel.from, "repel expands");
  assert.ok(c.pulses.attract.to < c.pulses.attract.from, "attract contracts");
  // Pulses stay inside the force radius.
  assert.ok(c.pulses.repel.to <= gestureForceConfig.radius);
  assert.ok(c.pulses.attract.from <= gestureForceConfig.radius);
  for (const mode of ["tracked", "ready", "pinch", "grab", "repel", "attract", "v_sign"]) {
    assert.ok(c.ringOpacity[mode] > 0 && c.ringOpacity[mode] <= 1, mode);
    assert.ok(c.glowOpacity[mode] > 0 && c.glowOpacity[mode] <= 1, mode);
  }
  // The core ring never gets large enough to cover the artwork.
  for (const mode of ["tracked", "ready", "pinch", "grab", "repel", "attract", "v_sign"]) {
    assert.ok(c.radius[mode] + c.radius.near <= 0.5, `${mode} ring size`);
  }
});

/* ---------- readiness ---------- */

test("1. a detected hand fades in as 'tracked', then becomes 'ready' without a jump", () => {
  const r = rig();
  const hands = [sample("Right", 1, 1)];

  run(r, hands, 3);
  const h = hand(r, "Right");
  assert.equal(h.mode, "tracked");
  assert.ok(h.presence > 0 && h.presence < 1, "still fading in");

  run(r, hands, 30);
  assert.equal(h.mode, "ready");
  near(h.presence, 1, "fully present");
  assert.ok(h.ringRadius > handFeedbackConfig.radius.tracked, "ready ring is larger");
  assert.ok(activePulses(h).length >= 0);
});

test("1b. 'ready' is distinct from active interaction (different mode, size, opacity)", () => {
  const r = rig();
  run(r, [sample("Right", 5, 5)], 40);
  const ready = { ...hand(r, "Right") };
  assert.equal(ready.mode, "ready");

  holdGrab(r, "Right");
  run(r, [sample("Right", 5, 5)], 40);
  const grabbing = hand(r, "Right");
  assert.equal(grabbing.mode, "grab");
  assert.ok(grabbing.ringOpacity > ready.ringOpacity + 0.3, "grab is much more visible");
  assert.ok(grabbing.ringRadius > ready.ringRadius, "grab ring is larger");
  assert.ok(grabbing.glowOpacity > ready.glowOpacity, "grab glows more");
});

test("1c. a hand near the formation is a touch more visible while idle", () => {
  const r = rig();
  run(r, [sample("Right", 0.5, 0.5)], 60);
  const nearHand = hand(r, "Right");
  assert.ok(nearHand.near > 0.95);

  const far = rig();
  run(far, [sample("Right", 9, 9)], 60);
  const farHand = hand(far, "Right");
  assert.ok(farHand.near < 0.05);
  assert.ok(nearHand.ringRadius > farHand.ringRadius);
  assert.ok(nearHand.ringOpacity > farHand.ringOpacity);
});

test("1d. 'ready' fires one soft ripple and does not repeat", () => {
  const r = rig();
  const hands = [sample("Right", 1, 1)];
  let readyPulses = 0;
  for (let index = 0; index < 120; index += 1) {
    run(r, hands, 1);
    const h = hand(r, "Right");
    if (h.pulses.some((pulse) => pulse.active && pulse.kind === "ready" && pulse.age <= DT * 1.01)) {
      readyPulses += 1;
    }
  }
  assert.equal(readyPulses, 1);
});

/* ---------- smoothness ---------- */

test("2. the anchor follows smoothly: a tracking glitch does not jump the indicator", () => {
  const r = rig();
  run(r, [sample("Right", 0, 0)], 30);
  const h = hand(r, "Right");
  const before = h.x;

  run(r, [sample("Right", 4, 0)], 1);
  const afterOne = h.x;
  assert.ok(afterOne - before < 4 * 0.5, `moved ${afterOne - before} in a frame`);
  assert.ok(afterOne > before, "but it does head there");

  run(r, [sample("Right", 4, 0)], 60);
  near(h.x, 4.3, "arrives at the palm", 0.01);
});

test("2b. jitter is attenuated (smaller than the input noise)", () => {
  const r = rig();
  run(r, [sample("Right", 0, 0)], 30);
  const h = hand(r, "Right");
  let low = Infinity;
  let high = -Infinity;
  for (let index = 0; index < 120; index += 1) {
    const noise = index % 2 === 0 ? 0.1 : -0.1;
    run(r, [sample("Right", noise, 0)], 1);
    if (index > 30) {
      low = Math.min(low, h.x);
      high = Math.max(high, h.x);
    }
  }
  assert.ok(high - low < 0.2 * 0.5, `output spread ${high - low} vs input 0.2`);
});

test("2c. the first sample places the indicator exactly (no sweep from the origin)", () => {
  const r = rig();
  run(r, [sample("Right", 6, -3)], 1);
  const h = hand(r, "Right");
  near(h.x, 6.3, "x (palm)");
  near(h.y, -3.3, "y (palm)");
});

test("2d. ready sits at the palm, pinch/grab at the fingertips", () => {
  const r = rig();
  run(r, [sample("Right", 0, 0)], 60);
  const h = hand(r, "Right");
  near(h.x, 0.3, "palm x", 0.01);

  holdGrab(r, "Right");
  run(r, [sample("Right", 0, 0)], 60);
  near(h.x, 0, "fingertip x", 0.01);
});

test("2e. a hand without a palm anchor falls back to the pinch point", () => {
  const r = rig();
  run(r, [sample("Right", 2, 2, "none", 0.8, { palmValid: false })], 30);
  const h = hand(r, "Right");
  near(h.x, 2, "x");
  near(h.y, 2, "y");
});

/* ---------- pinch & grab ---------- */

test("3. pinch, grab, and release each read differently", () => {
  const r = rig();
  const open = [sample("Right", 0.5, 0.5)];

  run(r, open, 40);
  const h = hand(r, "Right");
  assert.equal(h.mode, "ready");

  // A pinch that has not started a grab yet.
  r.grab.trackers[0].key = "Right";
  r.grab.trackers[0].closed = true;
  run(r, open, 20);
  assert.equal(h.mode, "pinch");
  assert.ok(h.ringOpacity > handFeedbackConfig.ringOpacity.ready);

  // The grab starts: a burst pulse.
  holdGrab(r, "Right");
  run(r, open, 1);
  assert.equal(h.mode, "grab");
  assert.equal(activePulses(h, "burst").length, 1, "burst on grab");

  run(r, open, 40);
  assert.equal(activePulses(h, "burst").length, 0, "burst is short-lived");
  assert.ok(h.ringOpacity > 0.9 * handFeedbackConfig.ringOpacity.grab);

  // Release: a softer, wider ripple, and the ring settles back to ready.
  releaseGrab(r);
  r.grab.trackers[0].closed = false;
  run(r, open, 1);
  assert.notEqual(h.mode, "grab");
  assert.equal(activePulses(h, "release").length, 1, "release ripple");
  const shape = handFeedbackConfig.pulses;
  assert.ok(shape.release.to > shape.burst.to, "release ripple is wider");
  assert.ok(shape.release.opacity < shape.burst.opacity, "and softer");

  run(r, open, 40);
  assert.equal(h.mode, "ready");
  assert.equal(activePulses(h, "release").length, 0);
});

test("3b. a pinch within reach 'charges' toward the grab", () => {
  const r = rig();
  const open = [sample("Right", 0, 0)];
  run(r, open, 40);

  r.grab.trackers[0].key = "Right";
  r.grab.trackers[0].closed = true;
  r.grab.phase = "candidate";
  r.grab.candidateKey = "Right";
  r.grab.candidateFrames = 0;
  run(r, open, 30);
  const early = hand(r, "Right").emphasis;

  r.grab.candidateFrames = r.grab.config.startFrames;
  run(r, open, 30);
  assert.ok(hand(r, "Right").emphasis > early, "more emphatic when about to grab");
});

test("3c. two-hand overlay appears only for a two-hand transform; grab ring on both hands", () => {
  const r = rig();
  const both = [sample("Left", -2, 0), sample("Right", 2, 0)];
  run(r, both, 40);
  near(r.feedback.two.presence, 0, "no overlay yet");

  r.two.phase = "active";
  r.two.keyA = "Left";
  r.two.keyB = "Right";
  r.two.desired.scale = 1;
  run(r, both, 40);
  assert.equal(hand(r, "Left").mode, "grab");
  assert.equal(hand(r, "Right").mode, "grab");
  near(r.feedback.two.presence, 1, "overlay present");
  assert.ok(r.feedback.two.lineOpacity > 0);
  near(r.feedback.two.radius, 2, "half the hand distance", 0.01);
});

/* ---------- gestures ---------- */

test("4. open palm: repel mode, outward pulses, repeating while held", () => {
  const r = rig();
  const palm = [sample("Right", 0, 0, "open_palm")];
  run(r, palm, 40);
  const h = hand(r, "Right");
  assert.equal(h.mode, "repel");
  near(h.color.r, handFeedbackConfig.colors.repel.r, "repel colour", 0.05);

  let spawned = 0;
  let previousActive = activePulses(h, "repel").length;
  for (let index = 0; index < 180; index += 1) {
    run(r, palm, 1);
    const count = activePulses(h, "repel").filter((pulse) => pulse.age <= DT * 1.01).length;
    spawned += count;
    previousActive = activePulses(h, "repel").length;
  }
  assert.ok(previousActive <= h.pulses.length);
  assert.ok(spawned >= 4 && spawned <= 7, `${spawned} pulses in 3 s`);

  // Outward: radius grows over a pulse's life.
  const out = { radius: 0, opacity: 0 };
  const pulse = { active: true, kind: "repel", age: 0, duration: 0.75, strength: 1 };
  const radii = [];
  for (let age = 0; age <= 0.75; age += 0.05) {
    pulse.age = age;
    radii.push(samplePulse(handFeedbackConfig, pulse, out).radius);
  }
  for (let index = 1; index < radii.length; index += 1) {
    assert.ok(radii[index] >= radii[index - 1], "monotonic outward");
  }
});

test("5. fist: attract mode, inward pulses, clearly different from repel", () => {
  const r = rig();
  run(r, [sample("Right", 0, 0, "closed_fist")], 40);
  const h = hand(r, "Right");
  assert.equal(h.mode, "attract");
  near(h.color.r, handFeedbackConfig.colors.attract.r, "attract colour", 0.05);
  near(h.color.g, handFeedbackConfig.colors.attract.g, "attract colour", 0.05);
  assert.ok(activePulses(h, "attract").length >= 1);

  const out = { radius: 0, opacity: 0 };
  const pulse = { active: true, kind: "attract", age: 0, duration: 0.85, strength: 1 };
  const radii = [];
  const opacities = [];
  for (let step = 0; step <= 17; step += 1) {
    pulse.age = (step / 17) * 0.85;
    const value = samplePulse(handFeedbackConfig, pulse, out);
    radii.push(value.radius);
    opacities.push(value.opacity);
  }
  for (let index = 1; index < radii.length; index += 1) {
    assert.ok(radii[index] <= radii[index - 1] + 1e-9, "monotonic inward");
  }
  // Contraction accelerates (ease-in): the last step is larger than the first.
  assert.ok(
    radii[radii.length - 2] - radii[radii.length - 1] >
      radii[0] - radii[1],
    "accelerates inward",
  );
  assert.ok(opacities[0] < 0.05 && opacities[opacities.length - 1] < 0.05, "fades in and out");

  // The two gestures differ in direction, colour, and cadence.
  const c = handFeedbackConfig;
  assert.ok(c.pulses.repel.to > c.pulses.repel.from);
  assert.ok(c.pulses.attract.to < c.pulses.attract.from);
  assert.notEqual(c.repelInterval, c.attractInterval);
});

test("5b. a force fading in or out shows no pulses (strength below threshold)", () => {
  const r = rig();
  const palm = [sample("Right", 0, 0, "open_palm")];
  run(r, palm, 8);
  const h = hand(r, "Right");
  if (h.mode === "repel") {
    assert.ok(h.emphasis <= handFeedbackConfig.pulseMinEmphasis + 0.4);
  }
  run(r, palm, 60);
  assert.equal(h.mode, "repel");
});

test("5c. pinch priority: a pinching or holding hand shows the pinch cues, not the force", () => {
  const r = rig();
  const palm = [sample("Right", 0, 0, "open_palm")];
  run(r, palm, 40);
  assert.equal(hand(r, "Right").mode, "repel");

  r.grab.trackers[0].key = "Right";
  r.grab.trackers[0].closed = true;
  run(r, palm, 2);
  assert.equal(hand(r, "Right").mode, "pinch");

  holdGrab(r, "Right");
  run(r, palm, 2);
  assert.equal(hand(r, "Right").mode, "grab");
});

test("5d. the visual follows the real force state (a gesture that is not acting shows nothing)", () => {
  const r = rig();
  // A single frame of open palm: not confirmed yet, so there is no force.
  run(r, [sample("Right", 0, 0, "open_palm")], 2);
  assert.equal(r.forces.count, 0);
  assert.notEqual(hand(r, "Right").mode, "repel");
});

/* ---------- two-hand overlay ---------- */

function twoHandRig() {
  const r = rig();
  r.two.phase = "active";
  r.two.keyA = "Left";
  r.two.keyB = "Right";
  r.two.desired.scale = 1;
  return r;
}

test("6. overlay activity rises when hands move apart or rotate, and settles when still", () => {
  const r = twoHandRig();
  run(r, [sample("Left", -2, 0), sample("Right", 2, 0)], 60);
  const still = r.feedback.two.activity;
  assert.ok(still < 0.02, `still ${still}`);

  // Spread: distance grows from 4 to 8 over a second.
  let peak = 0;
  for (let index = 0; index < 60; index += 1) {
    const half = 2 + (index / 60) * 2;
    run(r, [sample("Left", -half, 0), sample("Right", half, 0)], 1);
    peak = Math.max(peak, r.feedback.two.activity);
  }
  assert.ok(peak > 0.1, `spread activity ${peak}`);

  run(r, [sample("Left", -4, 0), sample("Right", 4, 0)], 90);
  assert.ok(r.feedback.two.activity < 0.02, "settles");

  // Rotate.
  let rotatePeak = 0;
  for (let index = 0; index < 60; index += 1) {
    const angle = (index / 60) * 1.2;
    run(
      r,
      [
        sample("Left", -3 * Math.cos(angle), -3 * Math.sin(angle)),
        sample("Right", 3 * Math.cos(angle), 3 * Math.sin(angle)),
      ],
      1,
    );
    rotatePeak = Math.max(rotatePeak, r.feedback.two.activity);
  }
  assert.ok(rotatePeak > 0.05, `rotation activity ${rotatePeak}`);
});

test("6b. overlay stays subtle: opacity is bounded well below 1", () => {
  const r = twoHandRig();
  for (let index = 0; index < 120; index += 1) {
    const half = 2 + Math.sin(index / 5) * 1.5;
    run(r, [sample("Left", -half, 0), sample("Right", half, 0)], 1);
    assert.ok(r.feedback.two.lineOpacity <= 0.5);
    assert.ok(r.feedback.two.ringOpacity <= 0.5);
  }
});

test("6c. at a scale limit the overlay warms toward the limit colour", () => {
  const r = twoHandRig();
  run(r, [sample("Left", -2, 0), sample("Right", 2, 0)], 40);
  const normal = { ...r.feedback.two.color };
  r.two.desired.scale = r.two.config.maxScale;
  run(r, [sample("Left", -2, 0), sample("Right", 2, 0)], 60);
  const limited = r.feedback.two.color;
  assert.ok(r.feedback.two.limit > 0.95);
  assert.ok(limited.r > normal.r, "warmer");
  assert.ok(limited.b < normal.b, "less blue");

  r.two.desired.scale = 1;
  run(r, [sample("Left", -2, 0), sample("Right", 2, 0)], 90);
  assert.ok(r.feedback.two.limit < 0.05, "returns to normal");
});

test("6d. the overlay fades out when the transform ends, then is fully gone", () => {
  const r = twoHandRig();
  const both = [sample("Left", -2, 0), sample("Right", 2, 0)];
  run(r, both, 40);
  near(r.feedback.two.presence, 1, "present");

  r.two.phase = "inactive";
  run(r, both, 2);
  assert.ok(r.feedback.two.presence < 1, "starting to fade");
  assert.ok(r.feedback.two.presence > 0, "not instant");
  run(r, both, 60);
  near(r.feedback.two.presence, 0, "gone");
  near(r.feedback.two.lineOpacity, 0, "line gone");
  assert.equal(r.feedback.two.previousValid, false);
});

/* ---------- lifecycle ---------- */

test("7. a hand that leaves fades out and its slot is freed; no stuck indicator", () => {
  const r = rig();
  run(r, [sample("Right", 1, 1)], 40);
  assert.equal(hand(r, "Right").mode, "ready");

  run(r, [], 1);
  const h = hand(r, "Right");
  assert.ok(h.presence > 0 && h.presence < 1, "fading");
  assert.equal(h.present, false);

  run(r, [], 60);
  assert.equal(hand(r, "Right"), null, "slot released");
  assert.equal(r.feedback.hands.filter((candidate) => candidate.presence > 0).length, 0);
});

test("7b. losing the hand mid-grab ripples out, then everything clears", () => {
  const r = rig();
  const hands = [sample("Right", 1, 1)];
  holdGrab(r, "Right");
  run(r, hands, 40);
  const h = hand(r, "Right");
  assert.equal(h.mode, "grab");

  releaseGrab(r);
  run(r, [], 1);
  assert.equal(activePulses(h, "release").length, 1);

  run(r, [], 90);
  assert.equal(hand(r, "Right"), null);
  for (const candidate of r.feedback.hands) {
    assert.equal(activePulses(candidate).length, 0);
  }
});

test("7c. an invalid sample counts as not present", () => {
  const r = rig();
  run(r, [sample("Right", 1, 1)], 40);
  run(r, [sample("Right", 1, 1, "none", 0.8, { valid: false })], 60);
  assert.equal(hand(r, "Right"), null);
});

test("7d. re-detection reuses the slot and does not replay the fade-in from nothing", () => {
  const r = rig();
  run(r, [sample("Right", 1, 1)], 40);
  run(r, [], 3);
  const fading = hand(r, "Right").presence;
  run(r, [sample("Right", 1, 1)], 1);
  assert.ok(hand(r, "Right").presence > fading, "continues from where it was");
});

test("7e. resetHandFeedback clears everything at once", () => {
  const r = twoHandRig();
  run(r, [sample("Left", -2, 0, "open_palm"), sample("Right", 2, 0)], 60);
  resetHandFeedback(r.feedback);
  assert.equal(r.feedback.hands.filter((candidate) => candidate.key !== null).length, 0);
  near(r.feedback.two.presence, 0);
  near(r.feedback.two.lineOpacity, 0);
  for (const candidate of r.feedback.hands) {
    assert.equal(activePulses(candidate).length, 0);
  }
});

test("7f. two hands are independent (left repels while right grabs)", () => {
  const r = rig();
  holdGrab(r, "Right");
  run(r, [sample("Left", -3, 0, "open_palm"), sample("Right", 3, 0)], 60);
  assert.equal(hand(r, "Left").mode, "repel");
  assert.equal(hand(r, "Right").mode, "grab");
});

/* ---------- robustness ---------- */

test("8. bad deltas and tiny/large frames never produce NaN or jumps", () => {
  const r = rig();
  const hands = [sample("Right", 1, 1)];
  for (const dt of [0, -1, Number.NaN, Infinity, 5, 1e-9]) {
    stepHandFeedback(r.feedback, hands, r.grab, r.two, r.forces, ORIGIN, dt);
  }
  for (const h of r.feedback.hands) {
    for (const field of ["x", "y", "presence", "ringRadius", "ringOpacity", "glowOpacity", "emphasis"]) {
      assert.ok(Number.isFinite(h[field]), field);
    }
  }
  // A 5 s frame is treated as one capped step.
  assert.ok(hand(r, "Right").presence <= 1);
});

test("8b. more hands than slots are ignored safely", () => {
  const r = rig();
  const many = [];
  for (let index = 0; index < 8; index += 1) {
    many.push(sample(`hand-${index}`, index, 0));
  }
  run(r, many, 30);
  assert.equal(r.feedback.hands.filter((candidate) => candidate.key !== null).length, r.feedback.hands.length);
});

test("8c. pulse values stay in range for every kind across its whole life", () => {
  const out = { radius: 0, opacity: 0 };
  for (const kind of ["burst", "release", "ready", "repel", "attract", "switch"]) {
    const pulse = {
      active: true,
      kind,
      age: 0,
      duration: handFeedbackConfig.pulses[kind].duration,
      strength: 1,
    };
    for (let age = -0.1; age <= pulse.duration + 0.2; age += 0.01) {
      pulse.age = age;
      const value = samplePulse(handFeedbackConfig, pulse, out);
      assert.ok(Number.isFinite(value.radius) && value.radius > 0, `${kind} radius`);
      assert.ok(value.opacity >= 0 && value.opacity <= 1, `${kind} opacity ${value.opacity}`);
    }
  }
});

test("8d. pulses are pooled: the pool never grows and the oldest is recycled", () => {
  const r = rig();
  const h0 = r.feedback.hands[0];
  const pool = h0.pulses;
  const size = pool.length;
  const palm = [sample("Right", 0, 0, "open_palm")];
  run(r, palm, 600);
  const h = hand(r, "Right");
  assert.equal(h.pulses.length, size);
  assert.ok(h.pulses.every((pulse) => pulse && typeof pulse === "object"));
});

test("8e. the state objects are reused frame to frame (no allocation)", () => {
  const r = rig();
  const hands = [sample("Right", 1, 1, "open_palm")];
  run(r, hands, 40);
  const h = hand(r, "Right");
  const color = h.color;
  const pulses = h.pulses;
  const first = pulses[0];
  const handsArray = r.feedback.hands;
  const two = r.feedback.two;
  run(r, hands, 200);
  assert.equal(hand(r, "Right"), h);
  assert.equal(h.color, color);
  assert.equal(h.pulses, pulses);
  assert.equal(h.pulses[0], first);
  assert.equal(r.feedback.hands, handsArray);
  assert.equal(r.feedback.two, two);
});

test("8f. no per-frame allocation in a long run (heap growth stays tiny)", () => {
  if (typeof global.gc !== "function") {
    return; // needs --expose-gc; the identity checks above cover reuse
  }
  const r = rig();
  const hands = [sample("Left", -2, 0, "open_palm"), sample("Right", 2, 0, "closed_fist")];
  run(r, hands, 120);
  global.gc();
  const before = process.memoryUsage().heapUsed;
  run(r, hands, 20000);
  global.gc();
  const growth = process.memoryUsage().heapUsed - before;
  assert.ok(growth < 200000, `heap grew ${growth} bytes`);
});

/* ---------- reduced motion ---------- */

test("9. reduced motion: no pulses and no breathing, but the state still shows", () => {
  const r = rig();
  setHandFeedbackReducedMotion(r.feedback, true);
  const palm = [sample("Right", 0, 0, "open_palm")];
  run(r, palm, 120);
  const h = hand(r, "Right");
  assert.equal(h.mode, "repel");
  assert.equal(activePulses(h).length, 0);

  holdGrab(r, "Right");
  run(r, palm, 2);
  assert.equal(activePulses(h).length, 0, "no grab burst");
  run(r, palm, 90);
  const sizes = [];
  for (let index = 0; index < 120; index += 1) {
    run(r, palm, 1);
    sizes.push(h.ringRadius);
  }
  assert.ok(Math.max(...sizes) - Math.min(...sizes) < 1e-3, "no breathing");
  assert.ok(h.ringOpacity > 0.8, "still clearly shown");
});

test("9b. without reduced motion the grab ring breathes subtly", () => {
  const r = rig();
  holdGrab(r, "Right");
  const hands = [sample("Right", 0, 0)];
  run(r, hands, 60);
  const sizes = [];
  for (let index = 0; index < 120; index += 1) {
    run(r, hands, 1);
    sizes.push(hand(r, "Right").ringRadius);
  }
  const spread = Math.max(...sizes) - Math.min(...sizes);
  assert.ok(spread > 0.005, `breath ${spread}`);
  assert.ok(spread < 0.2 * handFeedbackConfig.radius.grab, "but subtle");
});

/* ---------- integration with the real controller ---------- */

function pinchAt(key, x, y) {
  return sample(key, x, y, "none", 0.2);
}

test("10. following the real grab controller: grab starts, holds, and ends in the visuals", () => {
  const controller = createGrabController();
  Object.assign(controller.limits, { x: 50, y: 50, z: 0 });
  const group = new THREE.Group();
  group.updateMatrixWorld();
  const view = createGrabView();
  const feedback = createHandFeedbackState();

  function frames(samples, count) {
    for (let index = 0; index < count; index += 1) {
      stepGrabController(controller, group, samples, DT, view);
      stepHandFeedback(
        feedback,
        samples,
        controller.grab,
        controller.two,
        controller.forces,
        group.position,
        DT,
      );
    }
  }

  const find = (key) => feedback.hands.find((candidate) => candidate.key === key);

  frames([sample("Right", 0.4, 0.4)], 40);
  assert.equal(find("Right").mode, "ready");

  frames([pinchAt("Right", 0.4, 0.4)], 10);
  assert.equal(controller.grab.phase, "grabbing", "the controller grabbed");
  assert.equal(find("Right").mode, "grab", "so the visual shows a grab");

  frames([sample("Right", 0.4, 0.4)], 3);
  assert.equal(controller.grab.phase, "idle");
  assert.notEqual(find("Right").mode, "grab");

  frames([sample("Right", 0.4, 0.4, "open_palm")], 50);
  assert.equal(controller.grab.phase, "idle");
  assert.equal(find("Right").mode, "repel", "force from the real force state");
});

test("10b. feedback does not mutate the states it reads", () => {
  const controller = createGrabController();
  Object.assign(controller.limits, { x: 50, y: 50, z: 0 });
  const group = new THREE.Group();
  group.updateMatrixWorld();
  const view = createGrabView();
  const samples = [pinchAt("Right", 0.4, 0.4)];
  for (let index = 0; index < 10; index += 1) {
    stepGrabController(controller, group, samples, DT, view);
  }
  const snapshot = JSON.stringify({
    grab: { phase: controller.grab.phase, key: controller.grab.grabKey },
    two: controller.two.phase,
    forces: controller.forces.count,
    pos: group.position.toArray(),
    scale: group.scale.x,
  });

  const feedback = createHandFeedbackState();
  for (let index = 0; index < 60; index += 1) {
    stepHandFeedback(
      feedback,
      samples,
      controller.grab,
      controller.two,
      controller.forces,
      group.position,
      DT,
    );
  }

  assert.equal(
    JSON.stringify({
      grab: { phase: controller.grab.phase, key: controller.grab.grabKey },
      two: controller.two.phase,
      forces: controller.forces.count,
      pos: group.position.toArray(),
      scale: group.scale.x,
    }),
    snapshot,
  );
  assert.equal(grabConfig.grabRadius, 3);
});

/* ---------- report ---------- */

let failures = 0;

for (const result of results) {
  if (result.ok) {
    console.log(`  ok   ${result.name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${result.name}`);
    console.log(`       ${result.error && result.error.message}`);
  }
}

console.log(`\n${results.length - failures}/${results.length} passed`);

if (failures > 0) {
  process.exit(1);
}
