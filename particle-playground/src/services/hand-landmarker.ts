import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarker as HandLandmarkerInstance,
} from "@mediapipe/tasks-vision";
import { detectGesture } from "@/lib/gesture-detection";
import type { Handedness, Landmark, TrackedHand } from "@/types/hand-tracking";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm";

const MODEL_ASSET =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

let landmarkerPromise: Promise<HandLandmarkerInstance> | null = null;

export function createHandLandmarker(): Promise<HandLandmarkerInstance> {
  if (!landmarkerPromise) {
    landmarkerPromise = loadHandLandmarker().catch((error: unknown) => {
      landmarkerPromise = null;
      throw error;
    });
  }

  return landmarkerPromise;
}

async function loadHandLandmarker(): Promise<HandLandmarkerInstance> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  const options = {
    baseOptions: {
      modelAssetPath: MODEL_ASSET,
    },
    runningMode: "VIDEO" as const,
    numHands: 2,
  };

  try {
    return await HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: "GPU" },
    });
  } catch {
    return HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: "CPU" },
    });
  }
}

export function readHands(
  landmarker: HandLandmarkerInstance,
  video: HTMLVideoElement,
  timestamp: number,
): TrackedHand[] {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return [];
  }

  const result = landmarker.detectForVideo(video, timestamp);

  return result.landmarks.map((landmarks, index) => {
    const points = landmarks.map(toLandmark);
    const label = result.handedness[index]?.[0]?.categoryName;

    return {
      handedness: toHandedness(label),
      landmarks: points,
      gesture: detectGesture(points),
    };
  });
}

function toLandmark(landmark: { x: number; y: number; z: number }): Landmark {
  return { x: landmark.x, y: landmark.y, z: landmark.z };
}

function toHandedness(label: string | undefined): Handedness {
  return label === "Left" ? "Left" : "Right";
}
