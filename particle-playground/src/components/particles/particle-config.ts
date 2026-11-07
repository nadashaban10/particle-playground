import type { ParticleConfig } from "@/types/particles";

/** Change these values to experiment with the particle cloud. */
export const particleConfig = {
  count: 10_000,
  velocityMultiplier: 1.2,
  bounds: { min: -4, max: 4 },
  size: 0.045,
  colors: ["#7c3aed", "#38bdf8", "#e879f9"],
  background: "#05060f",
  cameraZ: 10,
  cameraFov: 60,
  interaction: "attraction",
  forceStrength: 3,
  target: { x: 0, y: 0, z: 0 },
  damping: 1.5,
  interactionRadius: 8,
  maxSpeed: 2.2,
  targetSmoothing: 8,
} satisfies ParticleConfig;
