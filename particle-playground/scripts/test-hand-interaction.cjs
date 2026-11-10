/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS script */
"use strict";

/**
 * Tests for the hand -> main-world interaction bridge: pinch-point mapping,
 * sample building, detection freshness, and cleanup.
 *
 * Same approach as test-grab-engine.cjs: transpile the TypeScript modules with
 * the installed `typescript` package into a temp folder, rewrite "@/" imports,
 * and run plain assertions.
 *
 * Run from the app folder:  node scripts/test-hand-interaction.cjs
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
  "src/lib/gesture-detection.ts",
  "src/lib/track-hands.ts",
  "src/lib/hand-world-config.ts",
  "src/lib/map-hand-to-world.ts",
  "src/lib/hand-interaction-samples.ts",
  "src/lib/hand-detection-source.ts",
  "src/lib/hand-interaction-source.ts",
];

const out = fs.mkdtempSync(path.join(os.tmpdir(), "hand-interaction-"));

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
const { measurePinchRatio } = load("grab-pinch");
const { handsFromDetection } = load("track-hands");
const { handWorldConfig } = load("hand-world-config");
const { createHandWorldMapper, mapFrameToWorld } = load("map-hand-to-world");
const { createHandInteractionBuilder, buildHandInteractionSamples } = load(
  "hand-interaction-samples",
);
const {
  handDetectionSource,
  publishHandDetection,
  clearHandDetection,
  isDetectionFresh,
} = load("hand-detection-source");
const {
  handInteractionSource,
  refreshHandInteractionSource,
  clearHandInteractionSource,
  resetHandInteraction,
} = load("hand-interaction-source");

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

const FOV = 60;
const CAMERA_Z = 10;
const HALF_HEIGHT = Math.tan((FOV * Math.PI) / 360) * CAMERA_Z;
const REGION = handWorldConfig.region;

function makeCamera(aspect) {
  const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 1000);
  camera.position.set(0, 0, CAMERA_Z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

/**
 * A hand whose wrist (0) and middle knuckle (9) are 0.2 apart vertically,
 * with the thumb tip (4) and index tip (8) placed explicitly.
 */
function makeLandmarks({
  thumb = { x: 0.45, y: 0.5, z: 0 },
  index = { x: 0.55, y: 0.5, z: 0 },
  wrist = { x: 0.5, y: 0.8, z: 0 },
  knuckle = { x: 0.5, y: 0.6, z: 0 },
} = {}) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  points[0] = { ...wrist };
  points[9] = { ...knuckle };
  points[4] = { ...thumb };
  points[8] = { ...index };
  return points;
}

function makeHand(handedness = "Right", options = {}) {
  const landmarks = options.landmarks ?? makeLandmarks(options);
  return {
    handedness,
    landmarks,
    gesture: "none",
    position: { ...(landmarks[0] ?? { x: 0, y: 0, z: 0 }) },
  };
}

const FRAME = { mirrored: false, aspect: 4 / 3 };

function build(hands, { aspect = 16 / 9, frame = FRAME, region } = {}) {
  const builder = createHandInteractionBuilder();
  const camera = makeCamera(aspect);
  const samples = buildHandInteractionSamples(
    builder,
    hands,
    camera,
    frame,
    region,
  );
  return { builder, camera, samples };
}

function worldX(u, aspect, region = REGION) {
  const n = Math.min(Math.max((u - region.minX) / (region.maxX - region.minX), 0), 1);
  return (n * 2 - 1) * HALF_HEIGHT * aspect;
}

function worldY(v, region = REGION) {
  const n = Math.min(Math.max((v - region.minY) / (region.maxY - region.minY), 0), 1);
  return (1 - n * 2) * HALF_HEIGHT;
}

/* ---------- verification list ---------- */

test("1. one detected hand produces one valid interaction sample", () => {
  const { samples } = build([makeHand("Right")]);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].valid, true);
  assert.equal(samples[0].key, "Right");
  assert.equal(samples[0].handedness, "Right");
});

test("2. two hands produce two independently identified samples", () => {
  const { samples } = build([
    makeHand("Left", { thumb: { x: 0.25, y: 0.5, z: 0 }, index: { x: 0.3, y: 0.5, z: 0 } }),
    makeHand("Right", { thumb: { x: 0.7, y: 0.5, z: 0 }, index: { x: 0.75, y: 0.5, z: 0 } }),
  ]);
  assert.equal(samples.length, 2);
  assert.deepEqual(samples.map((sample) => sample.key).sort(), ["Left", "Right"]);
  assert.ok(samples.every((sample) => sample.valid));
  const left = samples.find((sample) => sample.key === "Left");
  const right = samples.find((sample) => sample.key === "Right");
  assert.notEqual(left.pinchPoint, right.pinchPoint);
  assert.ok(left.pinchPoint.x < right.pinchPoint.x);
});

test("2b. hands without a handedness label get stable fallback keys", () => {
  const camera = makeCamera(16 / 9);
  const builder = createHandInteractionBuilder();
  const at = (x) =>
    makeHand(null, {
      thumb: { x, y: 0.5, z: 0 },
      index: { x: x + 0.05, y: 0.5, z: 0 },
      wrist: { x: x + 0.02, y: 0.8, z: 0 },
      knuckle: { x: x + 0.02, y: 0.6, z: 0 },
    });

  buildHandInteractionSamples(builder, [at(0.3), at(0.7)], camera, FRAME);
  const first = builder.samples.map((sample) => sample.key);
  assert.equal(new Set(first).size, 2);

  // Hands listed in the opposite order with small movement keep their keys.
  buildHandInteractionSamples(builder, [at(0.71), at(0.31)], camera, FRAME);
  const second = builder.samples.map((sample) => `${sample.key}:${sample.pinchPoint.x > 0}`);
  assert.deepEqual(
    second.sort(),
    [`${first[0]}:false`, `${first[1]}:true`].sort(),
  );
});

test("2c. two hands that share a handedness label still get distinct keys", () => {
  const { samples } = build([
    makeHand("Right", { thumb: { x: 0.3, y: 0.5, z: 0 }, index: { x: 0.35, y: 0.5, z: 0 } }),
    makeHand("Right", { thumb: { x: 0.7, y: 0.5, z: 0 }, index: { x: 0.75, y: 0.5, z: 0 } }),
  ]);
  assert.equal(samples.length, 2);
  assert.equal(new Set(samples.map((sample) => sample.key)).size, 2);
});

test("3. the pinch midpoint comes from landmarks 4 and 8 (not the index tip)", () => {
  const aspect = 16 / 9;
  const { samples } = build(
    [
      makeHand("Right", {
        thumb: { x: 0.3, y: 0.4, z: 0 },
        index: { x: 0.5, y: 0.6, z: 0 },
      }),
    ],
    { aspect },
  );
  const point = samples[0].pinchPoint;
  near(point.x, worldX(0.4, aspect), "x of midpoint (0.4)");
  near(point.y, worldY(0.5), "y of midpoint (0.5)");
  assert.ok(Math.abs(point.x - worldX(0.5, aspect)) > 0.5, "not the index tip");
});

test("3b. the pinch point takes z from the interaction plane, never from MediaPipe depth", () => {
  const { samples } = build([
    makeHand("Right", {
      thumb: { x: 0.45, y: 0.5, z: 0.4 },
      index: { x: 0.55, y: 0.5, z: -0.4 },
    }),
  ]);
  assert.equal(samples[0].pinchPoint.z, 0);

  const deeper = build([
    makeHand("Right", {
      thumb: { x: 0.45, y: 0.5, z: -0.9 },
      index: { x: 0.55, y: 0.5, z: -0.9 },
    }),
  ]).samples[0].pinchPoint;
  assert.equal(deeper.z, 0);
  near(deeper.x, samples[0].pinchPoint.x, "x unaffected by depth");
});

test("4. the pinch ratio is thumb-index distance in palm lengths, using the frame aspect", () => {
  const thumb = { x: 0.45, y: 0.5, z: 0 };
  const index = { x: 0.55, y: 0.5, z: 0 };
  const { samples } = build([makeHand("Right", { thumb, index })], {
    frame: { mirrored: false, aspect: 4 / 3 },
  });
  // 0.1 wide * (4/3) over a palm that is 0.2 tall.
  near(samples[0].pinchRatio, (0.1 * (4 / 3)) / 0.2, "ratio at 4:3");

  const square = build([makeHand("Right", { thumb, index })], {
    frame: { mirrored: false, aspect: 1 },
  }).samples[0].pinchRatio;
  near(square, 0.5, "ratio at 1:1");

  const direct = measurePinchRatio(makeLandmarks({ thumb, index }), 4 / 3);
  near(samples[0].pinchRatio, direct, "matches measurePinchRatio");
});

test("4b. an unusable frame aspect falls back to a square frame", () => {
  const { samples } = build([makeHand("Right")], {
    frame: { mirrored: false, aspect: 0 },
  });
  assert.equal(samples[0].valid, true);
  near(samples[0].pinchRatio, 0.5, "ratio");
});

test("5. invalid or missing landmarks never produce a valid sample", () => {
  const cases = {
    empty: makeHand("Right", { landmarks: [] }),
    tooShort: makeHand("Right", { landmarks: makeLandmarks().slice(0, 8) }),
    nanThumb: makeHand("Right", {
      thumb: { x: Number.NaN, y: 0.5, z: 0 },
    }),
    infiniteIndex: makeHand("Right", {
      index: { x: 0.5, y: Number.POSITIVE_INFINITY, z: 0 },
    }),
    flatPalm: makeHand("Right", {
      wrist: { x: 0.5, y: 0.6, z: 0 },
      knuckle: { x: 0.5, y: 0.6, z: 0 },
    }),
  };

  for (const [name, hand] of Object.entries(cases)) {
    const { samples } = build([hand]);
    assert.ok(
      samples.every((sample) => sample.valid === false),
      `${name} must not be valid`,
    );
  }

  const mixed = build([cases.nanThumb, makeHand("Left")]).samples;
  assert.equal(mixed.filter((sample) => sample.valid).length, 1);
  assert.equal(mixed.find((sample) => sample.valid).key, "Left");
});

test("6. mapping works across canvas aspect ratios (landscape, square, portrait)", () => {
  const mapper = createHandWorldMapper();
  const point = new THREE.Vector3();

  for (const aspect of [16 / 9, 1, 9 / 16]) {
    const camera = makeCamera(aspect);
    const halfWidth = HALF_HEIGHT * aspect;

    assert.ok(mapFrameToWorld(mapper, camera, 0.5, 0.5, false, point));
    near(point.x, 0, `centre x @${aspect}`);
    near(point.y, 0, `centre y @${aspect}`);
    near(point.z, 0, `centre z @${aspect}`);

    mapFrameToWorld(mapper, camera, REGION.maxX, REGION.minY, false, point);
    near(point.x, halfWidth, `right edge @${aspect}`);
    near(point.y, HALF_HEIGHT, `top edge @${aspect}`);

    mapFrameToWorld(mapper, camera, REGION.minX, REGION.maxY, false, point);
    near(point.x, -halfWidth, `left edge @${aspect}`);
    near(point.y, -HALF_HEIGHT, `bottom edge @${aspect}`);
  }
});

test("6b. points outside the active region clamp to the visible edge", () => {
  const mapper = createHandWorldMapper();
  const camera = makeCamera(16 / 9);
  const point = new THREE.Vector3();
  mapFrameToWorld(mapper, camera, 0.99, 0.01, false, point);
  near(point.x, HALF_HEIGHT * (16 / 9), "x clamps");
  near(point.y, HALF_HEIGHT, "y clamps");
  mapFrameToWorld(mapper, camera, -0.2, 1.4, false, point);
  near(point.x, -HALF_HEIGHT * (16 / 9), "x clamps low");
  near(point.y, -HALF_HEIGHT, "y clamps low");
});

test("6c. the active region is configurable", () => {
  const mapper = createHandWorldMapper();
  const camera = makeCamera(1);
  const point = new THREE.Vector3();
  const full = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  mapFrameToWorld(mapper, camera, 0.25, 0.25, false, point, full);
  near(point.x, -0.5 * HALF_HEIGHT, "x with full frame");
  near(point.y, 0.5 * HALF_HEIGHT, "y with full frame");

  const degenerate = { minX: 0.5, maxX: 0.5, minY: 0.5, maxY: 0.5 };
  assert.ok(mapFrameToWorld(mapper, camera, 0.25, 0.25, false, point, degenerate));
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
});

test("6d. the samples follow the camera they are given (canvas aspect)", () => {
  const hand = makeHand("Right", {
    thumb: { x: 0.7, y: 0.5, z: 0 },
    index: { x: 0.8, y: 0.5, z: 0 },
  });
  const wide = build([hand], { aspect: 16 / 9 }).samples[0].pinchPoint.x;
  const tall = build([hand], { aspect: 9 / 16 }).samples[0].pinchPoint.x;
  near(wide / tall, (16 / 9) / (9 / 16), "x scales with canvas aspect");
});

test("7. mirroring is consistent: x flips, y does not, and the ratio is unchanged", () => {
  const hand = () =>
    makeHand("Right", {
      thumb: { x: 0.6, y: 0.4, z: 0 },
      index: { x: 0.7, y: 0.4, z: 0 },
    });
  const plain = build([hand()], { frame: { mirrored: false, aspect: 4 / 3 } }).samples[0];
  const mirrored = build([hand()], { frame: { mirrored: true, aspect: 4 / 3 } }).samples[0];

  near(mirrored.pinchPoint.x, -plain.pinchPoint.x + 2 * worldX(0.5, 16 / 9), "x mirrored about centre");
  near(mirrored.pinchPoint.y, plain.pinchPoint.y, "y unchanged");
  near(mirrored.pinchRatio, plain.pinchRatio, "ratio unchanged");

  // A hand on the right side of the raw frame appears on the left of a mirrored view.
  assert.ok(plain.pinchPoint.x > 0);
  assert.ok(mirrored.pinchPoint.x < 0);
});

test("7b. the mirrored mapping agrees with the existing tracking pipeline convention", () => {
  // useHandPositions maps x -> 1 - x when the video is mirrored.
  const mapper = createHandWorldMapper();
  const camera = makeCamera(16 / 9);
  const direct = new THREE.Vector3();
  const flipped = new THREE.Vector3();
  mapFrameToWorld(mapper, camera, 0.3, 0.5, true, direct);
  mapFrameToWorld(mapper, camera, 1 - 0.3, 0.5, false, flipped);
  near(direct.x, flipped.x, "x");
});

test("8. a stale detection does not produce a fresh interaction sample", () => {
  const camera = makeCamera(16 / 9);
  const builder = createHandInteractionBuilder();
  const maxAge = handWorldConfig.maxDetectionAgeMs;

  publishHandDetection([makeHand("Right")], 1000, false, 4 / 3);

  const fresh = refreshHandInteractionSource(builder, camera, 1000 + maxAge);
  assert.equal(fresh.length, 1);
  assert.equal(handInteractionSource.current, fresh);

  const stale = refreshHandInteractionSource(builder, camera, 1000 + maxAge + 1);
  assert.equal(stale.length, 0);
  assert.equal(handInteractionSource.current.length, 0);
});

test("8b. before any detection nothing is published", () => {
  const camera = makeCamera(16 / 9);
  const builder = createHandInteractionBuilder();
  assert.equal(refreshHandInteractionSource(builder, camera, 5000).length, 0);
  assert.equal(isDetectionFresh(handDetectionSource, 5000, 250), false);
});

test("8c. a new detection after a stall makes the source fresh again", () => {
  const camera = makeCamera(16 / 9);
  const builder = createHandInteractionBuilder();
  publishHandDetection([makeHand("Right")], 1000, false, 4 / 3);
  assert.equal(refreshHandInteractionSource(builder, camera, 2000).length, 0);
  publishHandDetection([makeHand("Right")], 2000, false, 4 / 3);
  assert.equal(refreshHandInteractionSource(builder, camera, 2010).length, 1);
});

test("8d. an empty fresh detection publishes no hands", () => {
  const camera = makeCamera(16 / 9);
  const builder = createHandInteractionBuilder();
  publishHandDetection([], 1000, false, 4 / 3);
  assert.equal(refreshHandInteractionSource(builder, camera, 1010).length, 0);
});

test("9. disabling the camera clears the interaction source", () => {
  const camera = makeCamera(16 / 9);
  const builder = createHandInteractionBuilder();
  publishHandDetection([makeHand("Left"), makeHand("Right")], 1000, false, 4 / 3);
  assert.equal(refreshHandInteractionSource(builder, camera, 1010).length, 2);

  resetHandInteraction();

  assert.equal(handInteractionSource.current.length, 0);
  assert.equal(handDetectionSource.hands.length, 0);
  assert.equal(handDetectionSource.detectedAt, Number.NEGATIVE_INFINITY);
  assert.equal(refreshHandInteractionSource(builder, camera, 1010).length, 0);
});

test("9b. clearing the detection alone leaves nothing fresh to publish", () => {
  const camera = makeCamera(16 / 9);
  const builder = createHandInteractionBuilder();
  publishHandDetection([makeHand("Right")], 1000, false, 4 / 3);
  clearHandDetection();
  assert.equal(refreshHandInteractionSource(builder, camera, 1001).length, 0);
});

test("9c. clearing the interaction source empties it immediately", () => {
  const camera = makeCamera(16 / 9);
  const builder = createHandInteractionBuilder();
  publishHandDetection([makeHand("Right")], 1000, false, 4 / 3);
  refreshHandInteractionSource(builder, camera, 1001);
  assert.equal(handInteractionSource.current.length, 1);
  clearHandInteractionSource();
  assert.equal(handInteractionSource.current.length, 0);
});

test("10. raw MediaPipe-shaped output flows end to end into a sample", () => {
  const raw = makeLandmarks({
    thumb: { x: 0.4, y: 0.5, z: 0.1 },
    index: { x: 0.5, y: 0.5, z: -0.1 },
  });
  const hands = handsFromDetection([raw], [[{ categoryName: "Left" }]]);
  assert.equal(hands.length, 1);

  const camera = makeCamera(16 / 9);
  const builder = createHandInteractionBuilder();
  publishHandDetection(hands, 1000, true, 640 / 480);
  const samples = refreshHandInteractionSource(builder, camera, 1005);

  assert.equal(samples.length, 1);
  assert.equal(samples[0].key, "Left");
  assert.equal(samples[0].valid, true);
  // Mirrored: midpoint x = 0.45 -> display x = 0.55.
  near(samples[0].pinchPoint.x, worldX(0.55, 16 / 9), "x");
  near(samples[0].pinchRatio, (0.1 * (640 / 480)) / 0.2, "ratio");
});

test("11. building reuses its array and sample objects between frames", () => {
  const camera = makeCamera(16 / 9);
  const builder = createHandInteractionBuilder();
  const hand = makeHand("Right");

  const first = buildHandInteractionSamples(builder, [hand], camera, FRAME);
  const sample = first[0];
  const point = sample.pinchPoint;
  const second = buildHandInteractionSamples(builder, [hand], camera, FRAME);

  assert.equal(second, first);
  assert.equal(second[0], sample);
  assert.equal(second[0].pinchPoint, point);
});

test("11b. a hand that leaves the frame leaves no sample behind", () => {
  const camera = makeCamera(16 / 9);
  const builder = createHandInteractionBuilder();
  buildHandInteractionSamples(builder, [makeHand("Left"), makeHand("Right")], camera, FRAME);
  const samples = buildHandInteractionSamples(builder, [makeHand("Right")], camera, FRAME);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].key, "Right");
});

/* ---------- gesture and palm point (17B.5) ---------- */

test("12. samples carry the detector's raw gesture and a world-space palm centre", () => {
  const aspect = 16 / 9;
  const hand = makeHand("Right");
  hand.gesture = "open_palm";
  const { samples } = build([hand], { aspect });

  assert.equal(samples[0].gesture, "open_palm");
  // Palm = mean of the wrist and the four knuckles. Landmarks 5, 13, 17 are at
  // the fixture default (0.5, 0.5), 0 is (0.5, 0.8), 9 is (0.5, 0.6).
  near(samples[0].palmPoint.x, worldX(0.5, aspect), "palm x");
  near(samples[0].palmPoint.y, worldY((0.8 + 0.5 + 0.6 + 0.5 + 0.5) / 5), "palm y");
  near(samples[0].palmPoint.z, 0, "palm z");
  assert.notEqual(samples[0].palmPoint, samples[0].pinchPoint, "its own vector");
});

test("12b. the palm centre mirrors with the preview like the pinch point", () => {
  const aspect = 16 / 9;
  const landmarks = makeLandmarks();
  for (const index of [0, 5, 9, 13, 17]) {
    landmarks[index] = { x: 0.3, y: index === 0 ? 0.8 : 0.6, z: 0 };
  }
  const hand = makeHand("Left", { landmarks });
  hand.gesture = "closed_fist";

  const plain = build([hand], { aspect, frame: { mirrored: false, aspect: 4 / 3 } });
  const mirrored = build([hand], { aspect, frame: { mirrored: true, aspect: 4 / 3 } });
  near(plain.samples[0].palmPoint.x, worldX(0.3, aspect), "plain");
  near(mirrored.samples[0].palmPoint.x, worldX(0.7, aspect), "mirrored");
  assert.equal(mirrored.samples[0].gesture, "closed_fist");
});

test("12c. a gesture of none stays none, and an unmeasurable hand reports none", () => {
  const { samples } = build([makeHand("Right")]);
  assert.equal(samples[0].gesture, "none");

  const broken = makeHand("Left", { landmarks: makeLandmarks().slice(0, 5) });
  broken.gesture = "open_palm";
  const result = build([broken]).samples;
  assert.equal(result[0].valid, false);
  assert.equal(result[0].gesture, "none", "never a gesture on an invalid sample");
});

test("12d. a missing palm landmark means no gesture rather than a wrong position", () => {
  const landmarks = makeLandmarks();
  landmarks[13] = { x: Number.NaN, y: 0.5, z: 0 };
  const hand = makeHand("Right", { landmarks });
  hand.gesture = "open_palm";
  const { samples } = build([hand]);
  assert.equal(samples[0].valid, true, "the pinch itself is still measurable");
  assert.equal(samples[0].gesture, "none");
});

test("12e. a hand's gesture does not leak to the next frame or to a departed hand", () => {
  const camera = makeCamera(16 / 9);
  const builder = createHandInteractionBuilder();
  const palm = makeHand("Right");
  palm.gesture = "open_palm";
  buildHandInteractionSamples(builder, [palm], camera, FRAME);

  const next = buildHandInteractionSamples(builder, [makeHand("Right")], camera, FRAME);
  assert.equal(next[0].gesture, "none", "this frame's gesture replaces the last");
  assert.equal(builder.slots[1].sample.gesture, "none");

  buildHandInteractionSamples(builder, [palm], camera, FRAME);
  buildHandInteractionSamples(builder, [], camera, FRAME);
  assert.equal(builder.slots[1].sample.gesture, "none", "a departed hand keeps none");
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
