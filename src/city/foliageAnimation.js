export const FOLIAGE_SWAY_DURATION = 900;

export function foliageSwayAngle(elapsed, direction = 1, reducedMotion = false) {
  if (elapsed < 0 || elapsed >= FOLIAGE_SWAY_DURATION) return 0;
  const progress = elapsed / FOLIAGE_SWAY_DURATION;
  const envelope = Math.sin(Math.PI * progress);
  const amplitude = reducedMotion ? 0.06 : 0.24;
  return Math.sin(progress * Math.PI * 5) * envelope * amplitude * direction;
}

export function claimGestureTarget(touched, target) {
  if (target == null || touched.has(target)) return false;
  touched.add(target);
  return true;
}
