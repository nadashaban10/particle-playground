/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS script */
"use strict";

/**
 * Tests for V-sign formation switching: hold, once-per-hold, release rearm,
 * cooldown, wraparound, tracking loss, grab/two-hand conflicts, and that both
 * hands V-signing still fire only once.
 *
 * Run from the app folder:  node scripts/test-formation-switch.cjs
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

const MODULES = [
  "src/lib/grab-config.ts",
  "src/lib/grab-pinch.ts",
  "src/lib/grab-interaction.ts",
  "src/lib/two-hand-config.ts",
  "src/lib/two-hand-transform.ts",
  "src/lib/formations.ts",
  "src/lib/formation-switch-config.ts",
  "src/lib/formation-switch.ts",
  "src/lib/gesture-force-config.ts",
  "src/lib/hand-feedback-config.ts",
  "src/lib/gesture-forces.ts",
  "src/lib/hand-feedback.ts",
];

const out = fs.mkdtempSync(path.join(os.tmpdir(), "formation-switch-"));

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
const { FORMATION_NAMES } = load("formations");
const { formationSwitchConfig } = load("formation-switch-config");
const {
  createFormationSwitchState,
  createFormationSwitchRequest,
  stepFormationSwitch,
  publishFormationSwitch,
  takeFormationSwitchRequest,
  nextFormationName,
  resetFormationSwitch,
} = load("formation-switch");
const { createGrabState } = load("grab-interaction");
const { createTwoHandState } = load("two-hand-transform");
const {
  createHandFeedbackState,
  stepHandFeedback,
} = load("hand-feedback");
const { createGestureForceState, stepGestureForces } = load("gesture-forces");

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

const DT = 1 / 60;

function sample(key, gesture = "v_sign", extra = {}) {
  return {
    key,
    handedness: key === "Left" || key === "Right" ? key : null,
    pinchPoint: { x: 0, y: 0, z: 0 },
    palmPoint: { x: 0.2, y: -0.2, z: 0 },
    pinchRatio: 0.8,
    valid: true,
    gesture,
    palmValid: true,
    ...extra,
  };
}

function rig() {
  return {
    switch: createFormationSwitchState(),
    grab: createGrabState(),
    two: createTwoHandState(),
    request: createFormationSwitchRequest(),
    formation: "galaxy",
  };
}

function step(r, samples, formation = r.formation) {
  stepFormationSwitch(r.switch, samples, r.grab, r.two, formation, DT);
  publishFormationSwitch(r.switch, r.request);
  const taken = takeFormationSwitchRequest(r.request);
  if (taken !== null) {
    r.formation = taken;
  }
  return taken;
}

function run(r, samples, frames, formation) {
  const fired = [];
  for (let index = 0; index < frames; index += 1) {
    const next = step(r, samples, formation ?? r.formation);
    if (next !== null) {
      fired.push(next);
    }
  }
  return fired;
}

function holdFrames() {
  return Math.ceil(formationSwitchConfig.holdSeconds / DT) + 2;
}

function cooldownFrames() {
  return Math.ceil(formationSwitchConfig.cooldownSeconds / DT) + 2;
}

function releaseAndRearm(r) {
  run(r, [], Math.ceil(formationSwitchConfig.releaseGraceSeconds / DT) + 2);
  run(r, [], cooldownFrames());
}

/* ---------- next formation ---------- */

test("nextFormationName advances in toolbar order and wraps", () => {
  assert.equal(FORMATION_NAMES.join(","), "galaxy,sphere,nebula,wave");
  assert.equal(nextFormationName("galaxy"), "sphere");
  assert.equal(nextFormationName("sphere"), "nebula");
  assert.equal(nextFormationName("nebula"), "wave");
  assert.equal(nextFormationName("wave"), "galaxy");
});

/* ---------- hold threshold ---------- */

test("1. a V-sign must be held before it switches", () => {
  const r = rig();
  const early = run(r, [sample("Right")], Math.floor(0.3 / DT));
  assert.equal(early.length, 0);
  assert.equal(r.switch.phase, "holding");
  assert.ok(r.switch.progress > 0 && r.switch.progress < 1);

  const fired = run(r, [sample("Right")], holdFrames());
  assert.deepEqual(fired, ["sphere"]);
  assert.equal(r.formation, "sphere");
  assert.equal(r.switch.phase, "fired");
  near(r.switch.progress, 1);
});

test("1b. progress reaches 1 exactly when the hold completes", () => {
  const r = rig();
  run(r, [sample("Right")], holdFrames());
  near(r.switch.progress, 1);
  assert.equal(r.switch.fired, false, "fired is only true on the fire frame");
});

/* ---------- exactly once ---------- */

test("2. holding longer after the fire does not switch again", () => {
  const r = rig();
  const first = run(r, [sample("Right")], holdFrames());
  assert.deepEqual(first, ["sphere"]);
  const more = run(r, [sample("Right")], 120);
  assert.deepEqual(more, []);
  assert.equal(r.formation, "sphere");
  assert.equal(r.switch.phase, "fired");
});

test("2b. both hands showing V-sign still fire only once", () => {
  const r = rig();
  const both = [sample("Left"), sample("Right")];
  const fired = run(r, both, holdFrames());
  assert.deepEqual(fired, ["sphere"]);
  assert.deepEqual(run(r, both, 90), []);
  assert.equal(r.formation, "sphere");
});

/* ---------- release and rearm ---------- */

test("3. releasing the gesture rearms for the next switch", () => {
  const r = rig();
  run(r, [sample("Right")], holdFrames());
  assert.equal(r.formation, "sphere");

  releaseAndRearm(r);
  assert.equal(r.switch.phase, "idle");

  const again = run(r, [sample("Right")], holdFrames());
  assert.deepEqual(again, ["nebula"]);
  assert.equal(r.formation, "nebula");
});

test("3b. a brief flicker during the hold does not cancel (grace)", () => {
  const r = rig();
  run(r, [sample("Right")], Math.floor(0.35 / DT));
  // A couple of empty frames inside the grace window.
  run(r, [], 2);
  assert.equal(r.switch.phase, "holding");
  const fired = run(r, [sample("Right")], holdFrames());
  assert.equal(fired.length, 1);
});

test("3c. losing the V-sign longer than the grace cancels the charge", () => {
  const r = rig();
  run(r, [sample("Right")], Math.floor(0.35 / DT));
  run(r, [], Math.ceil(formationSwitchConfig.releaseGraceSeconds / DT) + 3);
  assert.equal(r.switch.phase, "idle");
  near(r.switch.progress, 0);
  assert.equal(r.formation, "galaxy");
});

/* ---------- cooldown ---------- */

test("4. cooldown blocks a new hold until it finishes", () => {
  const r = rig();
  run(r, [sample("Right")], holdFrames());
  // Release into cooldown, then immediately V-sign again before cooldown ends.
  run(r, [], Math.ceil(formationSwitchConfig.releaseGraceSeconds / DT) + 2);
  assert.equal(r.switch.phase, "cooldown");

  const during = run(r, [sample("Right")], Math.floor(0.2 / DT));
  assert.deepEqual(during, []);
  assert.ok(r.switch.phase === "cooldown" || r.switch.phase === "holding");

  // Finish cooldown while still holding: a new charge should start / complete.
  const later = run(r, [sample("Right")], holdFrames() + cooldownFrames());
  assert.ok(later.length >= 1);
  assert.equal(later[0], "nebula");
});

/* ---------- cycling ---------- */

test("5. four successive switches wrap through every formation", () => {
  const r = rig();
  const seen = [];
  for (let index = 0; index < 4; index += 1) {
    const fired = run(r, [sample("Right")], holdFrames());
    assert.equal(fired.length, 1);
    seen.push(fired[0]);
    releaseAndRearm(r);
  }
  assert.deepEqual(seen, ["sphere", "nebula", "wave", "galaxy"]);
  assert.equal(r.formation, "galaxy");
});

test("5b. either hand can trigger the same cycle", () => {
  const r = rig();
  assert.deepEqual(run(r, [sample("Left")], holdFrames()), ["sphere"]);
  releaseAndRearm(r);
  assert.deepEqual(run(r, [sample("Right")], holdFrames()), ["nebula"]);
});

/* ---------- conflicts ---------- */

test("6. an active grab blocks V-sign switching", () => {
  const r = rig();
  r.grab.phase = "grabbing";
  r.grab.grabKey = "Right";
  assert.deepEqual(run(r, [sample("Right")], holdFrames() * 2), []);
  assert.equal(r.formation, "galaxy");
  assert.equal(r.switch.phase, "idle");
});

test("6b. an active two-hand transform blocks V-sign switching", () => {
  const r = rig();
  r.two.phase = "active";
  r.two.keyA = "Left";
  r.two.keyB = "Right";
  assert.deepEqual(
    run(r, [sample("Left"), sample("Right")], holdFrames() * 2),
    [],
  );
  assert.equal(r.formation, "galaxy");
});

test("6c. starting a grab mid-charge cancels the hold", () => {
  const r = rig();
  run(r, [sample("Right")], Math.floor(0.4 / DT));
  assert.equal(r.switch.phase, "holding");
  r.grab.phase = "grabbing";
  r.grab.grabKey = "Right";
  run(r, [sample("Right")], 5);
  assert.equal(r.switch.phase, "idle");
  near(r.switch.progress, 0);
});

test("6d. open palm and fist never drive the switcher", () => {
  const r = rig();
  assert.deepEqual(run(r, [sample("Right", "open_palm")], holdFrames()), []);
  assert.deepEqual(run(r, [sample("Right", "closed_fist")], holdFrames()), []);
  assert.deepEqual(run(r, [sample("Right", "pinch")], holdFrames()), []);
  assert.deepEqual(run(r, [sample("Right", "point")], holdFrames()), []);
  assert.equal(r.formation, "galaxy");
});

/* ---------- tracking loss ---------- */

test("7. tracking loss mid-hold cancels safely", () => {
  const r = rig();
  run(r, [sample("Right")], Math.floor(0.4 / DT));
  run(r, [], 60);
  assert.equal(r.switch.phase, "idle");
  near(r.switch.progress, 0);
  assert.equal(r.formation, "galaxy");
});

test("7b. invalid or palm-less samples do not count as a V-sign", () => {
  const r = rig();
  run(r, [sample("Right", "v_sign", { valid: false })], holdFrames());
  run(r, [sample("Right", "v_sign", { palmValid: false })], holdFrames());
  assert.equal(r.formation, "galaxy");
});

test("7c. resetFormationSwitch clears everything", () => {
  const r = rig();
  run(r, [sample("Right")], holdFrames());
  resetFormationSwitch(r.switch);
  assert.equal(r.switch.phase, "idle");
  assert.equal(r.switch.requested, null);
  near(r.switch.progress, 0);
});

/* ---------- request drain ---------- */

test("8. publish + take delivers the request exactly once", () => {
  const state = createFormationSwitchState();
  const grab = createGrabState();
  const two = createTwoHandState();
  const request = createFormationSwitchRequest();

  for (let index = 0; index < holdFrames(); index += 1) {
    stepFormationSwitch(state, [sample("Right")], grab, two, "wave", DT);
    publishFormationSwitch(state, request);
  }

  assert.equal(takeFormationSwitchRequest(request), "galaxy");
  assert.equal(takeFormationSwitchRequest(request), null);
});

/* ---------- forces stay independent ---------- */

test("9. a V-sign produces no gesture force", () => {
  const forces = createGestureForceState();
  for (let index = 0; index < 60; index += 1) {
    stepGestureForces(forces, [sample("Right", "v_sign")], DT, []);
  }
  assert.equal(forces.count, 0);
});

test("9b. open palm still repels while the switcher is idle", () => {
  const forces = createGestureForceState();
  for (let index = 0; index < 60; index += 1) {
    stepGestureForces(forces, [sample("Right", "open_palm")], DT, []);
  }
  assert.equal(forces.count, 1);
  assert.equal(forces.forces[0].kind, "repel");
});

/* ---------- feedback ---------- */

test("10. HandFeedback shows v_sign while charging and pulses on fire", () => {
  const r = rig();
  const feedback = createHandFeedbackState();
  const forces = createGestureForceState();
  const hands = [sample("Right")];

  for (let index = 0; index < Math.floor(0.3 / DT); index += 1) {
    stepFormationSwitch(r.switch, hands, r.grab, r.two, r.formation, DT);
    stepHandFeedback(
      feedback,
      hands,
      r.grab,
      r.two,
      forces,
      { x: 0, y: 0 },
      DT,
      r.switch,
    );
  }

  const hand = feedback.hands.find((candidate) => candidate.key === "Right");
  assert.equal(hand.mode, "v_sign");
  assert.ok(hand.emphasis > 0.35);

  let switches = 0;
  for (let index = 0; index < holdFrames(); index += 1) {
    stepFormationSwitch(r.switch, hands, r.grab, r.two, r.formation, DT);
    if (r.switch.fired) {
      r.formation = r.switch.requested;
    }
    stepHandFeedback(
      feedback,
      hands,
      r.grab,
      r.two,
      forces,
      { x: 0, y: 0 },
      DT,
      r.switch,
    );
    if (hand.pulses.some((pulse) => pulse.active && pulse.kind === "switch" && pulse.age <= DT * 1.01)) {
      switches += 1;
    }
  }
  assert.equal(switches, 1);
});

test("10b. grab still wins over a simultaneous V-sign in feedback", () => {
  const feedback = createHandFeedbackState();
  const forces = createGestureForceState();
  const grab = createGrabState();
  const two = createTwoHandState();
  const formationSwitch = createFormationSwitchState();
  grab.phase = "grabbing";
  grab.grabKey = "Right";

  for (let index = 0; index < 40; index += 1) {
    stepHandFeedback(
      feedback,
      [sample("Right")],
      grab,
      two,
      forces,
      { x: 0, y: 0 },
      DT,
      formationSwitch,
    );
  }

  assert.equal(
    feedback.hands.find((candidate) => candidate.key === "Right").mode,
    "grab",
  );
});

/* ---------- robustness ---------- */

test("11. bad deltas never produce NaN or a stuck phase", () => {
  const r = rig();
  for (const dt of [0, -1, Number.NaN, Infinity, 5]) {
    stepFormationSwitch(r.switch, [sample("Right")], r.grab, r.two, "galaxy", dt);
  }
  assert.ok(Number.isFinite(r.switch.holdTime));
  assert.ok(Number.isFinite(r.switch.progress));
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
process.exit(failures === 0 ? 0 : 1);
