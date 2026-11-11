# Cosmic Canvas — Technical Guide

Deep reference for frontend engineers who want to maintain or extend the codebase. Descriptions match the implementation after Milestone 18.5.

---

## A. Application architecture

### Routes (`src/app`)

| Path | Composition |
|------|-------------|
| `/` | `features/home` → `HomePage` |
| `/explore` | `features/explore` → `ExploreExperience` → guide → `ParticleScene` |
| `/studio` | `features/studio` → `StudioExperience` |
| `/camera` | Lab: `shared/components/camera/CameraHandTrackingPreview` |
| `/mediapipe/wasm/[name]` | Serves MediaPipe WASM/JS from `node_modules` |

### Feature ownership

- **`features/home`** — entry branding and experience cards.
- **`features/explore`** — particle scene UI, gesture guide, Explore toolbar, particle React components.
- **`features/studio`** — drawing UI + pure engine under `features/studio/lib`.
- **`features/hand-tracking`** — Explore camera card, interaction tracker, skeleton, onboarding (does not own Studio’s camera adapter).
- **`shared`** — camera preview, landmarker service, landmark hooks, gesture/grab/force/formation libs, types, `particleConfig`.

### State management

There is no global Redux/Zustand store.

| Domain | Ownership |
|--------|-----------|
| Particle physics | Typed arrays + refs; stepped in R3F `useFrame` |
| Explore hand world samples | Module sources (`handDetectionSource`, `handInteractionSource`) |
| Studio document | `EngineSession` held in a React ref; UI snapshot synced on coherent actions |
| Camera on/off | Local React state per experience |
| Studio draft | `localStorage` via `persist.ts` |

### Data flow (high level)

```
CameraPreview (getUserMedia)
  → useHandLandmarks (rAF + MediaPipe)
      → Explore: HandInteractionTracker → handDetectionSource → grab/forces/feedback
      → Studio: StudioHandCamera → tickStudioHandAdapter → createPointerApi(session)
```

Studio never publishes into the Explore detection bus.

---

## B. Particle engine

### Stack

- **Three.js** `Points` + `BufferGeometry` attributes: `position`, (velocity in parallel CPU arrays), `color`.
- **React Three Fiber** mounts the canvas; `ParticleSystem` / controllers read refs every frame.

### Representation

For `N = particleConfig.count` (default 10 000):

- `positions: Float32Array` length `3N` — xyz
- `velocities: Float32Array` length `3N`
- `colors: Float32Array` length `3N` — rgb in \[0,1\]

CPU owns integration; GPU renders points.

### Integration (`shared/lib/particle-motion.ts`)

Per frame, with clamped `Δt = min(delta, 0.05)`:

1. **Travel step**

\[
\text{step} = v_{\text{mult}} \cdot Δt \cdot s_{\text{ambient}}
\]

- \(v_{\text{mult}}\) = `velocityMultiplier`
- \(s_{\text{ambient}}\) = ambient speed scalar (formation/idle tuning)

2. **Pointer / target force** (attraction or repulsion)

If distance \(d\) to target is within `interactionRadius` \(R\):

\[
\text{falloff} = 1 - \frac{d}{R}
\]

\[
F = \sigma \cdot F_{\text{strength}} \cdot \text{falloff} \cdot Δt
\]

\[
\mathbf{v} \mathrel{+}= \hat{\mathbf{r}} \cdot F
\]

- \(\sigma = +1\) attraction, \(-1\) repulsion
- \(\hat{\mathbf{r}}\) = unit vector toward the target

3. **Gesture force fields** (open palm / fist), already converted to group-local space:

\[
\text{push} = M(d, R_f, c, S) \cdot Δt
\]

where \(M\) is `gestureForceMagnitude` (below).

4. **Formation spring** toward precomputed targets with strength \(k\):

\[
\mathbf{v} \mathrel{+}= (\mathbf{p}_{\text{target}} - \mathbf{p}) \cdot k \cdot Δt
\]

5. **Exponential damping**

\[
\text{drag} = e^{-\gamma Δt}, \quad \mathbf{v} \leftarrow \mathbf{v} \cdot \text{drag}
\]

- \(\gamma\) = `damping`

6. **Max speed clamp**, then Euler position update with wall bounce via `stepWithWalls`.

### Gesture field magnitude (`gestureForceMagnitude`)

Outside the core, force falls smoothly to zero at the radius:

\[
t = 1 - \frac{d}{R}, \quad M = S \cdot t^{2} \cdot \text{shape}
\]

Inside the core:

- Repulsion (\(S < 0\)): \(\text{shape} = d / c\) (zero at center — no singularity)
- Attraction (\(S > 0\)): \(\text{shape} = 2d/c - 1\) (soft shell so particles do not collapse to one point)

### Formations

Target positions live in Float32Arrays from `formations.ts` / related helpers. V-sign switching is a separate state machine (`formation-switch.ts`) with hold time, rearm, and conflict rules vs grab/two-hand.

### Performance notes

- No per-particle React state.
- Force field structs are reused (no per-frame allocation in the hot path).
- `Δt` clamped to limit spiral-of-death on tab switches.

---

## C. Hand tracking and computer vision

### Camera stream

`shared/components/camera/CameraPreview.tsx` is the **only** `getUserMedia` owner. Lifecycle phases: `idle` → `requesting` → `ready` | `error` | `ended`. Unmount stops tracks.

### MediaPipe

`shared/services/hand-landmarker.ts` acquires a shared Hands landmarker (GPU then CPU fallback), ref-counted. WASM is loaded through `/mediapipe/wasm/[name]`.

`shared/hooks/use-hand-landmarks.ts` runs `requestAnimationFrame`, detects when `video.currentTime` advances, and updates:

- `handsRef` (high frequency)
- React `handCount` / `status` only when those change

### Landmarks

MediaPipe returns **21 landmarks** per hand. Coordinates are normalized to the image:

- \(x, y \in [0,1]\) across width/height
- \(z\) relative depth (model space)

Application code distinguishes:

1. **Inference** — MediaPipe outputs landmarks.
2. **Interpretation** — `detectGesture`, pinch ratios, Studio/Explore adapters.

### Gesture classification (`gesture-detection.ts`)

Priority sketch:

1. Thumb–index distance &lt; threshold → `pinch`
2. No extended fingers → `closed_fist`
3. Only index extended → `point`
4. Index + middle extended → `v_sign`
5. ≥3 fingers extended → `open_palm`

Finger extension compares tip–wrist vs knuckle–wrist distances.

### Pinch ratio (`grab-pinch.ts`)

\[
\text{ratio} = \frac{\lVert \text{thumb} - \text{index} \rVert_{2D}}{\lVert \text{wrist} - \text{middle MCP} \rVert_{2D}}
\]

Aspect-corrected on \(x\). Hysteresis:

- Close when ratio &lt; `pinchCloseBelow` (0.35)
- Open when ratio &gt; `pinchOpenAbove` (0.55)
- Else keep previous state

### Explore vs Studio

| Concern | Explore | Studio |
|---------|---------|--------|
| World mapping | `map-hand-to-world` / interaction samples | `features/studio/lib/hand-coords` → board CSS px |
| Gestures | Forces, grab, two-hand, V-sign switch | Point draw, pinch move, two-hand scale, open-palm cancel |
| Bus | `handDetectionSource` | None (direct adapter) |

### Tracking loss

Studio uses ~220 ms grace (`STUDIO_HAND_CONFIG.lossGraceMs`) before committing/canceling an in-flight gesture. Explore grab/forces have their own grace/reentry rules in their modules.

### UX phases (`camera-experience.ts`)

Pure derivation: stream phase + tracker phase + hand count → copy for “waiting for permission”, “loading tracker”, “show a hand”, errors, retry.

---

## D. Creative Studio drawing engine

Location: `features/studio/lib/*`.

### Document model

`StudioDocument = { objects, nextZ, selectedId }`

- **Stroke**: points, color, width, `pencil` | `marker`, z
- **Shape**: kind, x/y/w/h, color, strokeWidth, filled, z  
  For lines, (x,y) is start and (w,h) is the delta to the end (may be negative).

IDs are stable strings; z-order sorts paint and hit-testing (top-most wins).

### Rendering

`render-canvas.ts`:

- HiDPI: `canvas.width = cssWidth * dpr`, `setTransform(dpr,0,0,dpr,0,0)` so the document stays in CSS pixels.
- Draws board wash + grid, objects by z, optional draft, then selection outline/handles.
- Export clones the document with `selectedId: null` so handles never appear in PNGs.

### Pointer abstraction

`engine.ts` exposes `pointerDown/Move/Up/Cancel` and `createPointerApi`. Mouse/touch (`StudioBoard`) and camera (`hand-adapter`) share it.

Physical pointer sets `session.physicalPointerActive`; the hand adapter yields and cancels camera gestures to avoid dual streams.

### Hit testing

Strokes: distance to segments vs half-width. Shapes: geometry tests; interiors count as hittable for select/erase even when drawn as outlines.

### History

Snapshot undo/redo (`history.ts`). One push per coherent user action (completed stroke, shape, move, resize, erase, clear) — not per pointer-move frame.

### Persistence

`persist.ts` — `localStorage` key `cosmic-canvas.studio.draft.v1`, `version: 1`, validated before restore. Save is debounced after document changes.

### PNG export

`export-png.ts` — offscreen canvas, same renderer, `toBlob('image/png')`, download via object URL.

---

## E. Coordinate calculations (Studio hand)

Selfie video is CSS-mirrored (`scaleX(-1)`). Board mapping mirrors \(x\) so motion matches the user’s left/right:

\[
n_x = 1 - x_{\text{landmark}}, \quad n_y = y_{\text{landmark}}
\]

\[
\text{stageX} = n_x \cdot W_{\text{stage}}, \quad \text{stageY} = n_y \cdot H_{\text{stage}}
\]

Client space:

\[
\text{clientX} = \text{stageRect.left} + \text{stageX}
\]

\[
\text{clientY} = \text{stageRect.top} + \text{stageY}
\]

Board space (document model):

\[
\text{boardX} = \text{clientX} - \text{boardRect.left}
\]

\[
\text{boardY} = \text{clientY} - \text{boardRect.top}
\]

Two-hand scale locks a baseline distance \(D_0\) between index tips, then applies

\[
f = \mathrm{clamp}\!\left(\frac{D}{D_0},\, 0.25,\, 4\right)
\]

re-applied each frame from a cloned object baseline (no compounding).

---

## F. Performance

| Technique | Where |
|-----------|--------|
| Refs + rAF / `useFrame` | Landmarks, particles, Studio cursor overlay |
| Coarse React state | Tool, undo flags, camera on/off, hand count |
| Shared landmarker | One instance across mounts (ref-count) |
| Single getUserMedia | `CameraPreview` only |
| Studio paint on demand | Redraw on pointer/camera mutation, not every React render |
| Cleanup | Stop tracks on unmount; cancel rAF; clear module sources when Explore camera stops |

Mobile: keep Studio PIP small (top-right); Explore PIP top-left clear of toolbars.

---

## G. Extension guide

### New particle formation

1. Add target generator in `shared/lib/formations.ts` (and extents if needed).
2. Extend `FORMATION_NAMES` / labels in Explore toolbar.
3. Update `explore-gestures` guide + `test-explore-gestures.cjs` if user-facing.
4. Wire V-sign cycle order in `formation-switch` if it should participate.

### New Explore gesture

1. Extend `detectGesture` / tests carefully (shared classifier).
2. Add Explore-only behavior in forces/grab/switch modules — do not overload Studio.
3. Update guide copy + tests.

### New Studio brush

1. Extend `BrushStyle` in `features/studio/lib/types.ts`.
2. Draw path in `render-canvas.ts`.
3. Expose in Studio UI + settings.

### New geometric shape

1. Add to `ShapeKind`.
2. Implement `shapeFromDrag`, bounds, hit-test, and canvas draw.
3. Add toolbar entry + engine/tests coverage.

### New Studio tool

1. Extend `StudioTool` and `pointerDown/Move/Up` branches in `engine.ts`.
2. Map camera behavior in `hand-gestures` / `hand-adapter` if needed.
3. Keep history granularity at “completed action” level.

### New shared component

Place under `shared/components` only if used by two+ features; otherwise keep it inside the owning feature.

---

## Validation

```bash
npm run typecheck
npm run lint
npm run build
```
