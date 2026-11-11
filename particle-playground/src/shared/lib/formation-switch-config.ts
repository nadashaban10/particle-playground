export type FormationSwitchConfig = {
  /** Seconds a V-sign must be held before a switch fires. */
  holdSeconds: number;
  /**
   * Extra seconds after the V-sign is released before another hold can start.
   * Prevents accidental double switches when the hand wobbles through the pose.
   */
  cooldownSeconds: number;
  /**
   * Brief grace while the V-sign flickers off during a hold. Longer than this
   * without a V-sign cancels the charge (and, after a fire, counts as a release).
   */
  releaseGraceSeconds: number;
  /** Frames longer than this (s) are treated as this long. */
  maxStepSeconds: number;
};

export const formationSwitchConfig: FormationSwitchConfig = {
  holdSeconds: 0.6,
  cooldownSeconds: 0.45,
  releaseGraceSeconds: 0.12,
  maxStepSeconds: 0.05,
};
