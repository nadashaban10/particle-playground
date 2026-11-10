import type { HandPositionSample } from "@/lib/hand-positions";

const EMPTY: readonly HandPositionSample[] = [];

/** Latest smoothed hands. The trail renderer reads this without React state. */
export const paintSampleSource: { current: readonly HandPositionSample[] } = {
  current: EMPTY,
};
