/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS script */
"use strict";

/**
 * Tests for the two-hand transform (translate, scale, rotate) and how it hands
 * over to and from the single-hand grab. Runs real three.js groups through the
 * grab controller, plus the pure two-hand engine directly.
 *
 * Same approach as the other scripts: transpile the TypeScript modules with the
 * installed `typescript` package into a temp folder, rewrite "@/" imports, and
 * run plain assertions.
 *
 * Run from the app folder:  node scripts/test-two-hand-transform.cjs
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
  "src/lib/grab-controller.ts",
];

const out = fs.mkdtempSync(path.join(os.tmpdir(), "two-hand-"));

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
const { createFormationTargets } = load("formations");
const {
  grabMotionConfig,
  computeGrabLimits,
  transformedExtent,
} = load("grab-motion");
const { measureFormationExtents } = load("formation-extents");
const { twoHandConfig } = load("two-hand-config");
const {
  createTwoHandState,
  stepTwoHand,
  wrapAngle,
} = load("two-hand-transform");
const {
  createGrabController,
  createGrabView,
  setGrabBounds,
  stepGrabController,
  writeLocalTarget,
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
const CLOSED = 0.2;
const OPEN = 0.8;
const WIDE = { x: 50, y: 50, z: 0 };
const START = twoHandConfig.startFrames;
const RELEASE = twoHandConfig.releaseFrames;

function hand(key, x, y, ratio = CLOSED, extra = {}) {
  return {
    key,
    handedness: key === "Left" || key === "Right" ? key : null,
    pinchPoint: { x, y, z: 0 },
    pinchRatio: ratio,
    valid: true,
    ...extra,
  };
}

/** Two hands centred on (cx, cy), `half` either side along angle `phi`. */
function pair(cx, cy, half, phi = 0, ratio = CLOSED) {
  const dx = Math.cos(phi) * half;
  const dy = Math.sin(phi) * half;
  return [
    hand("Left", cx - dx, cy - dy, ratio),
    hand("Right", cx + dx, cy + dy, ratio),
  ];
}

function makeRig(limits = WIDE) {
  const group = new THREE.Group();
  group.updateMatrixWorld();
  const controller = createGrabController();
  Object.assign(controller.limits, limits);
  const view = createGrabView();
  return { group, controller, view };
}

/** Puts the group at a transform and syncs the controller's targets to it. */
function place(rig, x, y, rotation = 0, scale = 1) {
  rig.group.position.set(x, y, 0);
  rig.group.rotation.z = rotation;
  rig.group.scale.setScalar(scale);
  rig.group.updateMatrixWorld();
  rig.controller.grab.desiredOrigin.x = x;
  rig.controller.grab.desiredOrigin.y = y;
  rig.controller.grab.desiredOrigin.z = 0;
  rig.controller.target.rotation = rotation;
  rig.controller.target.scale = scale;
}

function frame(rig, samples, dt = DT) {
  stepGrabController(rig.controller, rig.group, samples, dt, rig.view);
}

function frames(rig, count, samples, dt = DT) {
  for (let index = 0; index < count; index += 1) {
    frame(rig, samples, dt);
  }
}

function two(rig) {
  return rig.controller.two;
}

/** Brings the controller into two-hand mode with hands `half` either side of (cx, cy). */
function activate(rig, cx = 0, cy = 0, half = 1, phi = 0) {
  frames(rig, START, pair(cx, cy, half, phi));
  assert.equal(two(rig).phase, "active", "two-hand mode should be active");
}

function settle(rig, samples, count = 200) {
  frames(rig, count, samples);
}

function assertFiniteGroup(group) {
  for (const value of [
    group.position.x,
    group.position.y,
    group.position.z,
    group.rotation.z,
    group.scale.x,
  ]) {
    assert.ok(Number.isFinite(value), "group transform must be finite");
  }
}

function camera(aspect) {
  const cam = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

function snapshot(group) {
  return {
    x: group.position.x,
    y: group.position.y,
    z: group.position.z,
    rotation: group.rotation.z,
    scale: group.scale.x,
  };
}

/* ---------- helpers ---------- */

test("wrapAngle maps any angle into (-pi, pi]", () => {
  near(wrapAngle(0), 0, "0");
  near(wrapAngle(Math.PI * 2), 0, "2pi");
  near(wrapAngle(Math.PI + 0.1), -Math.PI + 0.1, "pi+0.1");
  near(wrapAngle(-Math.PI - 0.1), Math.PI - 0.1, "-pi-0.1");
  near(wrapAngle(7 * Math.PI + 0.2), -Math.PI + 0.2, "multi-turn");
  assert.ok(Math.abs(wrapAngle(Math.PI)) <= Math.PI + 1e-12);
});

test("transformedExtent applies scale and the axis-aligned box of a rotation", () => {
  const out = { x: 0, y: 0, z: 0 };
  transformedExtent({ x: 3, y: 1, z: 2 }, 0, 2, out);
  assert.deepEqual([out.x, out.y, out.z], [6, 2, 4]);
  transformedExtent({ x: 3, y: 1, z: 2 }, Math.PI / 2, 1, out);
  near(out.x, 1, "x after quarter turn");
  near(out.y, 3, "y after quarter turn");
  near(out.z, 2, "z unchanged by a roll");
  transformedExtent({ x: 3, y: 1, z: 2 }, Math.PI / 4, 1, out);
  near(out.x, (3 + 1) * Math.SQRT1_2, "x at 45deg");
  near(out.y, (3 + 1) * Math.SQRT1_2, "y at 45deg");
});

/* ---------- activation ---------- */

test("1. two hands pinching together activate the transformation", () => {
  const state = createTwoHandState();
  const current = { x: 0, y: 0, z: 0, rotation: 0, scale: 1 };
  const started = [];
  for (let index = 0; index < START + 2; index += 1) {
    stepTwoHand(state, pair(0, 0, 1), DT, current, false);
    started.push(state.started);
  }
  assert.deepEqual(
    started,
    [...Array(START - 1).fill(false), true, false, false],
    "started exactly once, after the start frames",
  );
  assert.equal(state.phase, "active");
  assert.deepEqual([state.keyA, state.keyB], ["Left", "Right"]);
});

test("1b. one pinching hand, or two open hands, never activate", () => {
  const state = createTwoHandState();
  const current = { x: 0, y: 0, z: 0, rotation: 0, scale: 1 };
  for (let index = 0; index < 10; index += 1) {
    stepTwoHand(state, [hand("Right", 0.5, 0)], DT, current, false);
  }
  assert.equal(state.phase, "inactive");
  for (let index = 0; index < 10; index += 1) {
    stepTwoHand(state, pair(0, 0, 1, 0, OPEN), DT, current, false);
  }
  assert.equal(state.phase, "inactive");
  stepTwoHand(state, pair(0, 0, 1), DT, current, false);
  assert.equal(state.phase, "candidate");
  stepTwoHand(state, [hand("Left", -1, 0)], DT, current, false);
  assert.equal(state.phase, "inactive", "a candidate needs both hands to keep pinching");
});

test("1c. hysteresis: a pinch between the thresholds neither starts nor stops", () => {
  const state = createTwoHandState();
  const current = { x: 0, y: 0, z: 0, rotation: 0, scale: 1 };
  for (let index = 0; index < 10; index += 1) {
    stepTwoHand(state, pair(0, 0, 1, 0, 0.45), DT, current, false);
  }
  assert.equal(state.phase, "inactive");
  for (let index = 0; index < START; index += 1) {
    stepTwoHand(state, pair(0, 0, 1, 0, CLOSED), DT, current, false);
  }
  for (let index = 0; index < 10; index += 1) {
    stepTwoHand(state, pair(0, 0, 1, 0, 0.45), DT, current, false);
  }
  assert.equal(state.phase, "active");
});

test("1d. an idle activation needs the hands near the formation; a live grab does not", () => {
  const far = createTwoHandState();
  const current = { x: 0, y: 0, z: 0, rotation: 0, scale: 1 };
  for (let index = 0; index < 8; index += 1) {
    stepTwoHand(far, pair(twoHandConfig.activationRadius + 3, 0, 1), DT, current, false);
  }
  assert.equal(far.phase, "inactive");

  const engaged = createTwoHandState();
  for (let index = 0; index < START; index += 1) {
    stepTwoHand(engaged, pair(twoHandConfig.activationRadius + 3, 0, 1), DT, current, true);
  }
  assert.equal(engaged.phase, "active");
});

test("2. one hand alone still uses the existing grab behaviour", () => {
  const rig = makeRig();
  frames(rig, grabConfig.startFrames, [hand("Right", 0.5, 0.5)]);
  assert.equal(rig.controller.grab.phase, "grabbing");
  assert.equal(two(rig).phase, "inactive");
  assert.equal(rig.view.mode, "one");
  assert.equal(rig.view.holding, true);

  frames(rig, 90, [hand("Right", 1.5, 1)]);
  near(rig.group.position.x, 1, "moved with the hand", 1e-3);
  near(rig.group.position.y, 0.5, "moved with the hand", 1e-3);
  near(rig.group.scale.x, 1, "scale untouched");
  near(rig.group.rotation.z, 0, "rotation untouched");
});

test("3. baseline capture uses the current group transform", () => {
  const rig = makeRig();
  place(rig, 1, 0.5, 0.4, 1.5);
  activate(rig, 1, 0.5, 1);

  const { baseline, desired } = two(rig);
  near(baseline.position.x, 1, "baseline x");
  near(baseline.position.y, 0.5, "baseline y");
  near(baseline.rotation, 0.4, "baseline rotation");
  near(baseline.scale, 1.5, "baseline scale");
  near(baseline.distance, 2, "baseline distance");
  near(baseline.angle, 0, "baseline angle");
  near(baseline.mid.x, 1, "baseline mid x");
  near(baseline.mid.y, 0.5, "baseline mid y");
  near(baseline.a.x, 0, "left hand x");
  near(baseline.b.x, 2, "right hand x");

  near(desired.position.x, 1, "desired x equals the group");
  near(desired.rotation, 0.4, "desired rotation equals the group");
  near(desired.scale, 1.5, "desired scale equals the group");
});

test("3b. the baseline is the group's smoothed transform, not the target it is easing toward", () => {
  const rig = makeRig();
  // The group is mid-ease: its targets are far from where it is now.
  rig.group.position.x = 0.5;
  rig.group.scale.setScalar(1.1);
  rig.group.updateMatrixWorld();
  rig.controller.grab.desiredOrigin.x = 4;
  rig.controller.target.scale = 2;

  frames(rig, START - 1, pair(0.5, 0, 1));
  const before = snapshot(rig.group);
  assert.ok(before.x > 0.5 && before.x < 4, "still easing toward the old target");
  frame(rig, pair(0.5, 0, 1));
  assert.equal(two(rig).phase, "active");
  near(two(rig).baseline.position.x, before.x, "baseline x is the live group x");
  near(two(rig).baseline.scale, before.scale, "baseline scale is the live group scale");
  near(two(rig).desired.position.x, before.x, "and nothing is pulled toward the old target");
});

/* ---------- translate / scale / rotate ---------- */

test("4. moving both hands together translates the formation", () => {
  const rig = makeRig();
  place(rig, 1, 0.5);
  activate(rig, 0, 0, 1);
  for (let step = 1; step <= 4; step += 1) {
    frame(rig, pair(step * 0.25, step * 0.125, 1));
  }
  near(two(rig).desired.position.x, 2, "x offset from the midpoint preserved");
  near(two(rig).desired.position.y, 1, "y offset from the midpoint preserved");
  near(two(rig).desired.scale, 1, "scale unchanged");
  near(two(rig).desired.rotation, 0, "rotation unchanged");

  settle(rig, pair(1, 0.5, 1));
  near(rig.group.position.x, 2, "group followed", 1e-3);
  near(rig.group.position.y, 1, "group followed", 1e-3);
});

test("5. moving the hands apart increases the scale", () => {
  const rig = makeRig();
  activate(rig);
  for (let step = 1; step <= 4; step += 1) {
    frame(rig, pair(0, 0, 1 + step * 0.125));
  }
  near(two(rig).desired.scale, 1.5, "ratio 3/2");
  settle(rig, pair(0, 0, 1.5));
  near(rig.group.scale.x, 1.5, "group scale", 1e-3);
});

test("6. moving the hands closer decreases the scale", () => {
  const rig = makeRig();
  activate(rig);
  for (let step = 1; step <= 4; step += 1) {
    frame(rig, pair(0, 0, 1 - step * 0.125));
  }
  near(two(rig).desired.scale, 0.5, "ratio 1/2");
  settle(rig, pair(0, 0, 0.5));
  near(rig.group.scale.x, 0.5, "group scale", 1e-3);
});

test("7. returning to the baseline distance restores the baseline scale (no drift)", () => {
  const rig = makeRig();
  place(rig, 0, 0, 0, 1.2);
  activate(rig);
  const halves = [1.4, 0.8, 1.9, 0.6, 1.3, 1.0];
  for (let cycle = 0; cycle < 40; cycle += 1) {
    for (const half of halves) {
      frame(rig, pair(0, 0, half));
    }
  }
  frame(rig, pair(0, 0, 1));
  near(two(rig).desired.scale, 1.2, "scale back at baseline", 1e-9);
});

test("8. rotating the hands rotates the formation about Z", () => {
  const rig = makeRig();
  place(rig, 0, 0, 0.3, 1);
  activate(rig);
  for (let step = 1; step <= 10; step += 1) {
    frame(rig, pair(0, 0, 1, step * 0.05));
  }
  near(two(rig).desired.rotation, 0.3 + 0.5, "baseline plus the angle difference");
  settle(rig, pair(0, 0, 1, 0.5));
  near(rig.group.rotation.z, 0.8, "group rotation", 1e-3);

  for (let step = 1; step <= 20; step += 1) {
    frame(rig, pair(0, 0, 1, 0.5 - step * 0.05));
  }
  near(two(rig).desired.rotation, 0.3 - 0.5, "rotating back goes below the baseline");
});

test("9. crossing the -pi/+pi boundary does not cause a rotation jump", () => {
  for (const direction of [1, -1]) {
    const rig = makeRig();
    const start = direction > 0 ? 3.0 : -3.0;
    frames(rig, START, pair(0, 0, 1, start));
    assert.equal(two(rig).phase, "active");

    let previous = two(rig).desired.rotation;
    let largest = 0;
    for (let step = 1; step <= 20; step += 1) {
      const phi = start + direction * step * 0.03;
      frame(rig, pair(0, 0, 1, phi));
      const rotation = two(rig).desired.rotation;
      largest = Math.max(largest, Math.abs(rotation - previous));
      previous = rotation;
    }
    assert.ok(largest < 0.031, `largest step ${largest}`);
    near(two(rig).desired.rotation, direction * 0.6, "total rotation", 1e-9);
  }
});

test("9b. rotation can exceed one half turn without wrapping back", () => {
  const rig = makeRig();
  activate(rig);
  for (let step = 1; step <= 100; step += 1) {
    frame(rig, pair(0, 0, 1, step * 0.05));
  }
  near(two(rig).desired.rotation, 5, "accumulated beyond pi", 1e-9);
  settle(rig, pair(0, 0, 1, 5));
  near(rig.group.rotation.z, 5, "group follows without spinning back", 1e-3);
});

test("10. a very small hand distance is handled safely", () => {
  // Never activates while the hands are almost touching.
  const rig = makeRig();
  frames(rig, 12, pair(0, 0, 0.1));
  assert.equal(two(rig).phase, "inactive");

  // While active: collapse to nothing and come back at another angle.
  const live = makeRig();
  activate(live);
  for (let step = 1; step <= 6; step += 1) {
    frame(live, pair(0, 0, 1, step * 0.05));
  }
  const before = two(live).desired.rotation;
  for (const [half, phi] of [
    [0.5, 0.3],
    [0.2, 1.2],
    [0.05, 1.2],
    [0.001, 1.2],
    [0, 1.2],
  ]) {
    frame(live, pair(0, 0, half, phi));
    assert.ok(Number.isFinite(two(live).desired.scale));
    assert.ok(Number.isFinite(two(live).desired.rotation));
  }
  near(two(live).desired.scale, twoHandConfig.minScale, "collapsed to the minimum scale");
  near(two(live).desired.rotation, before, "rotation frozen while the angle is meaningless");

  frames(live, 4, pair(0, 0, 1, 1.2));
  near(two(live).desired.rotation, before, "no jump when the hands come back rotated", 1e-9);
  assertFiniteGroup(live.group);
  frames(live, 4, pair(0, 0, 1, 1.3));
  near(two(live).desired.rotation, before + 0.1, "and rotation resumes", 1e-9);
});

test("11. scale limits are respected, with no dead zone when reversing", () => {
  const rig = makeRig();
  activate(rig);
  let half = 1;
  for (let step = 0; step < 60; step += 1) {
    half += 0.5;
    frame(rig, pair(0, 0, half));
    assert.ok(two(rig).desired.scale <= twoHandConfig.maxScale + 1e-9);
  }
  near(two(rig).desired.scale, twoHandConfig.maxScale, "pinned at the maximum");

  frame(rig, pair(0, 0, half - 0.5));
  assert.ok(two(rig).desired.scale < twoHandConfig.maxScale, "reversing responds at once");
  near(
    two(rig).desired.scale,
    (twoHandConfig.maxScale * (half - 0.5)) / half,
    "proportional to the distance change",
    1e-9,
  );

  const small = makeRig();
  activate(small);
  for (let step = 1; step <= 8; step += 1) {
    frame(small, pair(0, 0, 1 - step * 0.1));
    assert.ok(small.controller.two.desired.scale >= twoHandConfig.minScale - 1e-9);
  }
  near(small.controller.two.desired.scale, twoHandConfig.minScale, "pinned at the minimum");
  assert.ok(twoHandConfig.minScale > 0 && twoHandConfig.maxScale > twoHandConfig.minScale);
});

test("11b. the group's scale follows the clamped target", () => {
  const rig = makeRig();
  activate(rig);
  for (let step = 1; step <= 40; step += 1) {
    frame(rig, pair(0, 0, 1 + step * 0.5));
  }
  settle(rig, pair(0, 0, 21));
  near(rig.group.scale.x, twoHandConfig.maxScale, "group at the limit", 1e-3);
  near(rig.group.scale.y, twoHandConfig.maxScale, "uniform y", 1e-3);
  near(rig.group.scale.z, twoHandConfig.maxScale, "uniform z", 1e-3);
});

test("12. joining a second hand to an existing grab does not jump", () => {
  const rig = makeRig();
  frames(rig, grabConfig.startFrames, [hand("Right", 2, 0)]);
  for (let step = 1; step <= 6; step += 1) {
    frame(rig, [hand("Right", 2 + step * 0.4, 0.2)]);
  }
  assert.equal(rig.controller.grab.phase, "grabbing");

  // Control: an identical rig whose second hand never joins.
  const control = makeRig();
  frames(control, grabConfig.startFrames, [hand("Right", 2, 0)]);
  for (let step = 1; step <= 6; step += 1) {
    frame(control, [hand("Right", 2 + step * 0.4, 0.2)]);
  }

  const join = [hand("Left", -1, 0), hand("Right", 4.4, 0.2)];
  const solo = [hand("Right", 4.4, 0.2)];
  let previous = snapshot(rig.group);
  let activatedAt = -1;
  for (let index = 0; index < START + 12; index += 1) {
    frame(rig, join);
    frame(control, solo);
    const now = snapshot(rig.group);
    if (activatedAt < 0 && two(rig).started) {
      activatedAt = index;
      // The second hand stops the group where it is: no jump in any direction.
      near(now.x, previous.x, "no move on the joining frame", 1e-12);
      near(now.y, previous.y, "no move on the joining frame", 1e-12);
    } else if (activatedAt < 0) {
      // Until then the single grab carries on exactly as it would alone.
      near(now.x, snapshot(control.group).x, "same as the lone hand", 1e-12);
    } else {
      near(now.x, previous.x, "static hands leave the group still", 1e-9);
      near(now.y, previous.y, "static hands leave the group still", 1e-9);
    }
    previous = now;
  }
  assert.equal(activatedAt, START - 1, "activates after the start frames");
  assert.equal(two(rig).phase, "active");
  assert.equal(rig.controller.grab.phase, "idle", "the single grab hands over");
  near(rig.group.scale.x, 1, "scale unchanged by the join", 1e-9);
  near(rig.group.rotation.z, 0, "rotation unchanged by the join", 1e-9);
});

test("12b. the second hand joining from idle keeps the group exactly in place", () => {
  const rig = makeRig();
  place(rig, 1.5, -0.5, 0.2, 1.3);
  activate(rig, 1.5, -0.5, 1.2);
  const before = snapshot(rig.group);
  frames(rig, 30, pair(1.5, -0.5, 1.2));
  const after = snapshot(rig.group);
  for (const key of Object.keys(before)) {
    near(after[key], before[key], key, 1e-9);
  }
});

/* ---------- transitions out ---------- */

test("13. releasing one hand moves safely to single-hand mode", () => {
  const rig = makeRig();
  place(rig, 0.5, 0);
  activate(rig, 0, 0, 1);
  for (let step = 1; step <= 4; step += 1) {
    frame(rig, pair(0, 0, 1 + step * 0.125, 0.1 * step));
  }
  settle(rig, pair(0, 0, 1.5, 0.4), 120);
  const heldScale = two(rig).desired.scale;
  const heldRotation = two(rig).desired.rotation;

  // Left opens. The formation holds still while it is opening.
  const hold = snapshot(rig.group);
  const right = hand("Right", 1.5 * Math.cos(0.4), 1.5 * Math.sin(0.4));
  const leftOpen = hand("Left", -1.5 * Math.cos(0.4), -1.5 * Math.sin(0.4), OPEN);
  for (let index = 0; index < RELEASE - 1; index += 1) {
    frame(rig, [leftOpen, right]);
    assert.equal(two(rig).phase, "active");
    near(rig.group.position.x, hold.x, "frozen while a hand opens", 1e-9);
  }
  frame(rig, [leftOpen, right]);
  assert.equal(two(rig).phase, "inactive");
  assert.equal(rig.controller.grab.phase, "grabbing", "the remaining pinch carries on");
  assert.equal(rig.controller.grab.grabKey, "Right");
  assert.equal(rig.view.mode, "one");
  assert.equal(rig.view.holding, true);

  // No jump, and the single hand moves the formation from where it is.
  const atHandover = snapshot(rig.group);
  frames(rig, 6, [leftOpen, right]);
  near(rig.group.position.x, atHandover.x, "no jump", 1e-6);
  near(rig.group.position.y, atHandover.y, "no jump", 1e-6);
  const moved = hand("Right", right.pinchPoint.x + 1, right.pinchPoint.y);
  frames(rig, 120, [leftOpen, moved]);
  near(rig.group.position.x, atHandover.x + 1, "moved by the hand's travel", 1e-3);
  near(rig.group.scale.x, heldScale, "scale held", 1e-3);
  near(rig.group.rotation.z, heldRotation, "rotation held", 1e-3);
});

test("13b. a vanished hand hands over to the one still pinching", () => {
  const rig = makeRig();
  activate(rig, 0, 0, 1);
  const right = hand("Right", 1, 0);
  const placed = snapshot(rig.group);
  frames(rig, 4, [right]);
  assert.equal(two(rig).phase, "active", "still inside the grace period");
  frames(rig, 20, [right]);
  assert.equal(two(rig).phase, "inactive");
  assert.equal(rig.controller.grab.phase, "grabbing");
  assert.equal(rig.controller.grab.grabKey, "Right");
  near(rig.group.position.x, placed.x, "no jump", 1e-9);
});

test("13c. the other hand can leave instead", () => {
  const rig = makeRig();
  activate(rig, 0, 0, 1);
  frames(rig, 20, [hand("Left", -1, 0)]);
  assert.equal(two(rig).phase, "inactive");
  assert.equal(rig.controller.grab.grabKey, "Left");
});

test("13d. a second hand can rejoin the single grab and rebaseline again", () => {
  const rig = makeRig();
  activate(rig, 0, 0, 1);
  frames(rig, 20, [hand("Right", 1, 0)]);
  assert.equal(rig.controller.grab.phase, "grabbing");
  const at = snapshot(rig.group);
  frames(rig, START + 4, [hand("Left", -1, 0), hand("Right", 1, 0)]);
  assert.equal(two(rig).phase, "active");
  const now = snapshot(rig.group);
  near(now.x, at.x, "no jump on rejoining", 1e-9);
  near(now.scale, at.scale, "scale", 1e-9);
});

test("14. releasing both hands preserves the final transform", () => {
  const rig = makeRig();
  place(rig, 0.5, 0.25);
  activate(rig, 0, 0, 1);
  for (let step = 1; step <= 8; step += 1) {
    frame(rig, pair(step * 0.1, step * 0.05, 1 + step * 0.0625, step * 0.04));
  }
  const final = {
    x: two(rig).desired.position.x,
    y: two(rig).desired.position.y,
    rotation: two(rig).desired.rotation,
    scale: two(rig).desired.scale,
  };
  frames(rig, RELEASE, pair(0.8, 0.4, 1.5, 0.32, OPEN));
  assert.equal(two(rig).phase, "inactive");
  assert.equal(rig.controller.grab.phase, "idle");
  assert.equal(rig.view.holding, false);

  settle(rig, [], 240);
  near(rig.group.position.x, final.x, "x", 1e-3);
  near(rig.group.position.y, final.y, "y", 1e-3);
  near(rig.group.rotation.z, final.rotation, "rotation", 1e-3);
  near(rig.group.scale.x, final.scale, "scale", 1e-3);

  // Hands moving afterwards (open) change nothing.
  const kept = snapshot(rig.group);
  frames(rig, 60, pair(-3, 2, 2, 1, OPEN));
  near(rig.group.position.x, kept.x, "x kept", 1e-9);
  near(rig.group.scale.x, kept.scale, "scale kept", 1e-9);
});

test("14b. after the transform is released, a fresh single-hand grab works from it", () => {
  const rig = makeRig();
  activate(rig, 0, 0, 1);
  for (let step = 1; step <= 4; step += 1) {
    frame(rig, pair(0, 0, 1 + step * 0.125));
  }
  frames(rig, RELEASE, pair(0, 0, 1.5, 0, OPEN));
  settle(rig, [], 120);
  const scale = rig.group.scale.x;
  frames(rig, 10, [hand("Right", 0, 0, OPEN)]);
  frames(rig, grabConfig.startFrames, [hand("Right", 0, 0)]);
  assert.equal(rig.controller.grab.phase, "grabbing");
  frames(rig, 90, [hand("Right", 1, 0)]);
  near(rig.group.position.x, 1, "moves again", 1e-3);
  near(rig.group.scale.x, scale, "keeps the scale", 1e-9);
});

test("15. missing hands and camera disable release safely", () => {
  const rig = makeRig();
  place(rig, 0, 0, 0.2, 1.4);
  activate(rig, 0, 0, 1);
  for (let step = 1; step <= 4; step += 1) {
    frame(rig, pair(0.1 * step, 0, 1 + step * 0.0625));
  }
  const held = two(rig).desired.position.x;

  // The interaction source is emptied: no samples any more.
  frames(rig, 5, []);
  assert.equal(two(rig).phase, "active", "inside the grace period");
  assert.equal(rig.view.holding, true);
  frames(rig, 20, []);
  assert.equal(two(rig).phase, "inactive");
  assert.equal(rig.controller.grab.phase, "idle");
  assert.equal(rig.view.holding, false);
  assert.equal(rig.view.hint, "none");
  assert.equal(rig.view.mode, "none");
  assertFiniteGroup(rig.group);

  settle(rig, [], 240);
  near(rig.group.position.x, held, "stays where it was", 1e-3);
  near(rig.group.scale.x, two(rig).desired.scale, "keeps its scale", 1e-3);
});

test("15b. one huge frame without hands releases at once", () => {
  const rig = makeRig();
  activate(rig);
  frame(rig, [], 2);
  assert.equal(two(rig).phase, "inactive");
  assert.equal(rig.view.holding, false);
  assertFiniteGroup(rig.group);
});

test("15c. invalid samples count as missing", () => {
  const rig = makeRig();
  activate(rig);
  const bad = pair(0, 0, 1).map((sample) => ({ ...sample, valid: false }));
  frames(rig, 4, bad);
  assert.equal(two(rig).phase, "active");
  frames(rig, 20, bad);
  assert.equal(two(rig).phase, "inactive");
});

test("15d. a changed handedness label ends the transform without sticking", () => {
  const rig = makeRig();
  activate(rig);
  frame(rig, [hand("Left", -1, 0, CLOSED, { handedness: "Right" }), hand("Right", 1, 0)]);
  assert.equal(two(rig).phase, "inactive");
  assert.equal(two(rig).endedForced, true);
  assert.equal(two(rig).remainingKey, null, "no single grab is handed to either hand");

  // The controller is free again: correct labels re-activate from the current transform.
  const before = snapshot(rig.group);
  frames(rig, START + 2, pair(0, 0, 1));
  assert.equal(two(rig).phase, "active");
  near(rig.group.position.x, before.x, "no jump on re-activation", 1e-9);
});

test("15e. a hand that teleports ends the transform instead of tearing the formation", () => {
  const rig = makeRig();
  activate(rig);
  frame(rig, [hand("Left", -1, 0), hand("Right", 9, 0)]);
  assert.equal(two(rig).phase, "inactive");
  assert.equal(two(rig).endedForced, true);
  assertFiniteGroup(rig.group);
});

test("15f. two samples sharing a key are ambiguous and treated as missing", () => {
  const rig = makeRig();
  activate(rig);
  const doubled = [hand("Left", -1, 0), hand("Right", 1, 0), hand("Right", 5, 5)];
  frames(rig, 4, doubled);
  assert.equal(two(rig).phase, "active");
  frames(rig, 20, doubled);
  assert.equal(two(rig).phase, "inactive");
});

/* ---------- pointer conversion ---------- */

test("17. the pointer stays correct after translation, rotation, and scaling", () => {
  const rig = makeRig();
  place(rig, 0.5, -0.25);
  activate(rig, 0, 0, 1);
  for (let step = 1; step <= 8; step += 1) {
    frame(rig, pair(0.2 * step, 0.1 * step, 1 + step * 0.125, step * 0.1));
  }
  settle(rig, pair(1.6, 0.8, 2, 0.8), 240);
  assertFiniteGroup(rig.group);
  assert.ok(rig.group.scale.x > 1.5, "scaled up");
  assert.ok(Math.abs(rig.group.rotation.z) > 0.5, "rotated");

  for (const world of [
    new THREE.Vector3(1, 2, 0),
    new THREE.Vector3(-2.5, 0.75, 0),
    new THREE.Vector3(0, 0, 0),
  ]) {
    const local = new THREE.Vector3();
    writeLocalTarget(rig.controller, rig.group, world, local);
    const back = rig.group.localToWorld(local.clone());
    near(back.x, world.x, "x round trip", 1e-9);
    near(back.y, world.y, "y round trip", 1e-9);
    near(back.z, world.z, "z round trip", 1e-9);
  }

  // The group's own origin is the local origin; a point one world unit along
  // the group's rotated x axis is 1/scale local units out.
  const origin = new THREE.Vector3();
  writeLocalTarget(rig.controller, rig.group, rig.group.position, origin);
  near(origin.length(), 0, "group origin is the local origin", 1e-9);
  const along = new THREE.Vector3(
    rig.group.position.x + Math.cos(rig.group.rotation.z),
    rig.group.position.y + Math.sin(rig.group.rotation.z),
    0,
  );
  const local = new THREE.Vector3();
  writeLocalTarget(rig.controller, rig.group, along, local);
  near(local.x, 1 / rig.group.scale.x, "local x", 1e-9);
  near(local.y, 0, "local y", 1e-9);
});

test("17b. with the camera off nothing changes the pointer path", () => {
  const rig = makeRig();
  frames(rig, 30, []);
  const world = new THREE.Vector3(1.25, -0.5, 0);
  const local = new THREE.Vector3();
  writeLocalTarget(rig.controller, rig.group, world, local);
  assert.deepEqual([local.x, local.y, local.z], [1.25, -0.5, 0]);
  assert.equal(rig.view.holding, false);
});

test("17c. the pointer is suspended for the whole two-hand interaction and restored after", () => {
  const rig = makeRig();
  const log = [];
  frames(rig, START - 1, pair(0, 0, 1));
  log.push(rig.view.holding);
  frame(rig, pair(0, 0, 1));
  log.push(rig.view.holding);
  frames(rig, 20, pair(0, 0, 1.2));
  log.push(rig.view.holding);
  frames(rig, RELEASE, pair(0, 0, 1.2, 0, OPEN));
  log.push(rig.view.holding);
  assert.deepEqual(log, [false, true, true, false]);
});

/* ---------- smoothing and bounds ---------- */

test("the transform eases instead of snapping", () => {
  const rig = makeRig();
  activate(rig);
  frame(rig, pair(0, 0, 1.5, 0.4));
  const alpha = 1 - Math.exp(-grabMotionConfig.followSmoothing * DT);
  near(rig.group.scale.x, 1 + alpha * 0.5, "one eased scale step", 1e-9);
  near(rig.group.rotation.z, alpha * 0.4, "one eased rotation step", 1e-9);
  assert.ok(rig.group.scale.x < 1.5 && rig.group.rotation.z < 0.4);
});

test("smoothing is frame-rate independent for scale and rotation", () => {
  const slow = makeRig();
  const fast = makeRig();
  activate(slow);
  activate(fast);
  frames(slow, 15, pair(0, 0, 1.5, 0.4), 1 / 30);
  frames(fast, 30, pair(0, 0, 1.5, 0.4), 1 / 60);
  near(slow.group.scale.x, fast.group.scale.x, "scale", 2e-3);
  near(slow.group.rotation.z, fast.group.rotation.z, "rotation", 2e-3);
});

test("setGrabBounds copies the extent and drives the limits from the camera", () => {
  const cam = camera(16 / 9);
  const shared = { x: 4, y: 3, z: 2 };
  const rig = makeRig();
  setGrabBounds(rig.controller, cam, shared);
  assert.equal(rig.controller.camera, cam);
  assert.notEqual(rig.controller.extent, shared, "not aliased");
  shared.x = 99;
  assert.equal(rig.controller.extent.x, 4, "later changes to the measurement do not leak in");

  frame(rig, []);
  const expected = computeGrabLimits(cam, { x: 4, y: 3, z: 2 }, { x: 0, y: 0, z: 0 });
  near(rig.controller.limits.x, expected.x, "x limit");
  near(rig.controller.limits.y, expected.y, "y limit");

  setGrabBounds(rig.controller, null, shared);
  assert.equal(rig.controller.camera, null);
});

test("bounds account for the formation's scale and rotation", () => {
  const cam = camera(16 / 9);
  const extents = measureFormationExtents(createFormationTargets(2000, { min: -4, max: 4 }));
  const extent = extents.wave;
  const rig = makeRig();
  rig.controller.camera = cam;
  rig.controller.extent = extent;

  // Unscaled, unrotated.
  const baseline = computeGrabLimits(cam, extent, { x: 0, y: 0, z: 0 });
  // Scaled up and rolled a quarter turn.
  const rolled = transformedExtent(extent, Math.PI / 2, 2, { x: 0, y: 0, z: 0 });
  const rolledLimits = computeGrabLimits(cam, rolled, { x: 0, y: 0, z: 0 });
  assert.ok(rolledLimits.y < baseline.y, "taller after the roll, so less room vertically");

  // Drive the real transform and watch the limits tighten.
  activate(rig, 0, 0, 1);
  for (let step = 1; step <= 12; step += 1) {
    frame(rig, pair(0, 0, 1 + step * 0.125, (step * Math.PI) / 24));
  }
  settle(rig, pair(0, 0, 2.5, Math.PI / 2), 200);
  assert.ok(rig.controller.limits.x < baseline.x, "x limit tightened by scale/rotation");
  assert.ok(rig.controller.limits.y < baseline.y, "y limit tightened by scale/rotation");
});

test("the formation is held inside the transformed limits however far the hands go", () => {
  const cam = camera(16 / 9);
  const extents = measureFormationExtents(createFormationTargets(2000, { min: -4, max: 4 }));
  const rig = makeRig();
  rig.controller.camera = cam;
  rig.controller.extent = extents.galaxy;

  activate(rig, 0, 0, 1);
  let worstX = 0;
  let worstY = 0;
  for (let step = 1; step <= 80; step += 1) {
    frame(rig, pair(step * 0.4, step * 0.25, 1 + step * 0.05, step * 0.04));
    worstX = Math.max(worstX, Math.abs(rig.group.position.x) - rig.controller.limits.x);
    worstY = Math.max(worstY, Math.abs(rig.group.position.y) - rig.controller.limits.y);
  }
  settle(rig, pair(32, 20, 5, 3.2), 240);
  assertFiniteGroup(rig.group);
  assert.ok(Math.abs(rig.group.position.x) <= rig.controller.limits.x + 1e-6);
  assert.ok(Math.abs(rig.group.position.y) <= rig.controller.limits.y + 1e-6);
  // Position easing lags the limits while scale and rotation shrink them
  // quickly. The overshoot is a transient of under a world unit, and the
  // settled position above is strictly inside.
  assert.ok(worstX < 1 && worstY < 1, `transient overshoot ${worstX}, ${worstY}`);
});

test("no dead zone against the position limits during two-hand moves", () => {
  const rig = makeRig({ x: 2, y: 2, z: 0 });
  activate(rig, 0, 0, 1);
  for (let step = 1; step <= 16; step += 1) {
    frame(rig, pair(step * 0.5, 0, 1));
  }
  settle(rig, pair(8, 0, 1), 120);
  near(rig.group.position.x, 2, "pinned at the limit", 1e-3);
  settle(rig, pair(7, 0, 1), 120);
  near(rig.group.position.x, 1, "moving back responds at once", 1e-3);
});

test("a formation switch that tightens the limits eases the transformed group back inside", () => {
  const cam = camera(16 / 9);
  const extents = measureFormationExtents(createFormationTargets(2000, { min: -4, max: 4 }));
  const rig = makeRig();
  rig.controller.camera = cam;
  rig.controller.extent = extents.nebula;
  place(rig, 0, 0, 0, 1);
  activate(rig, 0, 0, 1);
  for (let step = 1; step <= 10; step += 1) {
    frame(rig, pair(step, 0, 1 + step * 0.05));
  }
  settle(rig, pair(10, 0, 1.5), 200);

  rig.controller.extent = { x: 6, y: 6, z: 3 };
  settle(rig, pair(10, 0, 1.5), 240);
  assertFiniteGroup(rig.group);
  assert.ok(Math.abs(rig.group.position.x) <= rig.controller.limits.x + 1e-6);
});

test("the two-hand controller stays allocation-stable between frames", () => {
  const rig = makeRig();
  activate(rig);
  const { grab, limits, two: engine } = rig.controller;
  const position = rig.group.position;
  const scale = rig.group.scale;
  const desired = engine.desired;
  frames(rig, 60, pair(0.1, 0.1, 1.2, 0.2));
  assert.equal(rig.controller.grab, grab);
  assert.equal(rig.controller.limits, limits);
  assert.equal(rig.controller.two, engine);
  assert.equal(engine.desired, desired);
  assert.equal(rig.group.position, position);
  assert.equal(rig.group.scale, scale);
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
