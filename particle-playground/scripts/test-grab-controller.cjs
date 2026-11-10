/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS script */
"use strict";

/**
 * Tests for connecting the grab engine to a parent group: smoothing, bounds,
 * pointer suspension, world -> local conversion, and cleanup behavior.
 *
 * Same approach as the other scripts: transpile the TypeScript modules with the
 * installed `typescript` package into a temp folder, rewrite "@/" imports, and
 * run plain assertions against real three.js objects.
 *
 * Run from the app folder:  node scripts/test-grab-controller.cjs
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

const out = fs.mkdtempSync(path.join(os.tmpdir(), "grab-controller-"));

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
const { formationConfig, createFormationTargets } = load("formations");
const {
  grabMotionConfig,
  measureFormationExtent,
  computeGrabLimits,
  clampOrigin,
  smoothingAlpha,
} = load("grab-motion");
const { measureFormationExtents } = load("formation-extents");
const { createGroupSpace, worldPointToLocal } = load("group-space");
const {
  createGrabController,
  createGrabView,
  stepGrabController,
  writeLocalTarget,
  nearestHandInRange,
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

function makeRig(limits = WIDE) {
  const group = new THREE.Group();
  group.updateMatrixWorld();
  const controller = createGrabController();
  Object.assign(controller.limits, limits);
  const view = createGrabView();
  return { group, controller, view };
}

function frame(rig, samples, dt = DT) {
  stepGrabController(rig.controller, rig.group, samples, dt, rig.view);
}

function frames(rig, count, samples, dt = DT) {
  for (let index = 0; index < count; index += 1) {
    frame(rig, samples, dt);
  }
}

/** Closes a pinch at (x, y) until the grab starts. */
function grab(rig, x = 0.5, y = 0.5, key = "Right") {
  frames(rig, grabConfig.startFrames, [hand(key, x, y)]);
  assert.equal(rig.controller.grab.phase, "grabbing");
}

function camera(aspect) {
  const cam = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

function assertFinite(group, label = "group") {
  for (const axis of ["x", "y", "z"]) {
    assert.ok(Number.isFinite(group.position[axis]), `${label}.${axis} must be finite`);
  }
}

/* ---------- pure helpers ---------- */

test("smoothingAlpha is delta-time aware, bounded, and handles bad input", () => {
  near(smoothingAlpha(10, 0), 0, "zero delta");
  near(smoothingAlpha(10, 1 / 60), 1 - Math.exp(-10 / 60), "one frame");
  assert.ok(smoothingAlpha(10, 1) < 1);
  assert.ok(smoothingAlpha(10, 1) > smoothingAlpha(10, 0.1));
  // Two half steps equal one whole step (frame-rate independence).
  const half = smoothingAlpha(10, 0.05);
  near(1 - (1 - half) * (1 - half), smoothingAlpha(10, 0.1), "composition");
  near(smoothingAlpha(10, Number.NaN), 0, "NaN delta");
  near(smoothingAlpha(10, -1), 0, "negative delta");
});

test("measureFormationExtent reports the per-axis extent and ignores sparse outliers", () => {
  const points = new Float32Array([
    1, 0.5, 0,
    -2, -0.5, 0.25,
    2, 0.25, -0.25,
    -1, 0, 0,
  ]);
  const full = measureFormationExtent(points, 1);
  near(full.x, 2, "x");
  near(full.y, 0.5, "y");
  near(full.z, 0.25, "z");

  const many = new Float32Array(300);
  for (let index = 0; index < 100; index += 1) {
    many[index * 3] = 1;
  }
  many[0] = 50;
  const trimmed = measureFormationExtent(many, 0.98);
  near(trimmed.x, 1, "outlier ignored");
  assert.deepEqual(
    Object.keys(measureFormationExtent(new Float32Array(0))).sort(),
    ["x", "y", "z"],
  );
});

test("measureFormationExtents covers every preset and includes the wave height", () => {
  const targets = createFormationTargets(2000, { min: -4, max: 4 });
  const extents = measureFormationExtents(targets);
  assert.deepEqual(Object.keys(extents).sort(), ["galaxy", "nebula", "sphere", "wave"]);
  for (const extent of Object.values(extents)) {
    assert.ok(extent.x > 0 && extent.y > 0 && extent.z > 0);
    assert.ok(extent.x <= 3.6 + 1e-6 && extent.z <= 3.6 + 1e-6);
  }
  assert.ok(extents.wave.y >= formationConfig.wave.amplitude - 1e-9);
  assert.ok(extents.galaxy.x > extents.galaxy.y, "galaxy is wider than thick");
  near(extents.sphere.x, formationConfig.sphere.radius, "sphere radius", 0.1);
});

test("computeGrabLimits keeps the stated share of the formation in view", () => {
  const extent = { x: 3, y: 1, z: 3 };
  const fraction = grabMotionConfig.minVisibleFraction;

  for (const aspect of [16 / 9, 1, 9 / 16]) {
    const cam = camera(aspect);
    const limits = computeGrabLimits(cam, extent, { x: 0, y: 0, z: 0 });
    assert.ok(limits.x >= 0 && limits.y >= 0);
    assert.equal(limits.z, 0);

    const halfHeight = Math.tan(Math.PI / 6) * (10 - extent.z);
    const halfWidth = halfHeight * aspect;
    if (halfWidth - extent.x * (2 * fraction - 1) > 0) {
      // The formation's inner edge at the front depth sits where it should.
      const inner = new THREE.Vector3(limits.x - extent.x, 0, extent.z).project(cam);
      near(inner.x, 1 - (2 * extent.x * fraction) / halfWidth, `inner edge @${aspect}`, 1e-6);
    }
    if (halfHeight - extent.y * (2 * fraction - 1) > 0) {
      const inner = new THREE.Vector3(0, limits.y - extent.y, extent.z).project(cam);
      near(inner.y, 1 - (2 * extent.y * fraction) / halfHeight, `inner edge y @${aspect}`, 1e-6);
    }
  }
});

test("computeGrabLimits floors at zero when the formation is wider than the view", () => {
  const limits = computeGrabLimits(camera(9 / 16), { x: 8, y: 9, z: 3 }, { x: 5, y: 5, z: 5 });
  assert.equal(limits.x, 0);
  assert.equal(limits.y, 0);
});

test("computeGrabLimits widens with the canvas aspect and shrinks for deeper formations", () => {
  const extent = { x: 2, y: 1, z: 1 };
  const wide = computeGrabLimits(camera(16 / 9), extent, { x: 0, y: 0, z: 0 });
  const tall = computeGrabLimits(camera(9 / 16), extent, { x: 0, y: 0, z: 0 });
  assert.ok(wide.x > tall.x);
  near(wide.y, tall.y, "y does not depend on aspect");
  const deep = computeGrabLimits(camera(16 / 9), { ...extent, z: 4 }, { x: 0, y: 0, z: 0 });
  assert.ok(deep.y < wide.y);
});

test("clampOrigin clamps x and y, locks z, and reports changes", () => {
  const limits = { x: 2, y: 1, z: 0 };
  const inside = { x: 1, y: -0.5, z: 0 };
  assert.equal(clampOrigin(limits, inside), false);
  const outside = { x: 5, y: -4, z: 0.3 };
  assert.equal(clampOrigin(limits, outside), true);
  assert.deepEqual(outside, { x: 2, y: -1, z: 0 });
});

test("nearestHandInRange ignores invalid and distant hands and prefers the nearest", () => {
  const origin = { x: 0, y: 0, z: 0 };
  const samples = [
    hand("Left", 2.5, 0),
    hand("Right", 1, 0),
    hand("hand-0", 0.1, 0, CLOSED, { valid: false }),
  ];
  assert.equal(nearestHandInRange(samples, origin, 3).key, "Right");
  assert.equal(nearestHandInRange([hand("Left", 3.5, 0)], origin, 3), null);
  assert.equal(nearestHandInRange([], origin, 3), null);
});

/* ---------- world <-> group space ---------- */

test("10. pointer coordinates stay correct after the group moves (translation)", () => {
  const group = new THREE.Group();
  group.position.set(3, -1, 0);
  group.updateMatrixWorld();
  const space = createGroupSpace();
  const local = new THREE.Vector3();
  worldPointToLocal(space, group, { x: 4, y: 2, z: 0 }, local);
  near(local.x, 1, "x");
  near(local.y, 3, "y");
  near(local.z, 0, "z");
});

test("10b. the conversion is a full inverse (rotation and scale round-trip)", () => {
  const group = new THREE.Group();
  group.position.set(2, 1, -1);
  group.rotation.set(0.3, -0.7, 0.5);
  group.scale.set(1.2, 0.8, 1.5);
  group.updateMatrixWorld();
  const space = createGroupSpace();
  const world = new THREE.Vector3(1.5, -2, 0.75);
  const local = new THREE.Vector3();
  worldPointToLocal(space, group, world, local);
  const back = group.localToWorld(local.clone());
  near(back.x, world.x, "x");
  near(back.y, world.y, "y");
  near(back.z, world.z, "z");
});

test("10c. an identity group leaves the pointer target untouched", () => {
  const group = new THREE.Group();
  group.updateMatrixWorld();
  const local = new THREE.Vector3();
  worldPointToLocal(createGroupSpace(), group, { x: 1.25, y: -0.5, z: 0.1 }, local);
  assert.deepEqual([local.x, local.y, local.z], [1.25, -0.5, 0.1]);
});

test("10d. writeLocalTarget follows the live group position each frame", () => {
  const rig = makeRig();
  const world = new THREE.Vector3(1, 1, 0);
  const local = new THREE.Vector3();
  frame(rig, []);
  writeLocalTarget(rig.controller, rig.group, world, local);
  near(local.x, 1, "before");

  grab(rig, 0.5, 0.5);
  frames(rig, 3, [hand("Right", 1.5, 0.5)]);
  frames(rig, 90, [hand("Right", 1.5, 0.5)]);
  writeLocalTarget(rig.controller, rig.group, world, local);
  near(local.x, 1 - rig.group.position.x, "after", 1e-9);
  near(local.y, 1 - rig.group.position.y, "after y", 1e-9);
});

/* ---------- grab lifecycle on a group ---------- */

test("1. the formation starts at its original position", () => {
  const rig = makeRig();
  frames(rig, 10, []);
  assert.deepEqual(
    [rig.group.position.x, rig.group.position.y, rig.group.position.z],
    [0, 0, 0],
  );
  assert.equal(rig.view.holding, false);
  assert.equal(rig.view.hint, "none");
});

test("2. a pinch near the formation starts a grab", () => {
  const rig = makeRig();
  let started = 0;
  for (let index = 0; index < 5; index += 1) {
    frame(rig, [hand("Right", 0.5, 0.5)]);
    if (rig.controller.grab.started) {
      started += 1;
    }
  }
  assert.equal(started, 1);
  assert.equal(rig.controller.grab.phase, "grabbing");
  assert.equal(rig.view.holding, true);
  assert.equal(rig.view.hint, "held");
});

test("3. a pinch far from the formation does not start a grab", () => {
  const rig = makeRig();
  frames(rig, 20, [hand("Right", grabConfig.grabRadius + 2, 0)]);
  assert.equal(rig.controller.grab.phase, "idle");
  assert.equal(rig.view.holding, false);
  near(rig.group.position.x, 0, "group");
});

test("3b. the grab radius follows the formation after it has moved", () => {
  const rig = makeRig();
  grab(rig, 0.5, 0.5);
  for (const x of [1.5, 2.5, 3.5, 4.5, 5.5]) {
    frames(rig, 5, [hand("Right", x, 0.5)]);
  }
  frames(rig, 60, [hand("Right", 5.5, 0.5)]);
  frames(rig, 4, [hand("Right", 5.5, 0.5, OPEN)]);
  assert.equal(rig.controller.grab.phase, "idle");
  const home = rig.group.position.x;
  assert.ok(home > grabConfig.grabRadius + 1, `home ${home}`);

  // A pinch back at the old home is now far from the formation.
  frames(rig, 10, [hand("Right", 0, 0, OPEN)]);
  frames(rig, 10, [hand("Right", 0, 0)]);
  assert.equal(rig.controller.grab.phase, "idle");
  // A pinch at the formation's new position grabs it.
  frames(rig, 10, [hand("Right", home, 0, OPEN)]);
  frames(rig, 4, [hand("Right", home, 0)]);
  assert.equal(rig.controller.grab.phase, "grabbing");
});

test("4. moving the hand moves the whole formation, with the original offset", () => {
  const rig = makeRig();
  grab(rig, 0.5, 0.5);
  frames(rig, 60, [hand("Right", 1.5, 1)]);
  near(rig.group.position.x, 1, "x", 1e-3);
  near(rig.group.position.y, 0.5, "y", 1e-3);
  assert.equal(rig.group.position.z, 0);
});

test("4b. the group eases toward the hand instead of snapping", () => {
  const rig = makeRig();
  grab(rig, 0, 0);
  frame(rig, [hand("Right", 1, 0)]);
  const firstStep = rig.group.position.x;
  assert.ok(firstStep > 0.05 && firstStep < 0.5, `first step ${firstStep}`);
  near(firstStep, smoothingAlpha(grabMotionConfig.followSmoothing, DT) * 1, "alpha step", 1e-9);
  let previous = firstStep;
  for (let index = 0; index < 30; index += 1) {
    frame(rig, [hand("Right", 1, 0)]);
    assert.ok(rig.group.position.x >= previous - 1e-12, "monotonic");
    assert.ok(rig.group.position.x <= 1 + 1e-9, "no overshoot");
    previous = rig.group.position.x;
  }
});

test("4c. smoothing is frame-rate independent", () => {
  const slow = makeRig();
  const fast = makeRig();
  grab(slow, 0, 0);
  grab(fast, 0, 0);
  frames(slow, 15, [hand("Right", 1, 0)], 1 / 30);
  frames(fast, 30, [hand("Right", 1, 0)], 1 / 60);
  near(slow.group.position.x, fast.group.position.x, "x at 0.5 s", 2e-3);
});

test("5. starting a grab does not cause a position jump", () => {
  const rig = makeRig();
  rig.group.position.set(1, -0.5, 0);
  rig.controller.grab.desiredOrigin.x = 1;
  rig.controller.grab.desiredOrigin.y = -0.5;
  rig.group.updateMatrixWorld();

  const trail = [];
  for (let index = 0; index < 8; index += 1) {
    frame(rig, [hand("Right", 2, 0.25)]);
    trail.push([rig.group.position.x, rig.group.position.y]);
  }
  assert.equal(rig.controller.grab.phase, "grabbing");
  for (const [x, y] of trail) {
    near(x, 1, "x stays put", 1e-9);
    near(y, -0.5, "y stays put", 1e-9);
  }
});

test("6. opening the pinch releases the formation", () => {
  const rig = makeRig();
  grab(rig, 0.5, 0.5);
  frames(rig, grabConfig.releaseFrames - 1, [hand("Right", 0.5, 0.5, OPEN)]);
  assert.equal(rig.controller.grab.phase, "grabbing");
  assert.equal(rig.view.holding, true);
  frame(rig, [hand("Right", 0.5, 0.5, OPEN)]);
  assert.equal(rig.controller.grab.phase, "idle");
  assert.equal(rig.view.holding, false);
  assert.equal(rig.view.hint, "near");
});

test("7. the formation stays where it was released", () => {
  const rig = makeRig();
  grab(rig, 0.5, 0.5);
  frames(rig, 60, [hand("Right", 2, 1)]);
  frames(rig, grabConfig.releaseFrames, [hand("Right", 2, 1, OPEN)]);
  assert.equal(rig.controller.grab.phase, "idle");
  const x = rig.group.position.x;
  const y = rig.group.position.y;

  frames(rig, 180, [hand("Right", -2, -1, OPEN)]);
  near(rig.group.position.x, x, "x after idle", 1e-6);
  near(rig.group.position.y, y, "y after idle", 1e-6);
  frames(rig, 60, []);
  near(rig.group.position.x, x, "x after hand left", 1e-6);
  near(rig.group.position.x, 1.5, "released at hand position + offset", 1e-3);
});

test("7b. an easing group settles on the released spot rather than snapping or drifting", () => {
  const rig = makeRig();
  grab(rig, 0, 0);
  frames(rig, 3, [hand("Right", 1, 0)]);
  frames(rig, grabConfig.releaseFrames, [hand("Right", 1, 0, OPEN)]);
  assert.equal(rig.controller.grab.phase, "idle");
  const atRelease = rig.group.position.x;
  frames(rig, 120, []);
  assert.ok(rig.group.position.x >= atRelease - 1e-12);
  near(rig.group.position.x, 1, "settles on the held target", 1e-3);
});

test("8/9. the pointer is suspended only while a grab is active", () => {
  const rig = makeRig();
  const log = [];
  const record = () => log.push(rig.view.holding);

  frames(rig, 3, []);
  record();
  frame(rig, [hand("Right", 0.5, 0.5)]);
  record();
  frame(rig, [hand("Right", 0.5, 0.5)]);
  record();
  assert.deepEqual(log, [false, false, false], "candidate frames keep the pointer");
  frame(rig, [hand("Right", 0.5, 0.5)]);
  record();
  frames(rig, 20, [hand("Right", 0.5, 0.5)]);
  record();
  assert.deepEqual(log.slice(3), [true, true], "suspended while grabbing");

  frames(rig, grabConfig.releaseFrames, [hand("Right", 0.5, 0.5, OPEN)]);
  record();
  frames(rig, 30, []);
  record();
  assert.deepEqual(log.slice(5), [false, false], "restored after release");
});

test("8b. an unrelated hand pinching elsewhere never suspends the pointer", () => {
  const rig = makeRig();
  frames(rig, 30, [hand("Left", 8, 4)]);
  assert.equal(rig.view.holding, false);
  assert.equal(rig.controller.grab.phase, "idle");
});

test("hint shows when a hand is close enough, and disappears when it leaves", () => {
  const rig = makeRig();
  frame(rig, [hand("Right", 1, 0, OPEN)]);
  assert.equal(rig.view.hint, "near");
  near(rig.view.hintPoint.x, 1, "hint x");
  frame(rig, [hand("Right", 6, 0, OPEN)]);
  assert.equal(rig.view.hint, "none");
  frame(rig, []);
  assert.equal(rig.view.hint, "none");
});

test("hint while holding tracks the held pinch point", () => {
  const rig = makeRig();
  grab(rig, 0.5, 0.5);
  frame(rig, [hand("Right", 1.25, 0.75)]);
  assert.equal(rig.view.hint, "held");
  near(rig.view.hintPoint.x, 1.25, "x");
  near(rig.view.hintPoint.y, 0.75, "y");
});

test("11. switching formation (new bounds) during or after a grab stays safe", () => {
  const cam = camera(16 / 9);
  const extents = measureFormationExtents(createFormationTargets(2000, { min: -4, max: 4 }));
  const rig = makeRig();

  // Pick the loosest and tightest presets from the measured data, so the
  // test does not depend on which preset happens to be which.
  const scratch = { x: 0, y: 0, z: 0 };
  const byLimit = Object.entries(extents)
    .map(([name, extent]) => [name, computeGrabLimits(cam, extent, { ...scratch }).x])
    .sort((a, b) => a[1] - b[1]);
  const [tightName, tightLimit] = byLimit[0];
  const [looseName, looseLimit] = byLimit[byLimit.length - 1];
  assert.ok(tightLimit < looseLimit, `${tightName} must be tighter than ${looseName}`);

  // Carry the formation right up to the loose preset's limit.
  computeGrabLimits(cam, extents[looseName], rig.controller.limits);
  grab(rig, 0, 0);
  for (let step = 1; step <= 40; step += 1) {
    frame(rig, [hand("Right", step * 0.4, 0)]);
  }
  frames(rig, 60, [hand("Right", 16, 0)]);
  assert.ok(rig.group.position.x <= looseLimit + 1e-9);
  assert.ok(rig.group.position.x > looseLimit - 0.05, "reached the loose limit");

  // Switch to the tighter preset mid-grab: the group eases back inside.
  computeGrabLimits(cam, extents[tightName], rig.controller.limits);
  frames(rig, 120, [hand("Right", 16, 0)]);
  assertFinite(rig.group);
  assert.ok(rig.group.position.x <= tightLimit + 1e-6);
  assert.equal(rig.controller.grab.phase, "grabbing");

  // Release, switch back to the looser preset: no snap, still valid and held.
  frames(rig, grabConfig.releaseFrames, [hand("Right", 16, 0, OPEN)]);
  const released = rig.group.position.x;
  computeGrabLimits(cam, extents[looseName], rig.controller.limits);
  frames(rig, 60, []);
  assertFinite(rig.group);
  near(rig.group.position.x, released, "stays put after switching", 1e-3);
});

test("11b. a formation outside the new limits eases back inside while idle", () => {
  const rig = makeRig({ x: 8, y: 4, z: 0 });
  grab(rig, 0, 0);
  for (let step = 1; step <= 20; step += 1) {
    frame(rig, [hand("Right", step * 0.4, 0)]);
  }
  frames(rig, 60, [hand("Right", 8, 0)]);
  frames(rig, grabConfig.releaseFrames, [hand("Right", 8, 0, OPEN)]);
  assert.ok(rig.group.position.x > 6);

  Object.assign(rig.controller.limits, { x: 3, y: 2, z: 0 });
  frames(rig, 120, []);
  near(rig.group.position.x, 3, "eased to the new limit", 1e-3);
});

test("12. disabling the camera during a grab releases cleanly and leaves a valid group", () => {
  const rig = makeRig();
  grab(rig, 0.5, 0.5);
  frames(rig, 60, [hand("Right", 1.5, 0.5)]);
  const held = rig.group.position.x;
  assert.equal(rig.view.holding, true);

  // The interaction source is emptied: no samples from now on.
  frames(rig, 5, [], DT);
  assert.equal(rig.view.holding, true, "inside the grace period");
  frames(rig, 20, [], DT);
  assert.equal(rig.controller.grab.phase, "idle");
  assert.equal(rig.view.holding, false);
  assert.equal(rig.view.hint, "none");
  assertFinite(rig.group);
  near(rig.group.position.x, held, "stays where it was", 1e-3);

  frames(rig, 60, []);
  near(rig.group.position.x, held, "does not drift", 1e-3);
});

test("12b. a single huge frame with no hand releases immediately and stays valid", () => {
  const rig = makeRig();
  grab(rig, 0.5, 0.5);
  frame(rig, [], 2);
  assert.equal(rig.controller.grab.phase, "idle");
  assert.equal(rig.view.holding, false);
  assertFinite(rig.group);
});

test("13. the formation stays within the visible limits however far the hand goes", () => {
  const limits = { x: 2, y: 1.5, z: 0 };
  const rig = makeRig(limits);
  grab(rig, 0, 0);
  let worstX = 0;
  let worstY = 0;
  for (let step = 1; step <= 60; step += 1) {
    frame(rig, [hand("Right", step * 0.5, step * 0.4)]);
    worstX = Math.max(worstX, Math.abs(rig.group.position.x));
    worstY = Math.max(worstY, Math.abs(rig.group.position.y));
  }
  frames(rig, 120, [hand("Right", 30, 24)]);
  worstX = Math.max(worstX, Math.abs(rig.group.position.x));
  worstY = Math.max(worstY, Math.abs(rig.group.position.y));
  assert.ok(worstX <= limits.x + 1e-9, `x ${worstX}`);
  assert.ok(worstY <= limits.y + 1e-9, `y ${worstY}`);
  near(rig.group.position.x, limits.x, "pinned at the edge", 1e-3);
  assert.equal(rig.group.position.z, 0);
});

test("13b. there is no dead zone: moving back from the edge moves the formation at once", () => {
  const rig = makeRig({ x: 2, y: 2, z: 0 });
  grab(rig, 0, 0);
  for (let step = 1; step <= 20; step += 1) {
    frame(rig, [hand("Right", step * 0.5, 0)]);
  }
  frames(rig, 90, [hand("Right", 10, 0)]);
  near(rig.group.position.x, 2, "at the edge", 1e-3);

  frames(rig, 90, [hand("Right", 9, 0)]);
  near(rig.group.position.x, 1, "moved back by the hand's distance", 1e-3);
});

test("13c. the live limits come from the real camera and measured formation bounds", () => {
  const cam = camera(16 / 9);
  const extents = measureFormationExtents(createFormationTargets(2000, { min: -4, max: 4 }));
  const rig = makeRig();
  computeGrabLimits(cam, extents.galaxy, rig.controller.limits);
  grab(rig, 0, 0);
  for (let step = 1; step <= 60; step += 1) {
    frame(rig, [hand("Right", step * 0.5, step * 0.3)]);
  }
  frames(rig, 120, [hand("Right", 30, 18)]);
  assert.ok(rig.controller.limits.x > 0 && rig.controller.limits.y > 0);
  assert.ok(rig.group.position.x <= rig.controller.limits.x + 1e-9);
  assert.ok(rig.group.position.y <= rig.controller.limits.y + 1e-9);
});

test("a second, non-pinching hand cannot take over a grab", () => {
  const rig = makeRig();
  grab(rig, 0.5, 0.5, "Right");
  frames(rig, 30, [hand("Right", 0.5, 0.5), hand("Left", 3, 3, OPEN)]);
  assert.equal(rig.controller.grab.grabKey, "Right");
  assert.equal(rig.controller.two.phase, "inactive");
  near(rig.group.position.x, 0, "unmoved by the other hand", 1e-6);
});

test("a second pinching hand hands the grab over to the two-hand transform (17B.4)", () => {
  const rig = makeRig();
  grab(rig, 0.5, 0.5, "Right");
  frames(rig, 30, [hand("Right", 0.5, 0.5), hand("Left", 3, 3)]);
  assert.equal(rig.controller.two.phase, "active");
  assert.equal(rig.controller.grab.phase, "idle");
  near(rig.group.position.x, 0, "and the formation did not jump", 1e-6);
});

test("the controller is allocation-stable between frames", () => {
  const rig = makeRig();
  const { grab: state, limits } = rig.controller;
  const position = rig.group.position;
  frames(rig, 30, [hand("Right", 0.5, 0.5)]);
  assert.equal(rig.controller.grab, state);
  assert.equal(rig.controller.limits, limits);
  assert.equal(rig.group.position, position);
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
