import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const WASM_PATH = "/mediapipe/wasm";
const MAX_HANDS = 2;

const MODEL_ASSET =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

let landmarkerPromise: Promise<HandLandmarker> | null = null;
let users = 0;

export function acquireHandLandmarker(): Promise<HandLandmarker> {
  users += 1;

  if (!landmarkerPromise) {
    landmarkerPromise = createHandLandmarker().catch((error: unknown) => {
      landmarkerPromise = null;
      throw error;
    });
  }

  return landmarkerPromise;
}

export async function releaseHandLandmarker(): Promise<void> {
  users = Math.max(0, users - 1);
  if (users > 0 || !landmarkerPromise) {
    return;
  }

  const pending = landmarkerPromise;
  landmarkerPromise = null;

  try {
    const landmarker = await pending;
    landmarker.close();
  } catch {
    // Initialization failed, so there is no detector to close.
  }
}

async function createHandLandmarker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
  const baseOptions = { modelAssetPath: MODEL_ASSET };
  const options = {
    runningMode: "VIDEO" as const,
    numHands: MAX_HANDS,
  };

  try {
    return await HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { ...baseOptions, delegate: "GPU" },
    });
  } catch {
    return HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { ...baseOptions, delegate: "CPU" },
    });
  }
}
