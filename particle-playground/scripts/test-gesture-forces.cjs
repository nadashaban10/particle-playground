/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS script */
"use strict";

/**
 * Tests for gesture-powered particle forces: open-palm repulsion, fist
 * attraction, pinch priority, stability, cleanup, world -> group conversion,
 * and the physics hook. Also drives the whole pipeline (detection -> samples
 * -> grab controller -> force field) and re-checks that grabbing and the
 * two-hand transform are unaffected.
 *
 * Same approach as the other scripts: transpile the TypeScript modules with
 * the installed `typescript` package into a temp folder, rewrite "@/" imports,
 * and run plain assertions.
 *
 * Run from the app folder:  node scripts/test-gesture-forces.cjs
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
  "src/lib/gesture-detection.ts",
  "src/lib/track-hands.ts",
  "src/lib/hand-world-config.ts",
  "src/lib/map-hand-to-world.ts",
  "src/lib/hand-interaction-samples.ts",
  "src/lib/hand-detection-source.ts",
  "src/lib/hand-interaction-source.ts",
  "src/lib/gesture-force-config.ts",
  "src/lib/gesture-forces.ts",
  "src/lib/gesture-force-field.ts",
  "src/lib/grab-controller.ts",
  "src/lib/palettes.ts",
  "src/lib/particle-motion.ts",
  "src/components/particles/particle-config.ts",
];

const out = fs.mkdtempSync(path.join(os.tmpdir(), "gesture-forces-"));

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
const { createFormationTargets, formationConfig } = load("formations");
const { gestureForceConfig } = load("gesture-force-config");
const {
  createGestureForceState,
  stepGestureForces,
  clearGestureForces,
} = load("gesture-forces");
const {
  createLocalForceField,
  writeLocalForceField,
  gestureForceMagnitude,
} = load("gesture-force-field");
const {
  createGrabController,
  createGrabView,
  stepGrabController,
} = load("grab-controller");
const { createGroupSpace } = load("group-space");
const { createHandInteractionBuilder } = load("hand-interaction-samples");
const { handWorldConfig } = load("hand-world-config");
const {
  publishHandDetection,
} = load("hand-detection-source");
const {
  handInteractionSource,
  refreshHandInteractionSource,
  resetHandInteraction,
} = load("hand-interaction-source");
const { stepParticles } = load("particle-motion");
const { particleConfig } = require(
  path.join(out, "src/components/particles/particle-config.js"),
);

const results = [];

function test(name, body) {
  try {
    resetHandInteraction();
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
const CLOSED = 0.2; // a pinch
const OPEN = 0.8; // clearly not a pinch
const SETTLE = 40; // frames: past the confirm time and the attack ramp

function sample(key, gesture, x, y, ratio = OPEN, extra = {}) {
  return {
    key,
    handedness: key === "Left" || key === "Right" ? key : null,
    pinchPoint: { x, y, z: 0 },
    palmPoint: { x, y, z: 0 },
    pinchRatio: ratio,
    valid: true,
    gesture,
    ...extra,
  };
}

const palm = (key, x, y, ratio) => sample(key, "open_palm", x, y, ratio);
const fist = (key, x, y, ratio) => sample(key, "closed_fist", x, y, ratio);

function run(state, samples, frames, participants = [], dt = DT) {
  for (let index = 0; index < frames; index += 1) {
    stepGestureForces(state, samples, dt, participants);
  }
}

function kinds(state) {
  return state.forces
    .slice(0, state.count)
    .map((force) => `${force.key}:${force.kind}`)
    .sort();
}

/* ---------- config ---------- */

test("the force configuration is sane and documented values are positive", () => {
  const c = gestureForceConfig;
  for (const key of [
    "confirmSeconds",
    "releaseSeconds",
    "attackRate",
    "releaseRate",
    "radius",
    "repulsionStrength",
    "attractionStrength",
  ]) {
    assert.ok(c[key] > 0 && Number.isFinite(c[key]), key);
  }
  assert.ok(c.coreFraction > 0 && c.coreFraction < 1);
  assert.equal(c.pinchCloseBelow, grabConfig.pinchCloseBelow);
  assert.equal(c.pinchOpenAbove, grabConfig.pinchOpenAbove);
});

/* ---------- the gestures ---------- */

test("1. an open palm produces repulsion at its position", () => {
  const state = createGestureForceState();
  run(state, [palm("Right", 1.5, -0.5)], SETTLE);
  assert.equal(state.count, 1);
  const force = state.forces[0];
  assert.equal(force.kind, "repel");
  assert.equal(force.key, "Right");
  near(force.strength, 1, "fully ramped");
  near(force.x, 1.5, "x");
  near(force.y, -0.5, "y");
  near(force.z, 0, "z");
});

test("2. a fist produces attraction at its position", () => {
  const state = createGestureForceState();
  run(state, [fist("Left", -2, 1)], SETTLE);
  assert.equal(state.count, 1);
  assert.equal(state.forces[0].kind, "attract");
  near(state.forces[0].strength, 1, "fully ramped");
  near(state.forces[0].x, -2, "x");
  near(state.forces[0].y, 1, "y");
});

test("3. NONE (and point or pinch) produces no force", () => {
  for (const gesture of ["none", "point", "pinch"]) {
    const state = createGestureForceState();
    run(state, [sample("Right", gesture, 0, 0)], SETTLE);
    assert.equal(state.count, 0, gesture);
  }
  const state = createGestureForceState();
  run(state, [], SETTLE);
  assert.equal(state.count, 0);
});

test("3b. a samples without a gesture field (older producers) means no force", () => {
  const state = createGestureForceState();
  const bare = sample("Right", "open_palm", 0, 0);
  delete bare.gesture;
  run(state, [bare], SETTLE);
  assert.equal(state.count, 0);
});

/* ---------- stability and smooth onset ---------- */

test("4. a gesture must persist before it acts, then ramps in without a jump", () => {
  const state = createGestureForceState();
  const strengths = [];
  for (let index = 0; index < 30; index += 1) {
    stepGestureForces(state, [palm("Right", 0, 0)], DT, []);
    strengths.push(state.count === 0 ? 0 : state.forces[0].strength);
  }
  assert.equal(strengths[0], 0, "not on the first frame");
  assert.equal(strengths[2], 0, "not on the third frame");
  assert.ok(strengths[29] === 1, "fully on later");

  let largestRise = 0;
  for (let index = 1; index < strengths.length; index += 1) {
    largestRise = Math.max(largestRise, strengths[index] - strengths[index - 1]);
  }
  assert.ok(
    largestRise <= gestureForceConfig.attackRate * DT + 1e-9,
    `largest per-frame rise ${largestRise}`,
  );
});

test("4b. a single-frame misclassification does not flicker the force", () => {
  const state = createGestureForceState();
  run(state, [palm("Right", 0, 0)], SETTLE);
  const before = state.forces[0].strength;

  for (const glitch of ["none", "closed_fist", "point"]) {
    stepGestureForces(state, [sample("Right", glitch, 0, 0)], DT, []);
    assert.equal(state.count, 1, `${glitch}: still repelling`);
    assert.equal(state.forces[0].kind, "repel");
    near(state.forces[0].strength, before, "strength unchanged");
    stepGestureForces(state, [palm("Right", 0, 0)], DT, []);
    near(state.forces[0].strength, before, "and after");
  }
});

test("4c. a sustained change switches the force, restarting from zero (no sign-flip spike)", () => {
  const state = createGestureForceState();
  run(state, [palm("Right", 0, 0)], SETTLE);
  assert.equal(state.forces[0].kind, "repel");

  let switchedAt = -1;
  const trail = [];
  for (let index = 0; index < 30; index += 1) {
    stepGestureForces(state, [fist("Right", 0, 0)], DT, []);
    if (switchedAt < 0 && state.count === 1 && state.forces[0].kind === "attract") {
      switchedAt = index;
    }
    if (switchedAt >= 0) {
      trail.push(state.forces[0].strength);
    }
  }
  assert.ok(switchedAt > 2, `switched after the confirm time (frame ${switchedAt})`);
  assert.ok(trail[0] <= gestureForceConfig.attackRate * DT + 1e-9, "starts from zero");
  assert.equal(trail[trail.length - 1], 1);
});

test("4d. leaving the gesture fades the force out smoothly", () => {
  const state = createGestureForceState();
  run(state, [palm("Right", 0, 0)], SETTLE);

  const strengths = [];
  for (let index = 0; index < 60; index += 1) {
    stepGestureForces(state, [sample("Right", "none", 0, 0)], DT, []);
    strengths.push(state.count === 0 ? 0 : state.forces[0].strength);
  }
  assert.equal(strengths[0], 1, "held through the first frames");
  assert.equal(strengths[strengths.length - 1], 0, "gone eventually");
  let largestDrop = 0;
  for (let index = 1; index < strengths.length; index += 1) {
    largestDrop = Math.max(largestDrop, strengths[index - 1] - strengths[index]);
  }
  assert.ok(largestDrop <= gestureForceConfig.releaseRate * DT + 1e-9);
});

test("4e. the hand position follows smoothly and snaps when a hand first appears", () => {
  const state = createGestureForceState();
  stepGestureForces(state, [palm("Right", 3, 0)], DT, []);
  run(state, [palm("Right", 3, 0)], SETTLE);
  near(state.forces[0].x, 3, "snapped on appearance");

  stepGestureForces(state, [palm("Right", 4, 0)], DT, []);
  const x = state.forces[0].x;
  assert.ok(x > 3 && x < 4, `eased, not teleported (${x})`);
  run(state, [palm("Right", 4, 0)], SETTLE);
  near(state.forces[0].x, 4, "arrives", 1e-3);
});

test("4f. odd frame times are safe", () => {
  const state = createGestureForceState();
  for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 5]) {
    stepGestureForces(state, [palm("Right", 0, 0)], dt, []);
    for (let index = 0; index < state.count; index += 1) {
      const force = state.forces[index];
      assert.ok(Number.isFinite(force.strength) && force.strength >= 0 && force.strength <= 1);
      assert.ok(Number.isFinite(force.x));
    }
  }
});

/* ---------- pinch priority ---------- */

test("5. pinching hands do not apply gesture forces", () => {
  const state = createGestureForceState();
  // The raw label says open palm, but the pinch ratio says pinch.
  run(state, [palm("Right", 0, 0, CLOSED)], SETTLE);
  assert.equal(state.count, 0);
  run(state, [fist("Right", 0, 0, CLOSED)], SETTLE);
  assert.equal(state.count, 0);
});

test("5b. a hand transitioning into pinch leaves no stale force", () => {
  const state = createGestureForceState();
  run(state, [fist("Right", 0, 0)], SETTLE);
  assert.equal(state.count, 1);

  stepGestureForces(state, [fist("Right", 0, 0, CLOSED)], DT, []);
  assert.equal(state.count, 0, "gone on the very frame the pinch closes");

  // Pinch hysteresis: between the thresholds it stays a pinch.
  run(state, [palm("Right", 0, 0, 0.45)], SETTLE);
  assert.equal(state.count, 0, "still pinching at 0.45");

  // Released: the force does not snap back, the gesture must be re-confirmed.
  stepGestureForces(state, [palm("Right", 0, 0, OPEN)], DT, []);
  assert.equal(state.count, 0, "not on the release frame");
  run(state, [palm("Right", 0, 0, OPEN)], SETTLE);
  assert.equal(state.count, 1, "and then it applies again");
  assert.equal(state.forces[0].kind, "repel");
});

test("5c. the hand holding a grab or a two-hand transform is excluded", () => {
  const state = createGestureForceState();
  const samples = [palm("Left", -1, 0), fist("Right", 1, 0)];
  run(state, samples, SETTLE);
  assert.equal(state.count, 2);

  stepGestureForces(state, samples, DT, ["Right", null, null]);
  assert.deepEqual(kinds(state), ["Left:repel"], "only the holder is excluded");

  run(state, samples, SETTLE, [null, "Left", "Right"]);
  assert.equal(state.count, 0, "both transform hands excluded");

  // When the interaction ends the hands need a fresh confirmation.
  stepGestureForces(state, samples, DT, []);
  assert.equal(state.count, 0, "no stale force on the frame it ends");
  run(state, samples, SETTLE);
  assert.equal(state.count, 2);
});

test("5d. an excluded hand also stops accumulating gesture confirmation", () => {
  const state = createGestureForceState();
  run(state, [palm("Right", 0, 0)], 30, ["Right"]);
  stepGestureForces(state, [palm("Right", 0, 0)], DT, []);
  assert.equal(state.count, 0);
});

/* ---------- two hands ---------- */

test("6. two hands produce independent forces", () => {
  const state = createGestureForceState();
  run(state, [palm("Left", -3, 0), fist("Right", 3, 0)], SETTLE);
  assert.deepEqual(kinds(state), ["Left:repel", "Right:attract"]);
  const left = state.forces.find((force) => force.key === "Left");
  const right = state.forces.find((force) => force.key === "Right");
  near(left.x, -3, "left x");
  near(right.x, 3, "right x");

  // One hand pinches, the other carries on untouched.
  run(state, [palm("Left", -3, 0, CLOSED), fist("Right", 3, 0)], 5);
  assert.deepEqual(kinds(state), ["Right:attract"]);
  near(state.forces[0].strength, 1, "the other force is unaffected");

  // One hand changes gesture, the other carries on untouched.
  run(state, [palm("Left", -3, 0), fist("Right", 3, 0)], SETTLE);
  run(state, [fist("Left", -3, 0), fist("Right", 3, 0)], SETTLE);
  assert.deepEqual(kinds(state), ["Left:attract", "Right:attract"]);
});

test("6b. unlabeled hands keep their own forces", () => {
  const state = createGestureForceState();
  run(state, [palm("hand-0", -1, 0), fist("hand-1", 1, 0)], SETTLE);
  assert.deepEqual(kinds(state), ["hand-0:repel", "hand-1:attract"]);
});

/* ---------- stale, missing, disabled ---------- */

test("7. a missing hand clears its force at once and the other stays", () => {
  const state = createGestureForceState();
  run(state, [palm("Left", -3, 0), fist("Right", 3, 0)], SETTLE);
  stepGestureForces(state, [fist("Right", 3, 0)], DT, []);
  assert.deepEqual(kinds(state), ["Right:attract"]);
  stepGestureForces(state, [], DT, []);
  assert.equal(state.count, 0);
});

test("7b. an invalid sample, or one without a usable palm, clears the force", () => {
  const cases = [
    (s) => ({ ...s, valid: false }),
    (s) => ({ ...s, palmPoint: { x: Number.NaN, y: 0, z: 0 } }),
    (s) => ({ ...s, pinchRatio: Number.NaN }),
  ];

  for (const [index, mutate] of cases.entries()) {
    const state = createGestureForceState();
    run(state, [palm("Right", 0, 0)], SETTLE);
    assert.equal(state.count, 1);
    stepGestureForces(state, [mutate(palm("Right", 0, 0))], DT, []);
    assert.equal(state.count, 0, `case ${index}`);
  }
});

test("7c. two samples sharing a key cannot drive a force", () => {
  const state = createGestureForceState();
  run(state, [palm("Right", 0, 0), palm("Right", 5, 5)], SETTLE);
  assert.equal(state.count, 0);
});

test("7d. a returning hand must be confirmed again", () => {
  const state = createGestureForceState();
  run(state, [palm("Right", 0, 0)], SETTLE);
  stepGestureForces(state, [], DT, []);
  stepGestureForces(state, [palm("Right", 0, 0)], DT, []);
  assert.equal(state.count, 0);
  run(state, [palm("Right", 0, 0)], SETTLE);
  assert.equal(state.count, 1);
});

test("8. clearing (camera disabled / unmount) removes every force and memory", () => {
  const state = createGestureForceState();
  run(state, [palm("Left", -3, 0), fist("Right", 3, 0)], SETTLE);
  assert.equal(state.count, 2);
  clearGestureForces(state);
  assert.equal(state.count, 0);
  stepGestureForces(state, [palm("Left", -3, 0)], DT, []);
  assert.equal(state.count, 0, "nothing left over: confirmation starts again");
});

test("the engine does not allocate between frames", () => {
  const state = createGestureForceState();
  const forces = state.forces;
  const first = state.forces[0];
  const tracks = state.tracks;
  run(state, [palm("Left", -3, 0), fist("Right", 3, 0)], 100);
  assert.equal(state.forces, forces);
  assert.equal(state.forces[0], first);
  assert.equal(state.tracks, tracks);
});

/* ---------- force law ---------- */

test("9. force strength decreases smoothly with distance and is zero outside", () => {
  const radius = 3;
  const core = 0.75;
  for (const strength of [5, -5]) {
    let previous = Infinity;
    for (let d = core; d < radius; d += 0.05) {
      const magnitude = Math.abs(gestureForceMagnitude(d, radius, core, strength));
      assert.ok(magnitude <= previous + 1e-12, `non-increasing at ${d} (${strength})`);
      previous = magnitude;
    }
  }
  assert.equal(gestureForceMagnitude(radius, radius, core, 5), 0, "zero at the radius");
  assert.equal(gestureForceMagnitude(radius + 1, radius, core, 5), 0, "zero outside");
  assert.ok(gestureForceMagnitude(1, radius, core, 5) > gestureForceMagnitude(2, radius, core, 5));

  // Smooth: no step at the edge or at the core.
  assert.ok(gestureForceMagnitude(radius - 1e-3, radius, core, 5) < 1e-4);
  for (const strength of [5, -5]) {
    const a = gestureForceMagnitude(core - 1e-6, radius, core, strength);
    const b = gestureForceMagnitude(core + 1e-6, radius, core, strength);
    near(a, b, `continuous at the core (${strength})`, 1e-4);
  }
});

test("10. the force is bounded, finite, and signed by strength", () => {
  for (let d = 0; d <= 4; d += 0.01) {
    const attract = gestureForceMagnitude(d, 3, 0.75, 6);
    const repel = gestureForceMagnitude(d, 3, 0.75, -9);
    assert.ok(Number.isFinite(attract) && Number.isFinite(repel));
    assert.ok(attract >= -6 && attract <= 6, `attract ${attract}`);
    assert.ok(repel <= 0 && repel >= -9, `repel ${repel}`);
    // Attraction pulls inward outside half the core and eases off inside it.
    if (d > 0.375 && d < 3) assert.ok(attract > 0, `pulls at ${d}`);
    if (d < 0.375) assert.ok(attract <= 0, `does not pull inside the shell at ${d}`);
  }
  near(gestureForceMagnitude(0, 3, 0.75, -9), 0, "no push at the exact centre", 1e-12);
  assert.ok(
    Math.abs(gestureForceMagnitude(0, 3, 0.75, 6)) <= 6,
    "the attraction's inner buffer is bounded too",
  );
  assert.equal(gestureForceMagnitude(1, 0, 0.1, 6), 0, "degenerate radius");
  assert.equal(gestureForceMagnitude(Number.NaN, 3, 0.75, 6), 0);
});

/* ---------- world -> group conversion ---------- */

function groupAt(x, y, rotation, scale) {
  const group = new THREE.Group();
  group.position.set(x, y, 0);
  group.rotation.z = rotation;
  group.scale.setScalar(scale);
  group.updateMatrixWorld();
  return group;
}

function convert(state, group) {
  const field = createLocalForceField();
  writeLocalForceField(state, group, createGroupSpace(), new THREE.Vector3(), field);
  return field;
}

test("11. gesture positions convert into the group's local space (translate, rotate, scale)", () => {
  const state = createGestureForceState();
  run(state, [palm("Left", -2, 1), fist("Right", 3, -0.5)], SETTLE);

  for (const group of [
    groupAt(0, 0, 0, 1),
    groupAt(1.5, -0.75, 0, 1),
    groupAt(0, 0, 0.9, 1),
    groupAt(0, 0, 0, 2),
    groupAt(1.5, -0.75, 1.3, 1.8),
    groupAt(-2, 1, -2.4, 0.5),
  ]) {
    const field = convert(state, group);
    assert.equal(field.count, 2);
    for (let index = 0; index < 2; index += 1) {
      const world = state.forces[index];
      const local = field.forces[index];
      const back = group.localToWorld(new THREE.Vector3(local.x, local.y, local.z));
      near(back.x, world.x, "x round trip", 1e-9);
      near(back.y, world.y, "y round trip", 1e-9);
      near(back.z, world.z, "z round trip", 1e-9);
    }
  }
});

test("11b. radius and strength follow the group's scale so the field keeps its world size", () => {
  const state = createGestureForceState();
  run(state, [palm("Left", 0, 0), fist("Right", 5, 0)], SETTLE);
  const c = gestureForceConfig;

  for (const scale of [0.4, 1, 2.5]) {
    const field = convert(state, groupAt(0, 0, 0.7, scale));
    const left = field.forces[state.forces.findIndex((f) => f.key === "Left")];
    const right = field.forces[state.forces.findIndex((f) => f.key === "Right")];
    near(left.radius, c.radius / scale, `radius at scale ${scale}`);
    near(left.core, (c.radius / scale) * c.coreFraction, "core");
    near(left.strength, -c.repulsionStrength / scale, "repel is negative");
    near(right.strength, c.attractionStrength / scale, "attract is positive");
    // Local radius times scale is the same world radius, whatever the scale.
    near(left.radius * scale, c.radius, "world radius");
  }
});

test("11c. a ramping force is converted with its ramp", () => {
  const state = createGestureForceState();
  run(state, [palm("Right", 0, 0)], 9); // mid-ramp
  assert.equal(state.count, 1);
  const ramp = state.forces[0].strength;
  assert.ok(ramp > 0 && ramp < 1, `mid-ramp ${ramp}`);
  const field = convert(state, groupAt(0, 0, 0, 1));
  near(field.forces[0].strength, -gestureForceConfig.repulsionStrength * ramp, "ramped strength");
});

test("11d. a degenerate group scale yields no field instead of NaN", () => {
  const state = createGestureForceState();
  run(state, [palm("Right", 0, 0)], SETTLE);
  const field = convert(state, groupAt(0, 0, 0, 0));
  assert.equal(field.count, 0);
});

test("11e. no state -> no field; the field never grows past its capacity", () => {
  const empty = createGestureForceState();
  assert.equal(convert(empty, groupAt(0, 0, 0, 1)).count, 0);
  const field = createLocalForceField();
  assert.ok(field.forces.length >= 2);
});

/* ---------- the physics hook ---------- */

function physicsRig(positions) {
  const count = positions.length / 3;
  return {
    positions: Float32Array.from(positions),
    velocities: new Float32Array(count * 3),
    config: {
      ...particleConfig,
      count,
      bounds: { min: -100, max: 100 },
      forceStrength: 0,
      damping: 0,
      maxSpeed: 1000,
      velocityMultiplier: 1,
    },
  };
}

function oneForceField(x, y, z, radius, strength) {
  const field = createLocalForceField();
  Object.assign(field.forces[0], { x, y, z, radius, core: radius * 0.25, strength });
  field.count = 1;
  return field;
}

test("12. repulsion pushes particles away; attraction pulls them in", () => {
  const rig = physicsRig([1, 0, 0, 0, 1, 0, -1, 0, 0]);
  stepParticles(
    rig.positions, rig.velocities, rig.config, DT,
    "attraction", { x: 50, y: 50, z: 50 }, null, 0, 1,
    oneForceField(0, 0, 0, 3, -5),
  );
  assert.ok(rig.velocities[0] > 0, "right of the hand goes right");
  assert.ok(rig.velocities[4] > 0, "above the hand goes up");
  assert.ok(rig.velocities[6] < 0, "left of the hand goes left");

  const pull = physicsRig([1, 0, 0, 0, 1, 0, -1, 0, 0]);
  stepParticles(
    pull.positions, pull.velocities, pull.config, DT,
    "attraction", { x: 50, y: 50, z: 50 }, null, 0, 1,
    oneForceField(0, 0, 0, 3, 5),
  );
  assert.ok(pull.velocities[0] < 0, "right of the hand goes left");
  assert.ok(pull.velocities[4] < 0, "above the hand goes down");
  assert.ok(pull.velocities[6] > 0, "left of the hand goes right");
});

test("12b. nearer particles are pushed harder; outside the radius nothing moves", () => {
  const rig = physicsRig([1, 0, 0, 2, 0, 0, 5, 0, 0]);
  stepParticles(
    rig.positions, rig.velocities, rig.config, DT,
    "attraction", { x: 50, y: 50, z: 50 }, null, 0, 1,
    oneForceField(0, 0, 0, 3, -5),
  );
  assert.ok(rig.velocities[0] > rig.velocities[3] && rig.velocities[3] > 0);
  assert.equal(rig.velocities[6], 0, "outside the radius");
});

test("12c. the velocity change per frame is bounded, even at the centre and with huge frames", () => {
  const rig = physicsRig([0, 0, 0, 1e-9, 0, 0, 0.0001, 0, 0, 0.5, 0.5, 0]);
  for (const dt of [DT, 0.5, 100]) {
    rig.velocities.fill(0);
    stepParticles(
      rig.positions, rig.velocities, rig.config, dt,
      "attraction", { x: 50, y: 50, z: 50 }, null, 0, 1,
      oneForceField(0, 0, 0, 3, -9),
    );
    for (const value of rig.velocities) {
      assert.ok(Number.isFinite(value));
      assert.ok(Math.abs(value) <= 9 * 0.05 + 1e-9, `|dv| ${value} at dt ${dt}`);
    }
  }
  for (const value of rig.positions) {
    assert.ok(Number.isFinite(value));
  }
});

test("12d. an attracted cloud settles instead of collapsing to a point", () => {
  const count = 200;
  const start = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const radius = 0.5 + (index % 5) * 0.4;
    start.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
  }
  const rig = physicsRig(start);
  rig.config.damping = particleConfig.damping;
  rig.config.maxSpeed = particleConfig.maxSpeed;
  rig.config.velocityMultiplier = particleConfig.velocityMultiplier;
  const field = oneForceField(0, 0, 0, 3.5, gestureForceConfig.attractionStrength);

  for (let step = 0; step < 600; step += 1) {
    stepParticles(
      rig.positions, rig.velocities, rig.config, DT,
      "attraction", { x: 50, y: 50, z: 50 }, null, 0, 1, field,
    );
  }

  let tight = 0;
  let farthest = 0;
  let fastest = 0;
  const distances = [];
  for (let index = 0; index < count; index += 1) {
    const x = rig.positions[index * 3];
    const y = rig.positions[index * 3 + 1];
    const distance = Math.hypot(x, y);
    distances.push(distance);
    farthest = Math.max(farthest, distance);
    if (distance < 0.01) tight += 1;
    fastest = Math.max(fastest, Math.hypot(rig.velocities[index * 3], rig.velocities[index * 3 + 1]));
  }
  distances.sort((a, b) => a - b);
  const median = distances[Math.floor(count / 2)];
  assert.ok(farthest < 3.6, "stays in the field");
  assert.ok(tight / count < 0.05, `fraction collapsed onto the centre: ${tight / count}`);
  assert.ok(
    median > 0.15 && median < 1.2,
    `the cloud settles on a shell around the hand (median ${median})`,
  );
  assert.ok(fastest <= particleConfig.maxSpeed + 1e-6, "speed limit holds");
});

test("12h. in the real scene a pulled or pushed formation stays bounded and recovers on release", () => {
  const count = 1500;
  const homes = createFormationTargets(count, particleConfig.bounds).galaxy;
  const config = { ...particleConfig, count, forceStrength: 0 };
  const positions = Float32Array.from(homes);
  const velocities = new Float32Array(count * 3);

  const homeError = () => {
    let total = 0;
    for (let index = 0; index < count; index += 1) {
      total += Math.hypot(
        positions[index * 3] - homes[index * 3],
        positions[index * 3 + 1] - homes[index * 3 + 1],
        positions[index * 3 + 2] - homes[index * 3 + 2],
      );
    }
    return total / count;
  };
  const run = (field, frames) => {
    for (let step = 0; step < frames; step += 1) {
      stepParticles(
        positions, velocities, config, DT,
        "attraction", { x: 50, y: 50, z: 50 }, homes, formationConfig.formationStrength, 1, field,
      );
    }
  };

  for (const strength of [gestureForceConfig.attractionStrength, -gestureForceConfig.repulsionStrength]) {
    positions.set(homes);
    velocities.fill(0);
    const field = oneForceField(0.4, 0.2, 0, gestureForceConfig.radius, strength);
    run(field, 400);

    let hot = 0;
    for (let index = 0; index < count; index += 1) {
      const v = Math.hypot(velocities[index * 3], velocities[index * 3 + 1], velocities[index * 3 + 2]);
      assert.ok(Number.isFinite(positions[index * 3]) && v <= particleConfig.maxSpeed + 1e-6);
      if (Math.hypot(positions[index * 3] - 0.4, positions[index * 3 + 1] - 0.2, positions[index * 3 + 2]) < 0.02) {
        hot += 1;
      }
    }
    assert.ok(hot / count < 0.03, `strength ${strength}: ${hot} of ${count} on the centre`);
    assert.ok(homeError() > 0.05, `strength ${strength}: the field does act on the formation`);

    field.count = 0;
    run(field, 900);
    assert.ok(homeError() < 0.35, `strength ${strength}: recovers after release (${homeError()})`);
  }
});

test("12e. without a field, or with an empty one, the simulation is unchanged", () => {
  const make = () => physicsRig([1, 0.5, 0, -2, 1, 0.25, 0.1, -0.2, 3]);
  const plain = make();
  const empty = make();
  const withNull = make();
  const emptyField = createLocalForceField();

  for (let step = 0; step < 30; step += 1) {
    stepParticles(plain.positions, plain.velocities, plain.config, DT, "attraction", { x: 1, y: 0, z: 0 }, null, 0, 1);
    stepParticles(empty.positions, empty.velocities, empty.config, DT, "attraction", { x: 1, y: 0, z: 0 }, null, 0, 1, emptyField);
    stepParticles(withNull.positions, withNull.velocities, withNull.config, DT, "attraction", { x: 1, y: 0, z: 0 }, null, 0, 1, null);
  }
  assert.deepEqual(Array.from(empty.positions), Array.from(plain.positions));
  assert.deepEqual(Array.from(withNull.positions), Array.from(plain.positions));
  assert.deepEqual(Array.from(empty.velocities), Array.from(plain.velocities));
});

test("12f. the pointer force still works alongside gesture forces", () => {
  const rig = physicsRig([2, 0, 0]);
  rig.config.forceStrength = 3;
  rig.config.interactionRadius = 8;
  stepParticles(
    rig.positions, rig.velocities, rig.config, DT,
    "attraction", { x: 0, y: 0, z: 0 }, null, 0, 1,
    oneForceField(40, 40, 0, 3, -5),
  );
  assert.ok(rig.velocities[0] < 0, "the pointer still attracts");
});

test("12g. rotation and scale: the push is in the right world direction", () => {
  // Group rolled 90 degrees and scaled 2: local +x is world +y, 2 units per unit.
  const group = groupAt(0, 0, Math.PI / 2, 2);
  const state = createGestureForceState();
  // A palm 1 world unit above a particle that sits at local (1, 0, 0) = world (0, 2, 0).
  run(state, [palm("Right", 0, 3)], SETTLE);
  const field = convert(state, group);

  const rig = physicsRig([1, 0, 0]);
  stepParticles(
    rig.positions, rig.velocities, rig.config, DT,
    "attraction", { x: 50, y: 50, z: 50 }, null, 0, 1, field,
  );
  // Repelled from above means pushed down in the world = local -x.
  assert.ok(rig.velocities[0] < 0, `local vx ${rig.velocities[0]}`);
  near(rig.velocities[1], 0, "no sideways push", 1e-9);
  assert.equal(rig.velocities[2], 0);

  // And a palm below pushes it up instead.
  const below = createGestureForceState();
  run(below, [palm("Right", 0, 1)], SETTLE);
  const rig2 = physicsRig([1, 0, 0]);
  stepParticles(
    rig2.positions, rig2.velocities, rig2.config, DT,
    "attraction", { x: 50, y: 50, z: 50 }, null, 0, 1, convert(below, group),
  );
  assert.ok(rig2.velocities[0] > 0);
});

/* ---------- the whole pipeline and the grab controller ---------- */

const FOV = particleConfig.cameraFov;
const CAMERA_Z = particleConfig.cameraZ;

function makeCamera(aspect = 16 / 9) {
  const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 1000);
  camera.position.set(0, 0, CAMERA_Z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

/** 21 landmarks: palm corners at the frame position, thumb/index set by `pinch`. */
function landmarksAt(cx, cy, pinch) {
  const points = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  points[0] = { x: cx, y: cy + 0.1, z: 0 };
  points[9] = { x: cx, y: cy - 0.1, z: 0 };
  points[4] = { x: cx - (pinch ? 0.01 : 0.15), y: cy, z: 0 };
  points[8] = { x: cx + (pinch ? 0.01 : 0.15), y: cy, z: 0 };
  return points;
}

function tracked(handedness, cx, cy, gesture, pinch = false) {
  const landmarks = landmarksAt(cx, cy, pinch);
  return { handedness, landmarks, gesture, position: { ...landmarks[0] } };
}

function pipeline() {
  const builder = createHandInteractionBuilder();
  const camera = makeCamera();
  const group = new THREE.Group();
  group.updateMatrixWorld();
  const controller = createGrabController();
  Object.assign(controller.limits, { x: 50, y: 50, z: 0 });
  const view = createGrabView();
  const field = createLocalForceField();
  let now = 1000;
  return {
    builder, camera, group, controller, view, field,
    publish(hands) {
      publishHandDetection(hands, now, false, 4 / 3);
    },
    frame(dt = DT) {
      now += dt * 1000;
      const samples = refreshHandInteractionSource(builder, camera, now);
      stepGrabController(controller, group, samples, dt, view, field);
      return samples;
    },
    advance(ms) {
      now += ms;
    },
  };
}

/** Publishes `hands` as a fresh detection before every frame, like a live detector. */
function drive(rig, hands, count) {
  for (let index = 0; index < count; index += 1) {
    rig.publish(hands);
    rig.frame();
  }
}

test("13. detection -> samples -> field: an open palm and a fist reach the field", () => {
  const rig = pipeline();
  drive(
    rig,
    [tracked("Left", 0.3, 0.5, "open_palm"), tracked("Right", 0.7, 0.5, "closed_fist")],
    SETTLE,
  );
  assert.equal(rig.field.count, 2);
  const strengths = rig.field.forces.slice(0, 2).map((force) => Math.sign(force.strength)).sort();
  assert.deepEqual(strengths, [-1, 1], "one repels, one attracts");
  assert.equal(rig.controller.forces.count, 2);
  assert.equal(rig.view.holding, false, "the pointer is not suspended by gesture forces");
});

test("13b. the palm of the sample is where the force is anchored", () => {
  const rig = pipeline();
  drive(rig, [tracked("Right", 0.5, 0.5, "open_palm")], SETTLE);
  assert.equal(rig.field.count, 1);
  // Frame centre maps to the world centre (the active region is centred).
  near(rig.field.forces[0].x, 0, "x", 0.2);
  near(rig.field.forces[0].y, 0, "y", 0.2);
  const samples = handInteractionSource.current;
  assert.equal(samples[0].gesture, "open_palm");
  assert.ok(Number.isFinite(samples[0].palmPoint.x));
});

test("14. camera disable clears gesture interactions at once", () => {
  const rig = pipeline();
  drive(rig, [tracked("Right", 0.5, 0.5, "closed_fist")], SETTLE);
  assert.equal(rig.field.count, 1);

  resetHandInteraction(); // what unmounting the camera card does
  rig.frame();
  assert.equal(rig.field.count, 0);
  assert.equal(rig.controller.forces.count, 0);
});

test("14b. stale detections clear forces too", () => {
  const rig = pipeline();
  drive(rig, [tracked("Right", 0.5, 0.5, "open_palm")], SETTLE);
  assert.equal(rig.field.count, 1);

  rig.advance(handWorldConfig.maxDetectionAgeMs + 50);
  rig.frame();
  assert.equal(handInteractionSource.current.length, 0);
  assert.equal(rig.field.count, 0);
});

test("14c. a hand that disappears from the detection clears its force", () => {
  const rig = pipeline();
  drive(
    rig,
    [tracked("Left", 0.3, 0.5, "open_palm"), tracked("Right", 0.7, 0.5, "closed_fist")],
    SETTLE,
  );
  drive(rig, [tracked("Right", 0.7, 0.5, "closed_fist")], 1);
  assert.equal(rig.field.count, 1);
  assert.ok(rig.field.forces[0].strength > 0, "only the fist remains");
});

test("15. a hand pinching to grab moves the formation and applies no force; the other hand still does", () => {
  const rig = pipeline();
  // Right pinches near the formation (frame centre is the world centre).
  const grabber = (x) => tracked("Right", x, 0.5, "pinch", true);
  const waver = tracked("Left", 0.2, 0.3, "open_palm");

  drive(rig, [grabber(0.5), waver], 10);
  assert.equal(rig.controller.grab.phase, "grabbing");
  assert.equal(rig.controller.grab.grabKey, "Right");
  assert.equal(rig.view.holding, true);
  assert.equal(rig.field.count, 1, "only the free hand");
  assert.ok(rig.field.forces[0].strength < 0, "the free open palm repels");

  // Move the pinching hand gradually, as a real hand would.
  const before = rig.group.position.x;
  for (let step = 1; step <= 60; step += 1) {
    drive(rig, [grabber(0.5 + (0.08 * step) / 60), waver], 1);
  }
  drive(rig, [grabber(0.58), waver], 30);
  assert.equal(rig.controller.grab.grabKey, "Right", "still the same grab");
  assert.ok(rig.group.position.x > before + 0.5, "the grab still moves the formation");
  assert.equal(rig.field.count, 1);
});

test("15b. even a hand whose gesture label is open palm is excluded while it holds a grab", () => {
  const rig = pipeline();
  drive(rig, [tracked("Right", 0.5, 0.5, "open_palm", true)], 10);
  assert.equal(rig.controller.grab.phase, "grabbing");
  assert.equal(rig.field.count, 0);
});

test("16. two hands transforming apply no force; releasing one gives it back only after confirmation", () => {
  const rig = pipeline();
  const left = tracked("Left", 0.4, 0.5, "pinch", true);
  const right = tracked("Right", 0.6, 0.5, "pinch", true);
  drive(rig, [left, right], 12);
  assert.equal(rig.controller.two.phase, "active");
  assert.equal(rig.field.count, 0);

  // Left opens into an open palm: the transform ends, Right carries on as a grab.
  const open = tracked("Left", 0.4, 0.5, "open_palm");
  drive(rig, [open, right], 5);
  assert.equal(rig.controller.two.phase, "inactive");
  assert.equal(rig.controller.grab.grabKey, "Right");
  assert.equal(rig.field.count, 0, "not yet: the open palm must be confirmed");
  drive(rig, [open, right], SETTLE);
  assert.equal(rig.field.count, 1, "now the free hand repels");
  assert.ok(rig.field.forces[0].strength < 0);
});

test("17. grab and two-hand results are identical with and without the force field", () => {
  const script = [
    { hands: () => [tracked("Right", 0.5, 0.5, "pinch", true)], frames: 12 },
    { hands: () => [tracked("Right", 0.6, 0.45, "pinch", true)], frames: 60 },
    { hands: () => [tracked("Left", 0.35, 0.45, "pinch", true), tracked("Right", 0.65, 0.45, "pinch", true)], frames: 15 },
    { hands: () => [tracked("Left", 0.3, 0.4, "pinch", true), tracked("Right", 0.7, 0.4, "pinch", true)], frames: 60 },
    { hands: () => [tracked("Left", 0.3, 0.4, "open_palm"), tracked("Right", 0.7, 0.4, "open_palm")], frames: 30 },
  ];

  // Deterministic replay with an explicit clock.
  function replay(withField) {
    const builder = createHandInteractionBuilder();
    const camera = makeCamera();
    const group = new THREE.Group();
    group.updateMatrixWorld();
    const controller = createGrabController();
    Object.assign(controller.limits, { x: 50, y: 50, z: 0 });
    const view = createGrabView();
    const field = withField ? createLocalForceField() : undefined;
    const trail = [];
    let now = 5000;
    for (const step of script) {
      const hands = step.hands();
      for (let index = 0; index < step.frames; index += 1) {
        publishHandDetection(hands, now, false, 4 / 3);
        const samples = refreshHandInteractionSource(builder, camera, now);
        stepGrabController(controller, group, samples, DT, view, field);
        trail.push([
          group.position.x, group.position.y, group.rotation.z, group.scale.x,
          view.holding ? 1 : 0, controller.two.phase === "active" ? 1 : 0,
        ]);
        now += DT * 1000;
      }
    }
    return trail;
  }

  const without = replay(false);
  const withForces = replay(true);
  assert.equal(without.length, withForces.length);
  assert.deepEqual(withForces, without, "identical transforms and modes every frame");
  const last = without[without.length - 1];
  assert.ok(Math.abs(last[3] - 1) > 0.01, "the two-hand transform really changed the scale");
});

test("17b. the controller still works when no field is passed", () => {
  const rig = pipeline();
  const hands = [tracked("Right", 0.5, 0.5, "pinch", true)];
  for (let index = 0; index < 20; index += 1) {
    publishHandDetection(hands, 100 + index * 16, false, 4 / 3);
    const samples = refreshHandInteractionSource(rig.builder, rig.camera, 100 + index * 16);
    stepGrabController(rig.controller, rig.group, samples, DT, rig.view);
  }
  assert.equal(rig.controller.grab.phase, "grabbing");
});

test("18. gesture forces use the group's current transform for conversion", () => {
  const rig = pipeline();
  rig.group.position.set(2, 1, 0);
  rig.group.rotation.z = 0.8;
  rig.group.scale.setScalar(1.6);
  rig.group.updateMatrixWorld();
  rig.controller.grab.desiredOrigin.x = 2;
  rig.controller.grab.desiredOrigin.y = 1;
  rig.controller.target.rotation = 0.8;
  rig.controller.target.scale = 1.6;

  drive(rig, [tracked("Right", 0.65, 0.4, "open_palm")], SETTLE);
  assert.equal(rig.field.count, 1);
  const local = rig.field.forces[0];
  const world = rig.controller.forces.forces[0];
  const back = rig.group.localToWorld(new THREE.Vector3(local.x, local.y, local.z));
  near(back.x, world.x, "round trip x", 1e-9);
  near(back.y, world.y, "round trip y", 1e-9);
  near(local.radius * 1.6, gestureForceConfig.radius, "radius keeps its world size");
});

/* ---------- report ---------- */

fs.rmSync(out, { recursive: true, force: true });

let failed = 0;
for (const result of results) {
  if (result.ok) {
    console.log(`PASS  ${result.name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${result.name}\n      ${result.error.message}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
