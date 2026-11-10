/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS script */
"use strict";

/**
 * Logic tests for the grab interaction engine.
 *
 * The project has no test framework, so this follows the existing approach:
 * transpile the TypeScript modules with the installed `typescript` package into
 * a temp folder, rewrite the "@/" imports, and run plain assertions.
 *
 * Run from the app folder:  node scripts/test-grab-engine.cjs
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ts = require(path.join(root, "node_modules", "typescript"));

const MODULES = [
  "src/lib/grab-config.ts",
  "src/lib/grab-pinch.ts",
  "src/lib/grab-interaction.ts",
];

const out = fs.mkdtempSync(path.join(os.tmpdir(), "grab-engine-"));

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

const { grabConfig } = require(path.join(out, "src/lib/grab-config.js"));
const { measurePinchRatio, nextPinchClosed } = require(
  path.join(out, "src/lib/grab-pinch.js"),
);
const { createGrabState, stepGrab, resetGrabOrigin } = require(
  path.join(out, "src/lib/grab-interaction.js"),
);

const DT = 1 / 60;
const CLOSED = 0.2;
const OPEN = 0.8;
const ORIGIN = { x: 0, y: 0, z: 0 };

const results = [];

function test(name, body) {
  try {
    body();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}

function near(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${label ?? "value"}: expected ${expected}, got ${actual}`,
  );
}

function nearPoint(point, x, y, z, label) {
  near(point.x, x, `${label ?? "point"}.x`);
  near(point.y, y, `${label ?? "point"}.y`);
  near(point.z, z, `${label ?? "point"}.z`);
}

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

function newState() {
  return createGrabState({ x: 0, y: 0, z: 0 });
}

function step(state, samples, dt = DT, origin = ORIGIN) {
  stepGrab(state, samples, dt, origin);
  return state;
}

function grabbed(key = "Right", x = 0.5, y = 0.5) {
  const state = newState();
  for (let frame = 0; frame < grabConfig.startFrames; frame += 1) {
    step(state, [hand(key, x, y)]);
  }
  assert.equal(state.phase, "grabbing");
  return state;
}

/* ---------- pinch measurement ---------- */

function landmarks({ palm = 0.2, pinch = 0.07 } = {}) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  points[0] = { x: 0.5, y: 0.8, z: 0 };
  points[9] = { x: 0.5, y: 0.8 - palm, z: 0 };
  points[4] = { x: 0.4, y: 0.5, z: 0.4 };
  points[8] = { x: 0.4 + pinch, y: 0.5, z: -0.4 };
  return points;
}

test("pinch ratio is thumb-to-index distance in palm lengths, ignoring depth", () => {
  near(measurePinchRatio(landmarks({ pinch: 0.07 })), 0.35, "ratio");
  near(measurePinchRatio(landmarks({ pinch: 0.04 })), 0.2, "ratio");
});

test("pinch ratio is independent of how large the hand appears", () => {
  const near_ = measurePinchRatio(landmarks({ palm: 0.2, pinch: 0.07 }));
  const far = measurePinchRatio(landmarks({ palm: 0.1, pinch: 0.035 }));
  near(near_, far, "ratio");
});

test("pinch ratio can correct for a non-square frame", () => {
  near(measurePinchRatio(landmarks({ pinch: 0.04 }), 2), 0.4, "ratio");
});

test("pinch ratio is NaN when the palm is degenerate or landmarks are missing", () => {
  assert.ok(Number.isNaN(measurePinchRatio(landmarks({ palm: 0 }))));
  assert.ok(Number.isNaN(measurePinchRatio([])));
  assert.ok(Number.isNaN(measurePinchRatio(landmarks().slice(0, 9))));
});

test("pinch hysteresis closes below 0.35, opens above 0.55, and holds between", () => {
  assert.equal(nextPinchClosed(false, 0.3), true);
  assert.equal(nextPinchClosed(false, 0.45), false);
  assert.equal(nextPinchClosed(false, 0.35), false);
  assert.equal(nextPinchClosed(true, 0.45), true);
  assert.equal(nextPinchClosed(true, 0.55), true);
  assert.equal(nextPinchClosed(true, 0.6), false);
  assert.equal(nextPinchClosed(true, Number.NaN), true);
  assert.equal(nextPinchClosed(false, Number.NaN), false);
});

/* ---------- state machine ---------- */

test("1. no hand: idle", () => {
  const state = newState();
  for (let frame = 0; frame < 5; frame += 1) {
    step(state, []);
  }
  assert.equal(state.phase, "idle");
  assert.equal(state.started, false);
  assert.equal(state.ended, false);
  assert.equal(state.grabKey, null);
  assert.equal(state.suspendAttractor, false);
  nearPoint(state.desiredOrigin, 0, 0, 0);
});

test("2. one pinch frame: candidate, not grabbing", () => {
  const state = step(newState(), [hand("Right", 0.5, 0.5)]);
  assert.equal(state.phase, "candidate");
  assert.equal(state.candidateKey, "Right");
  assert.equal(state.candidateFrames, 1);
  assert.equal(state.started, false);
  assert.equal(state.suspendAttractor, false);
});

test("3. stable pinch within range: grabbing, started exactly once", () => {
  const state = newState();
  const started = [];
  for (let frame = 0; frame < 5; frame += 1) {
    step(state, [hand("Right", 0.5, 0.5)]);
    started.push(state.started);
  }
  assert.deepEqual(started, [false, false, true, false, false]);
  assert.equal(state.phase, "grabbing");
  assert.equal(state.grabKey, "Right");
  assert.equal(state.grabHandedness, "Right");
  assert.equal(state.suspendAttractor, true);
});

test("4. pinch outside the grab radius: no grab", () => {
  const state = newState();
  for (let frame = 0; frame < 10; frame += 1) {
    step(state, [hand("Right", grabConfig.grabRadius + 2, 0)]);
  }
  assert.equal(state.phase, "idle");
  assert.equal(state.candidateFrames, 0);
  assert.equal(state.started, false);
});

test("5. moving the hand: the formation follows with the original offset, no jump", () => {
  const state = newState();
  step(state, [hand("Right", 0.5, 0.5)]);
  step(state, [hand("Right", 0.5, 0.5)]);
  step(state, [hand("Right", 0.5, 0.5)]);
  assert.equal(state.started, true);
  nearPoint(state.desiredOrigin, 0, 0, 0, "origin at grab start");

  step(state, [hand("Right", 1.5, 1)]);
  nearPoint(state.desiredOrigin, 1, 0.5, 0, "after move 1");
  step(state, [hand("Right", 0.5, 2)]);
  nearPoint(state.desiredOrigin, 0, 1.5, 0, "after move 2");
  step(state, [hand("Right", -0.5, 2)]);
  nearPoint(state.desiredOrigin, -1, 1.5, 0, "after move 3");
});

test("5b. the offset is measured from the formation's current origin", () => {
  const state = newState();
  const formation = { x: 1, y: 1, z: 0 };
  for (let frame = 0; frame < 3; frame += 1) {
    step(state, [hand("Right", 2, 2)], DT, formation);
  }
  assert.equal(state.phase, "grabbing");
  nearPoint(state.desiredOrigin, 1, 1, 0, "origin at grab start");
  step(state, [hand("Right", 3, 2.5)], DT, formation);
  nearPoint(state.desiredOrigin, 2, 1.5, 0, "after move");
});

test("6. opening the pinch releases only after the required stable frames", () => {
  const state = grabbed("Right", 0.5, 0.5);
  step(state, [hand("Right", 1.5, 1.5)]);
  nearPoint(state.desiredOrigin, 1, 1, 0, "followed");

  step(state, [hand("Right", 2.5, 2.5, OPEN)]);
  step(state, [hand("Right", 2.5, 2.5, OPEN)]);
  assert.equal(state.phase, "grabbing");
  assert.equal(state.ended, false);
  nearPoint(state.desiredOrigin, 1, 1, 0, "frozen while opening");

  step(state, [hand("Right", 2.5, 2.5, OPEN)]);
  assert.equal(state.phase, "idle");
  assert.equal(state.ended, true);
  assert.equal(state.suspendAttractor, false);
  assert.equal(state.grabKey, null);
  step(state, [hand("Right", 2.5, 2.5, OPEN)]);
  assert.equal(state.ended, false);
});

test("6b. a pinch between the thresholds neither releases nor starts", () => {
  const state = grabbed("Right", 0.5, 0.5);
  for (let frame = 0; frame < 8; frame += 1) {
    step(state, [hand("Right", 0.5, 0.5, 0.45)]);
  }
  assert.equal(state.phase, "grabbing");

  const fresh = newState();
  for (let frame = 0; frame < 8; frame += 1) {
    step(fresh, [hand("Right", 0.5, 0.5, 0.45)]);
  }
  assert.equal(fresh.phase, "idle");
});

test("6c. closing again before release keeps the grab without a jump", () => {
  const state = grabbed("Right", 0.5, 0.5);
  step(state, [hand("Right", 1.5, 1.5)]);
  step(state, [hand("Right", 2.5, 2.5, OPEN)]);
  step(state, [hand("Right", 2.5, 2.5, OPEN)]);
  step(state, [hand("Right", 2, 2)]);
  assert.equal(state.phase, "grabbing");
  nearPoint(state.desiredOrigin, 1, 1, 0, "no jump on re-close");
  step(state, [hand("Right", 3, 3)]);
  nearPoint(state.desiredOrigin, 2, 2, 0, "follows again");
});

test("6d. a pinch that opens before the start frames never grabs", () => {
  const state = newState();
  step(state, [hand("Right", 0.5, 0.5)]);
  step(state, [hand("Right", 0.5, 0.5)]);
  step(state, [hand("Right", 0.5, 0.5, OPEN)]);
  assert.equal(state.phase, "idle");
  step(state, [hand("Right", 0.5, 0.5)]);
  assert.equal(state.candidateFrames, 1);
  step(state, [hand("Right", 0.5, 0.5)]);
  assert.equal(state.phase, "candidate");
  step(state, [hand("Right", 0.5, 0.5)]);
  assert.equal(state.phase, "grabbing");
});

test("6e. a missing sample resets a pending candidate", () => {
  const state = newState();
  step(state, [hand("Right", 0.5, 0.5)]);
  step(state, [hand("Right", 0.5, 0.5)]);
  step(state, []);
  assert.equal(state.phase, "idle");
  step(state, [hand("Right", 0.5, 0.5)]);
  assert.equal(state.candidateFrames, 1);
});

test("7. temporary missing sample: the grab survives the grace period without a jump", () => {
  const state = grabbed("Right", 0.5, 0.5);
  step(state, [hand("Right", 1, 1)]);
  nearPoint(state.desiredOrigin, 0.5, 0.5, 0, "followed");

  for (let frame = 0; frame < 5; frame += 1) {
    step(state, []);
    assert.equal(state.phase, "grabbing");
    assert.equal(state.ended, false);
    assert.equal(state.suspendAttractor, true);
    nearPoint(state.desiredOrigin, 0.5, 0.5, 0, "frozen during loss");
  }

  step(state, [hand("Right", 1.4, 1.1)]);
  assert.equal(state.phase, "grabbing");
  nearPoint(state.desiredOrigin, 0.5, 0.5, 0, "no jump on resume");
  step(state, [hand("Right", 2.4, 1.1)]);
  nearPoint(state.desiredOrigin, 1.5, 0.5, 0, "follows after resume");
});

test("7b. an invalid sample counts as lost, not as a release", () => {
  const state = grabbed("Right", 0.5, 0.5);
  step(state, [hand("Right", 0.5, 0.5, CLOSED, { valid: false })]);
  assert.equal(state.phase, "grabbing");
  step(state, [hand("Right", 0.5, 0.5, Number.NaN)]);
  assert.equal(state.phase, "grabbing");
});

test("8. prolonged missing sample: safe release, formation stays", () => {
  const state = grabbed("Right", 0.5, 0.5);
  step(state, [hand("Right", 1.5, 1.5)]);
  nearPoint(state.desiredOrigin, 1, 1, 0, "followed");

  for (let frame = 0; frame < 3; frame += 1) {
    step(state, [], 0.06);
    assert.equal(state.phase, "grabbing");
  }
  step(state, [], 0.06);
  assert.equal(state.phase, "idle");
  assert.equal(state.ended, true);
  assert.equal(state.suspendAttractor, false);
  nearPoint(state.desiredOrigin, 1, 1, 0, "held after loss");
});

test("8b. one very long frame without the hand releases at once", () => {
  const state = grabbed("Right", 0.5, 0.5);
  step(state, [], 0.5);
  assert.equal(state.phase, "idle");
  assert.equal(state.ended, true);
});

test("9. a different hand never inherits the grab", () => {
  const state = grabbed("Right", 0.5, 0.5);
  for (let frame = 0; frame < 3; frame += 1) {
    step(state, [hand("Left", 0.6, 0.6)], 0.06);
    assert.equal(state.phase, "grabbing");
    assert.equal(state.grabKey, "Right");
    nearPoint(state.desiredOrigin, 0, 0, 0, "frozen, not following Left");
  }
  step(state, [hand("Left", 0.6, 0.6)], 0.06);
  assert.equal(state.ended, true);
  assert.equal(state.phase, "idle");

  // Left was already pinching while Right held the formation: it must open
  // first, then close again, before it can start a grab of its own.
  for (let frame = 0; frame < 5; frame += 1) {
    step(state, [hand("Left", 0.6, 0.6)]);
  }
  assert.equal(state.phase, "idle");
  assert.equal(state.started, false);

  step(state, [hand("Left", 0.6, 0.6, OPEN)]);
  step(state, [hand("Left", 0.6, 0.6)]);
  assert.equal(state.phase, "candidate");
  assert.equal(state.started, false);
});

test("9b. a same-key sample that teleports is released and must reopen before regrabbing", () => {
  const state = grabbed("Right", 0.5, 0.5);
  step(state, [hand("Right", 3.5, 0.5)]);
  assert.equal(state.ended, true);
  assert.equal(state.phase, "idle");

  for (let frame = 0; frame < 10; frame += 1) {
    step(state, [hand("Right", 0.2, 0.2)]);
  }
  assert.equal(state.phase, "idle");

  step(state, [hand("Right", 0.2, 0.2, OPEN)]);
  for (let frame = 0; frame < grabConfig.startFrames; frame += 1) {
    step(state, [hand("Right", 0.2, 0.2)]);
  }
  assert.equal(state.phase, "grabbing");
});

test("9c. a conflicting handedness label releases the grab", () => {
  const state = grabbed("Right", 0.5, 0.5);
  step(state, [hand("Right", 0.5, 0.5, CLOSED, { handedness: "Left" })]);
  assert.equal(state.ended, true);
  assert.equal(state.phase, "idle");
});

test("9d. two samples sharing the grabbed key are ambiguous and treated as lost", () => {
  const state = grabbed("Right", 0.5, 0.5);
  step(state, [hand("Right", 0.5, 0.5), hand("Right", 2, 2)], 0.06);
  assert.equal(state.phase, "grabbing");
  nearPoint(state.desiredOrigin, 0, 0, 0, "frozen");
  for (let frame = 0; frame < 3; frame += 1) {
    step(state, [hand("Right", 0.5, 0.5), hand("Right", 2, 2)], 0.06);
  }
  assert.equal(state.phase, "idle");

  const fresh = newState();
  for (let frame = 0; frame < 6; frame += 1) {
    step(fresh, [hand("Right", 0.5, 0.5), hand("Right", 0.6, 0.6)]);
  }
  assert.equal(fresh.phase, "idle");
});

test("9e. with two pinching hands, the one nearest the formation grabs", () => {
  const state = newState();
  for (let frame = 0; frame < grabConfig.startFrames; frame += 1) {
    step(state, [hand("Left", 2.5, 0), hand("Right", 0.5, 0)]);
  }
  assert.equal(state.phase, "grabbing");
  assert.equal(state.grabKey, "Right");
});

test("10. the formation stays at its last position after release", () => {
  const state = grabbed("Right", 0.5, 0.5);
  step(state, [hand("Right", 1.5, 1.5)]);
  for (let frame = 0; frame < 3; frame += 1) {
    step(state, [hand("Right", 1.5, 1.5, OPEN)]);
  }
  assert.equal(state.phase, "idle");
  nearPoint(state.desiredOrigin, 1, 1, 0, "at release");

  for (let frame = 0; frame < 30; frame += 1) {
    step(state, [], DT, { x: 9, y: 9, z: 9 });
  }
  nearPoint(state.desiredOrigin, 1, 1, 0, "after idle frames");
});

test("10b. resetGrabOrigin moves the resting origin and keeps a live grab seamless", () => {
  const idle = newState();
  resetGrabOrigin(idle, { x: 1, y: 2, z: 0 });
  nearPoint(idle.desiredOrigin, 1, 2, 0, "idle reset");

  const state = grabbed("Right", 0.5, 0.5);
  resetGrabOrigin(state, { x: 2, y: 2, z: 0 });
  step(state, [hand("Right", 0.5, 0.5)]);
  nearPoint(state.desiredOrigin, 2, 2, 0, "grab continues from the reset");
  step(state, [hand("Right", 1.5, 0.5)]);
  nearPoint(state.desiredOrigin, 3, 2, 0, "and follows the hand");
});

test("11. stepping reuses the same state objects", () => {
  const state = newState();
  const origin = state.desiredOrigin;
  const offset = state.offset;
  const samples = [hand("Right", 0.5, 0.5)];
  for (let frame = 0; frame < 20; frame += 1) {
    step(state, samples);
  }
  assert.equal(state.desiredOrigin, origin);
  assert.equal(state.offset, offset);
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
