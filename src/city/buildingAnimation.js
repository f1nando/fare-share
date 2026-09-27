export const BUILDING_STRETCH_DURATION = 650;

export function buildingStretch(elapsed, reducedMotion = false, strength = 1) {
  return buildingMotion(elapsed, reducedMotion, { strength }).scaleY;
}

export function buildingMotion(elapsed, reducedMotion = false, variation = {}) {
  if (elapsed < 0 || elapsed >= BUILDING_STRETCH_DURATION) return { scaleY: 1, scaleXZ: 1, tilt: 0, lift: 0 };
  const progress = elapsed / BUILDING_STRETCH_DURATION;
  const envelope = Math.sin(Math.PI * progress), strength = variation.strength ?? 1;
  if (reducedMotion) return { scaleY: 1 + envelope * 0.05 * strength, scaleXZ: 1, tilt: 0, lift: 0 };
  const wobble = Math.sin(progress * Math.PI * 2 * (variation.cycles ?? 2)) * envelope;
  return {
    scaleY: 1 + envelope * 0.3 * strength,
    scaleXZ: 1 - envelope * 0.08 * strength,
    tilt: wobble * 0.07 * strength * (variation.direction ?? 1),
    lift: envelope * 0.25 * strength,
  };
}
