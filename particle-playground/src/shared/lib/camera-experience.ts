/**
 * Camera experience UX for Cosmic Canvas. Pure: turns the camera stream phase,
 * the MediaPipe tracker phase, and the live hand count into one status the UI
 * can show. Camera readiness is never treated as hand-tracking readiness.
 *
 * Does not own getUserMedia or MediaPipe — those stay in CameraPreview and
 * useHandLandmarks.
 */

export type CameraStreamPhase =
  | "idle"
  | "requesting"
  | "ready"
  | "error"
  | "ended";

export type TrackerPhase = "idle" | "loading" | "ready" | "error";

/**
 * What the user-facing status should emphasize right now.
 * Ordered roughly by severity / progress through onboarding.
 */
export type CameraExperiencePhase =
  | "idle"
  | "requesting_camera"
  | "camera_error"
  | "stream_ended"
  | "loading_tracker"
  | "tracker_error"
  | "waiting_for_hand"
  | "hand_detected";

export type CameraExperienceInput = {
  /** False while the world camera card is not mounted. */
  cameraEnabled: boolean;
  stream: CameraStreamPhase;
  streamError: string | null;
  tracker: TrackerPhase;
  trackerError: string | null;
  handCount: number;
};

export type CameraExperienceCopy = {
  /** Short line under the preview / in the tip. */
  status: string;
  /** Optional second line with positioning or recovery help. */
  hint: string | null;
  /** Primary recovery action, if any. */
  action: "enable" | "retry" | null;
};

export function deriveCameraExperiencePhase(
  input: CameraExperienceInput,
): CameraExperiencePhase {
  if (!input.cameraEnabled) {
    return "idle";
  }

  if (input.stream === "error") {
    return "camera_error";
  }

  if (input.stream === "ended") {
    return "stream_ended";
  }

  if (input.stream === "idle" || input.stream === "requesting") {
    return "requesting_camera";
  }

  // Stream is ready. Tracker may still be loading.
  if (input.tracker === "error") {
    return "tracker_error";
  }

  if (input.tracker === "idle" || input.tracker === "loading") {
    return "loading_tracker";
  }

  if (input.handCount > 0) {
    return "hand_detected";
  }

  return "waiting_for_hand";
}

export function cameraExperienceCopy(
  phase: CameraExperiencePhase,
  input: Pick<CameraExperienceInput, "streamError" | "trackerError" | "handCount">,
): CameraExperienceCopy {
  switch (phase) {
    case "idle":
      return {
        status: "Enable the camera to sculpt with your hands",
        hint: "Tracking stays on this device. Use an open palm, fist, pinch, or V-sign.",
        action: "enable",
      };
    case "requesting_camera":
      return {
        status: "Waiting for camera permission…",
        hint: "Allow access when the browser asks.",
        action: null,
      };
    case "camera_error":
      return {
        status: input.streamError ?? "The camera could not be started.",
        hint: "Check permissions, then try again.",
        action: "retry",
      };
    case "stream_ended":
      return {
        status: "Camera disconnected",
        hint: "Another app may have taken the camera. Tap retry to reconnect.",
        action: "retry",
      };
    case "loading_tracker":
      return {
        status: "Starting hand tracking…",
        hint: "Camera is on. Tracker is loading locally.",
        action: null,
      };
    case "tracker_error":
      return {
        status: input.trackerError ?? "Hand tracking failed.",
        hint: "You can retry without reloading the page.",
        action: "retry",
      };
    case "waiting_for_hand":
      return {
        status: "Show one hand to the camera",
        hint: "Hold your hand an arm’s length away, palm facing the lens.",
        action: null,
      };
    case "hand_detected":
      return {
        status:
          input.handCount >= 2 ? "Two hands detected" : "Hand detected",
        hint: null,
        action: null,
      };
  }
}

/** True when turning the camera off should hard-reset interaction engines. */
export function shouldResetInteractionsOnCameraStop(
  wasEnabled: boolean,
  isEnabled: boolean,
): boolean {
  return wasEnabled && !isEnabled;
}
