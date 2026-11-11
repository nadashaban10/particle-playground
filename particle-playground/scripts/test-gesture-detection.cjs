/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS script */
"use strict";

/**
 * Tests for landmark gesture classification, including the V-sign used by
 * formation switching. Same transpile approach as the other scripts.
 *
 * Run from the app folder:  node scripts/test-gesture-detection.cjs
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

const MODULES = ["src/lib/gesture-detection.ts"];
const out = fs.mkdtempSync(path.join(os.tmpdir(), "gesture-detection-"));

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

const { detectGesture, isVSign, isIndexPointing } = require(
  path.join(out, "src/lib/gesture-detection.js"),
);

const results = [];

function test(name, body) {
  try {
    body();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}

/** 21 landmarks resting near the wrist. */
function base() {
  const landmarks = [];
  for (let index = 0; index < 21; index += 1) {
    landmarks.push({ x: 0.5, y: 0.7, z: 0 });
  }
  landmarks[0] = { x: 0.5, y: 0.9, z: 0 }; // wrist
  landmarks[5] = { x: 0.45, y: 0.7, z: 0 }; // index MCP
  landmarks[9] = { x: 0.5, y: 0.7, z: 0 }; // middle MCP
  landmarks[13] = { x: 0.55, y: 0.7, z: 0 }; // ring MCP
  landmarks[17] = { x: 0.6, y: 0.7, z: 0 }; // pinky MCP
  // Tips start curled (near their MCP).
  landmarks[8] = { x: 0.45, y: 0.72, z: 0 };
  landmarks[12] = { x: 0.5, y: 0.72, z: 0 };
  landmarks[16] = { x: 0.55, y: 0.72, z: 0 };
  landmarks[20] = { x: 0.6, y: 0.72, z: 0 };
  landmarks[4] = { x: 0.28, y: 0.78, z: 0 }; // thumb tip, clearly not pinching
  return landmarks;
}

function extend(landmarks, tip, knuckle) {
  const wrist = landmarks[0];
  const kx = landmarks[knuckle].x - wrist.x;
  const ky = landmarks[knuckle].y - wrist.y;
  landmarks[tip] = {
    x: wrist.x + kx * 2.2,
    y: wrist.y + ky * 2.2,
    z: 0,
  };
}

function curl(landmarks, tip, knuckle) {
  landmarks[tip] = {
    x: landmarks[knuckle].x,
    y: landmarks[knuckle].y + 0.02,
    z: 0,
  };
}

function pinch(landmarks) {
  landmarks[4] = { ...landmarks[8] };
}

test("too few landmarks is none", () => {
  assert.equal(detectGesture([]), "none");
  assert.equal(detectGesture(base().slice(0, 10)), "none");
  assert.equal(isVSign([]), false);
});

test("closed fist: no fingers extended", () => {
  assert.equal(detectGesture(base()), "closed_fist");
});

test("point: only the index extended", () => {
  const landmarks = base();
  extend(landmarks, 8, 5);
  assert.equal(detectGesture(landmarks), "point");
  assert.equal(isIndexPointing(landmarks), true);
  assert.equal(isVSign(landmarks), false);
});

test("v_sign: index and middle extended, ring and pinky curled", () => {
  const landmarks = base();
  extend(landmarks, 8, 5);
  extend(landmarks, 12, 9);
  curl(landmarks, 16, 13);
  curl(landmarks, 20, 17);
  assert.equal(detectGesture(landmarks), "v_sign");
  assert.equal(isVSign(landmarks), true);
  assert.equal(isIndexPointing(landmarks), false);
});

test("v_sign ignores thumb position (out or tucked) as long as it is not a pinch", () => {
  const landmarks = base();
  extend(landmarks, 8, 5);
  extend(landmarks, 12, 9);
  landmarks[4] = { x: 0.2, y: 0.5, z: 0 }; // thumb far out
  assert.equal(detectGesture(landmarks), "v_sign");

  const tucked = base();
  extend(tucked, 8, 5);
  extend(tucked, 12, 9);
  tucked[4] = { x: 0.48, y: 0.75, z: 0 };
  assert.equal(detectGesture(tucked), "v_sign");
});

test("pinch wins over a V-shaped finger pose", () => {
  const landmarks = base();
  extend(landmarks, 8, 5);
  extend(landmarks, 12, 9);
  pinch(landmarks);
  assert.equal(detectGesture(landmarks), "pinch");
  assert.equal(isVSign(landmarks), true, "shape helper still sees the fingers");
});

test("open palm: three or more fingers extended is not a V-sign", () => {
  const landmarks = base();
  extend(landmarks, 8, 5);
  extend(landmarks, 12, 9);
  extend(landmarks, 16, 13);
  assert.equal(detectGesture(landmarks), "open_palm");
  assert.equal(isVSign(landmarks), false);

  const all = base();
  extend(all, 8, 5);
  extend(all, 12, 9);
  extend(all, 16, 13);
  extend(all, 20, 17);
  assert.equal(detectGesture(all), "open_palm");
});

test("index + ring (not middle) is none, not a V-sign", () => {
  const landmarks = base();
  extend(landmarks, 8, 5);
  extend(landmarks, 16, 13);
  assert.equal(detectGesture(landmarks), "none");
  assert.equal(isVSign(landmarks), false);
});

test("reject open palm, fist, and pinch as V-signs", () => {
  assert.equal(isVSign(base()), false);

  const palm = base();
  extend(palm, 8, 5);
  extend(palm, 12, 9);
  extend(palm, 16, 13);
  assert.equal(isVSign(palm), false);

  const pinching = base();
  extend(pinching, 8, 5);
  pinch(pinching);
  // Pinch helper is about tips; isVSign looks at extension only.
  assert.equal(detectGesture(pinching), "pinch");
});

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
process.exit(failures === 0 ? 0 : 1);
