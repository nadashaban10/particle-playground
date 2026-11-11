"use client";

import { useEffect, useRef, type RefObject } from "react";
import {
  BRIGHT_LANDMARKS,
  HAND_CONNECTIONS,
  LEFT_HAND_PALETTE,
  RIGHT_HAND_PALETTE,
  type HandPalette,
} from "@/shared/lib/hand-connections";
import { mapLandmark, readVideoLandmarkSpace } from "@/shared/lib/map-landmark";
import type { Handedness, Landmark, TrackedHand } from "@/shared/types/hand-tracking";

const SMOOTHING = 16;

type HandSkeletonProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  handsRef: RefObject<TrackedHand[]>;
};

type DrawnHand = {
  key: string;
  handedness: Handedness | null;
  landmarks: Landmark[];
};

export function HandSkeleton({ videoRef, handsRef }: HandSkeletonProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    let frameId = 0;
    let smoothed: DrawnHand[] = [];
    let lastTime = performance.now();

    const draw = (time: number) => {
      const delta = Math.min(0.05, (time - lastTime) / 1000);
      lastTime = time;
      const video = videoRef.current;
      const target = handsRef.current;

      if (!video || video.clientWidth === 0 || target.length === 0) {
        smoothed = [];
        clearCanvas(context, video);
      } else {
        smoothed = smoothHands(smoothed, target, delta);
        paintHands(context, video, smoothed);
      }

      frameId = requestAnimationFrame(draw);
    };

    frameId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [handsRef, videoRef]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
    />
  );
}

function smoothHands(
  current: DrawnHand[],
  targets: TrackedHand[],
  delta: number,
): DrawnHand[] {
  const used = new Set<string>();

  return targets.map((hand) => {
    const key = chooseKey(current, hand, used);
    used.add(key);
    const previous = current.find((item) => item.key === key);

    return {
      key,
      handedness: hand.handedness,
      landmarks: smoothLandmarks(previous?.landmarks ?? null, hand.landmarks, delta),
    };
  });
}

function chooseKey(
  current: DrawnHand[],
  hand: TrackedHand,
  used: Set<string>,
): string {
  if (hand.handedness && !used.has(hand.handedness)) {
    return hand.handedness;
  }

  let bestKey: string | null = null;
  let bestDistance = Infinity;

  for (const previous of current) {
    if (used.has(previous.key)) {
      continue;
    }
    if (isNamedHand(previous.key) && previous.key !== hand.handedness) {
      continue;
    }

    const wrist = previous.landmarks[0];
    if (!wrist) {
      continue;
    }

    const distance = Math.hypot(
      wrist.x - hand.position.x,
      wrist.y - hand.position.y,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestKey = previous.key;
    }
  }

  if (bestKey && bestDistance < 0.35) {
    return bestKey;
  }

  let index = 0;
  let key = `hand-${index}`;
  while (used.has(key)) {
    index += 1;
    key = `hand-${index}`;
  }
  return key;
}

function isNamedHand(key: string): key is Handedness {
  return key === "Left" || key === "Right";
}

function smoothLandmarks(
  current: Landmark[] | null,
  target: Landmark[],
  delta: number,
): Landmark[] {
  if (!current || current.length !== target.length) {
    return target.map((point) => ({ ...point }));
  }

  const alpha = 1 - Math.exp(-SMOOTHING * delta);

  return current.map((point, index) => ({
    x: point.x + (target[index].x - point.x) * alpha,
    y: point.y + (target[index].y - point.y) * alpha,
    z: point.z + (target[index].z - point.z) * alpha,
  }));
}

function clearCanvas(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
) {
  const width = video?.clientWidth ?? context.canvas.clientWidth;
  const height = video?.clientHeight ?? context.canvas.clientHeight;
  resizeCanvas(context, width, height);
  context.clearRect(0, 0, width, height);
}

function paintHands(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  hands: DrawnHand[],
) {
  const width = video.clientWidth;
  const height = video.clientHeight;
  resizeCanvas(context, width, height);
  context.clearRect(0, 0, width, height);

  const space = readVideoLandmarkSpace(video);
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const hand of hands) {
    paintSkeleton(context, space, hand.landmarks, paletteFor(hand));
  }
}

function paletteFor(hand: DrawnHand): HandPalette {
  if (hand.handedness === "Left" || hand.key === "Left") {
    return LEFT_HAND_PALETTE;
  }
  if (hand.handedness === "Right" || hand.key === "Right") {
    return RIGHT_HAND_PALETTE;
  }
  return hand.key === "hand-1" ? LEFT_HAND_PALETTE : RIGHT_HAND_PALETTE;
}

function paintSkeleton(
  context: CanvasRenderingContext2D,
  space: ReturnType<typeof readVideoLandmarkSpace>,
  landmarks: Landmark[],
  palette: HandPalette,
) {
  const points = landmarks.map((landmark) => mapLandmark(landmark, space));

  context.shadowBlur = 8;

  for (const [start, end] of HAND_CONNECTIONS) {
    const from = points[start];
    const to = points[end];
    if (!from || !to) {
      continue;
    }

    context.strokeStyle = palette.bone(start);
    context.shadowColor = context.strokeStyle;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const bright = BRIGHT_LANDMARKS.has(index);
    context.fillStyle = bright ? palette.bright : palette.point;
    context.shadowColor = bright ? palette.brightGlow : palette.pointGlow;
    context.shadowBlur = bright ? 12 : 6;
    context.beginPath();
    context.arc(point.x, point.y, bright ? 4.2 : 2.4, 0, Math.PI * 2);
    context.fill();
  }
}

function resizeCanvas(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const dpr = window.devicePixelRatio || 1;
  const bitmapWidth = Math.max(1, Math.round(width * dpr));
  const bitmapHeight = Math.max(1, Math.round(height * dpr));
  const canvas = context.canvas;

  if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
    canvas.width = bitmapWidth;
    canvas.height = bitmapHeight;
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}
