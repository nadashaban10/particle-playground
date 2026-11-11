/**
 * Gesture guide content for Explore Galaxies.
 * Descriptions match the Stage 17 particle-world implementation only.
 */

export type ExploreGestureId =
  | "open_palm"
  | "closed_fist"
  | "pinch"
  | "two_hand"
  | "v_sign";

export type ExploreGestureGuideEntry = {
  id: ExploreGestureId;
  name: string;
  /** Short line for the guide card. */
  description: string;
  /** How the hand should look (for illustration labels). */
  pose: string;
};

export const EXPLORE_GESTURE_GUIDE: readonly ExploreGestureGuideEntry[] = [
  {
    id: "open_palm",
    name: "Open palm",
    pose: "Fingers spread, palm toward the camera",
    description: "Pushes nearby particles away from your hand.",
  },
  {
    id: "closed_fist",
    name: "Fist",
    pose: "All fingers curled into a fist",
    description: "Pulls nearby particles in toward your hand.",
  },
  {
    id: "pinch",
    name: "Pinch",
    pose: "Thumb and index finger tip together",
    description: "Grabs the formation when you are close, then moves it with you.",
  },
  {
    id: "two_hand",
    name: "Two-hand pinch",
    pose: "Pinch with both hands at once",
    description: "Moves, scales, and rotates the whole formation together.",
  },
  {
    id: "v_sign",
    name: "V-sign",
    pose: "Index and middle up; ring and pinky curled — hold briefly",
    description:
      "Changes the formation once: Galaxy → Sphere → Nebula → Wave, then repeats.",
  },
];
