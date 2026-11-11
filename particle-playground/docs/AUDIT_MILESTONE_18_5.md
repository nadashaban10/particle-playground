# Milestone 18.5 — Architecture Audit

Pre-change audit of Cosmic Canvas (`particle-playground/`). No structural edits were made before this report.

## Product surface

| Route | Role | Keep? |
|-------|------|-------|
| `/` | Home — Explore + Studio entry | Yes |
| `/explore` | Explore Galaxies | Yes |
| `/studio` | Creative Studio | Yes |
| `/camera` | Independent hand-tracking lab | Yes (meaningful for demos / isolation) |
| `/mediapipe/wasm/[name]` | MediaPipe asset route | Yes |

## Classification

### Must fix

1. Dead placeholders: `StudioComingSoon`, `Experience` / `ExperienceIntro`, `HandTrackingDemo`.
2. Unused dependency: `@react-three/drei` (no imports).
3. Layering: `lib/hand-positions.ts` imports `@/components/particles/particle-config` (lib → components).
4. Misplaced Explore chrome: `StudioToolbar` lives under `components/studio/` but serves Explore/`/camera`.
5. Boilerplate README; missing professional docs.

### Should improve

1. Split oversized `StudioExperience.tsx` (~800 lines).
2. Align folders to feature-based layout (`features/` + `shared/`).
3. Shared camera-card patterns between Explore and Studio hosts.
4. Focus-visible / dialog semantics on onboarding and Studio chrome.
5. Retire `@deprecated` coordinate aliases after call-site updates.

### Already well implemented

1. Clear IA: Home → Explore | Studio.
2. Modular `lib/studio/*` with engine + hand tests.
3. Explore gesture guide tied to real Stage 17 behaviors.
4. Shared `camera-experience` phases; Studio hand path isolated from Explore detection bus.
5. Strong pure-logic CJS tests for grab, two-hand, forces, formation, feedback, studio.
6. MediaPipe WASM route isolation; reduced-motion on home/feedback.

## Test inventory

Historical note: pure-logic `scripts/test-*.cjs` suites existed during development and were removed for the portfolio launch.
