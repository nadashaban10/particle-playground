type VideoLandmarkSpace = {
  offsetX: number;
  offsetY: number;
  renderWidth: number;
  renderHeight: number;
  mirrored: boolean;
};

export function readVideoLandmarkSpace(
  video: HTMLVideoElement,
): VideoLandmarkSpace {
  const boxWidth = video.clientWidth;
  const boxHeight = video.clientHeight;
  const sourceWidth = video.videoWidth || boxWidth;
  const sourceHeight = video.videoHeight || boxHeight;
  const sourceAspect = sourceWidth / sourceHeight;
  const boxAspect = boxWidth / boxHeight;

  let renderWidth = boxWidth;
  let renderHeight = boxHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (sourceAspect > boxAspect) {
    renderWidth = boxHeight * sourceAspect;
    offsetX = (boxWidth - renderWidth) / 2;
  } else {
    renderHeight = boxWidth / sourceAspect;
    offsetY = (boxHeight - renderHeight) / 2;
  }

  return {
    offsetX,
    offsetY,
    renderWidth,
    renderHeight,
    mirrored: isHorizontallyMirrored(video),
  };
}

export function mapLandmark(
  landmark: { x: number; y: number },
  space: VideoLandmarkSpace,
): { x: number; y: number } {
  const x = space.mirrored ? 1 - landmark.x : landmark.x;

  return {
    x: space.offsetX + x * space.renderWidth,
    y: space.offsetY + landmark.y * space.renderHeight,
  };
}

export function isHorizontallyMirrored(video: HTMLVideoElement): boolean {
  const transform = getComputedStyle(video).transform;
  if (transform === "none") {
    return false;
  }

  const scaleX = Number(
    transform.slice(transform.indexOf("(") + 1).split(",")[0],
  );
  return scaleX < 0;
}
