export type ParticleBounds = {
  min: number;
  max: number;
};

export type InteractionMode = "attraction" | "repulsion";

export type Vector3 = {
  x: number;
  y: number;
  z: number;
};

export type ParticleConfig = {
  count: number;
  velocityMultiplier: number;
  bounds: ParticleBounds;
  size: number;
  colors: readonly string[];
  background: string;
  cameraZ: number;
  cameraFov: number;
  interaction: InteractionMode;
  forceStrength: number;
  target: Vector3;
  damping: number;
  interactionRadius: number;
  maxSpeed: number;
  targetSmoothing: number;
};

export type ParticleBuffers = {
  positions: Float32Array;
  velocities: Float32Array;
  colors: Float32Array;
};
