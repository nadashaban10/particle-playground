import {
  FORMATION_NAMES,
  formationConfig,
  type FormationName,
  type FormationTargets,
} from "@/lib/formations";
import {
  measureFormationExtent,
  type FormationExtent,
} from "@/lib/grab-motion";

/**
 * Measured extent of every preset, from the real formation targets. The
 * targets are deterministic, so this matches what the particle system pulls
 * toward. The wave's height is animated, so its amplitude is added.
 */
export function measureFormationExtents(
  targets: FormationTargets,
): Record<FormationName, FormationExtent> {
  const extents = {} as Record<FormationName, FormationExtent>;

  for (const name of FORMATION_NAMES) {
    extents[name] = measureFormationExtent(targets[name]);
  }

  extents.wave.y = Math.max(extents.wave.y, formationConfig.wave.amplitude);

  return extents;
}
