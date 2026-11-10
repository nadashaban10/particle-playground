import { trailHandColors } from "@/lib/palettes";

/** Tune the finger-paint trails without touching the main particle cloud. */
export const paintTrailConfig = {
  maxParticles: 2000,
  spacing: 0.15,
  lifetime: 2,
  /** Longer jumps are treated as tracking loss and do not draw a connecting line. */
  maxSegment: 3.5,
  size: 0.09,
  leftColor: trailHandColors.left,
  rightColor: trailHandColors.right,
};
