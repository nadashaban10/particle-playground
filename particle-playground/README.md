# Cosmic Canvas

Interactive creative playground for the browser. Shape living particle galaxies with your hands, or draw on a shared Creative Studio board with touch, mouse, or camera-based hand input.

## Project overview

Cosmic Canvas is a portfolio-ready web experience with two primary modes:

1. **Explore Galaxies** — a Three.js particle world you sculpt with MediaPipe hand tracking (and a mouse fallback).
2. **Creative Studio** — a playful 2D Canvas drawing board for freehand strokes and geometric shapes, with undo/redo, local draft persistence, PNG export, and optional hand control.

A compact **camera lab** at `/camera` remains available for isolated hand-tracking and paint-trail experiments. It is not required for the Home → Explore / Studio product path.

## Features

### Home
- Brand-first Cosmic Canvas entry with ambient motion.
- Clear CTAs into Explore Galaxies and Creative Studio.

### Explore Galaxies
- 10k-particle formations: galaxy, sphere, nebula, wave.
- Camera hand tracking: open palm (repel), fist (attract), pinch grab, two-hand transform, V-sign formation switch.
- Gesture guide that matches implemented behaviors.
- Formation / palette / camera toolbar.
- Reduced-motion aware feedback.

### Creative Studio
- One shared board for strokes and shapes (circle, square, rectangle, triangle, line).
- Pencil + marker brushes, color palette, brush size.
- Select, move, resize, erase, undo/redo, clear.
- Optional camera: point to draw, pinch to move, two hands to scale, open palm to pause.
- Local draft autosave and PNG export (artwork only, no UI chrome).

### Shared infrastructure
- Single `getUserMedia` owner (`CameraPreview`).
- Shared MediaPipe Tasks Vision landmarker (ref-counted).
- Camera lifecycle phases: permission, tracker load, waiting for hand, errors, retry.

## Technology stack

| Technology | Role | Why |
|------------|------|-----|
| **Next.js 16** (App Router) | Routing, SSR/static pages, WASM asset route | Clean product routes (`/`, `/explore`, `/studio`, `/camera`) |
| **React 19** | UI composition | Client islands for WebGL, camera, and canvas |
| **TypeScript** | Typed engines and UI | Pure drawing/gesture logic is testable without React |
| **Three.js** | WebGL particles | Direct buffer control for positions/velocities/colors |
| **React Three Fiber** | React bridge to Three.js | `useFrame` + refs keep physics off React state |
| **MediaPipe Tasks Vision** | Hand landmark inference | 21-point hands in the browser; no custom ML training |
| **HTML Canvas 2D** | Creative Studio renderer | Independent from the particle WebGL path |
| **Tailwind CSS 4** | Styling | Fast Cosmic visual system (Outfit + Fraunces) |

Unused libraries are not listed. `@react-three/drei` was removed in Milestone 18.5.

## Getting started

### Prerequisites
- Node.js 20+ recommended
- npm
- A browser with WebGL and (for camera features) `getUserMedia`
- **HTTPS or localhost** for camera permission

### Install

```bash
cd particle-playground
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Checks

```bash
npm run typecheck
npm run lint
npm run build
```

### Production

```bash
npm run build
npm start
```

### Environment variables

No required app secrets. MediaPipe WASM is served from `/mediapipe/wasm/[name]` out of `node_modules`.

### Deployment

Deploy the Next.js app as usual (Node server or a host that supports Next 16). Camera features need a secure context (HTTPS). Confirm `/`, `/explore`, `/studio`, and optionally `/camera` after deploy.

## Project structure

```
src/
  app/                      # Routes and layout only
    page.tsx                # Home
    explore/ page.tsx
    studio/ page.tsx
    camera/ page.tsx        # Optional lab
    mediapipe/wasm/[name]/ # MediaPipe assets

  features/
    home/                   # Home UI
    explore/                # Explore UI + particle scene components
    studio/                 # Studio UI + drawing engine (lib/)
    hand-tracking/          # Explore camera card, trackers, onboarding

  shared/
    components/camera/      # CameraPreview + lab preview shell
    config/                 # particleConfig
    hooks/                  # useHandLandmarks, etc.
    lib/                    # Gesture, grab, forces, formations, mapping…
    services/               # Hand landmarker acquire/release
    types/                  # Shared TypeScript types

docs/
  AUDIT_MILESTONE_18_5.md
  TECHNICAL_GUIDE.md
```

## Usage guide

### Explore Galaxies
1. Open **Explore Galaxies** from Home.
2. Read the gesture guide, then continue.
3. Enable the camera when prompted (or from the toolbar).
4. Use an open palm to push particles, a fist to pull, pinch to grab, two hands to transform, and a V-sign hold to cycle formations.
5. Without a camera, move the pointer to attract/repel (toolbar interaction mode).

### Creative Studio
1. Open **Creative Studio**.
2. Draw with mouse or touch; pick tools, colors, and brush size from the rail/dock.
3. Optionally enable **Camera**: point to draw, pinch to move, two hands to scale a selection, open palm to cancel an unfinished gesture.
4. Use **Export PNG** to download artwork; drafts autosave in `localStorage` and restore on return.

### Permissions
- Camera access is requested only when you enable it.
- Tracking stays on-device; there is no account or cloud sync.

## Known limitations

- Studio fist-to-erase is toolbar-only (camera fist is not mapped, to avoid grab conflicts).
- Studio hand UI clicks use pinch-over-control; dwell-click is not implemented.
- `/camera` is a lab route, not linked from Home.
- Particle and tracking performance depend on device GPU/CPU.

## License

Private portfolio project unless otherwise stated.
