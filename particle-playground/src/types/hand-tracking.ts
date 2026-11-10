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
  /** The person's own left or right hand. Null when MediaPipe omits a label. */
  handedness: Handedness | null;
  landmarks: Landmark[];
  gesture: GestureName;
  /** Wrist position in normalized image space. */
  position: Landmark;
}

/** The camera input a future Hand Landmarker will read. */
export type HandTrackingSource = {
  video: HTMLVideoElement;
  stream: MediaStream;
};
