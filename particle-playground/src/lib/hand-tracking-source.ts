import type { HandTrackingSource } from "@/types/hand-tracking";

export function readHandTrackingSource(
  video: HTMLVideoElement | null,
): HandTrackingSource | null {
  if (!video) {
    return null;
  }

  const stream = video.srcObject;
  if (!(stream instanceof MediaStream)) {
    return null;
  }

  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return null;
  }

  return { video, stream };
}
