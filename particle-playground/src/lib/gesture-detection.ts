import type { GestureName, Landmark } from "@/types/hand-tracking";

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_TIP = 12;
const RING_TIP = 16;
const PINKY_TIP = 20;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const RING_MCP = 13;
const PINKY_MCP = 17;

const PINCH_DISTANCE = 0.06;

function distance(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function isExtended(tip: Landmark, knuckle: Landmark, wrist: Landmark): boolean {
  return distance(tip, wrist) > distance(knuckle, wrist) * 1.2;
}

export function detectGesture(landmarks: Landmark[]): GestureName {
  if (landmarks.length < 21) {
    return "none";
  }

  const wrist = landmarks[WRIST];
  const thumbTip = landmarks[THUMB_TIP];
  const indexTip = landmarks[INDEX_TIP];

  if (distance(thumbTip, indexTip) < PINCH_DISTANCE) {
    return "pinch";
  }

  const fingers = [
    isExtended(indexTip, landmarks[INDEX_MCP], wrist),
    isExtended(landmarks[MIDDLE_TIP], landmarks[MIDDLE_MCP], wrist),
    isExtended(landmarks[RING_TIP], landmarks[RING_MCP], wrist),
    isExtended(landmarks[PINKY_TIP], landmarks[PINKY_MCP], wrist),
  ];
  const extended = fingers.filter(Boolean).length;

  if (extended === 0) {
    return "closed_fist";
  }

  if (fingers[0] && extended === 1) {
    return "point";
  }

  if (extended >= 3) {
    return "open_palm";
  }

  return "none";
}
