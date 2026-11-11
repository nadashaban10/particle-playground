import { PALETTES } from "@/shared/lib/palettes";
import type { ParticleConfig } from "@/shared/types/particles";

/** Change these values to experiment with the particle cloud. */
export const particleConfig = {
  count: 10_000,
  velocityMultiplier: 1.2,
  bounds: { min: -4, max: 4 },
  size: 0.045,
  colors: PALETTES.cosmic.colors,
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
