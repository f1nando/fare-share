export const BUILDING_STRETCH_DURATION = 650;

export function buildingStretch(elapsed, reducedMotion = false, strength = 1) {
  if (elapsed < 0 || elapsed >= BUILDING_STRETCH_DURATION) return 1;
  const progress = elapsed / BUILDING_STRETCH_DURATION;
  return 1 + Math.sin(Math.PI * progress) * (reducedMotion ? 0.05 : 0.16) * strength;
}
