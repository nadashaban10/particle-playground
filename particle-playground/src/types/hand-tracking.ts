export type Handedness = "Left" | "Right";

export type GestureName =
  | "none"
  | "open_palm"
  | "closed_fist"
  | "pinch"
  | "point";

/** A single hand landmark. x and y are normalized to the image, z is depth. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface TrackedHand {
  handedness: Handedness;
  landmarks: Landmark[];
  gesture: GestureName;
}
