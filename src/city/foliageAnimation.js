export const FOLIAGE_SWAY_DURATION = 900;

export function foliageSwayAngle(elapsed, variation = 1, reducedMotion = false) {
  const options = typeof variation === 'number' ? { direction: variation, strength: 1, cycles: 2.5 } : variation;
  const direction = options.direction ?? 1, strength = options.strength ?? 1, cycles = options.cycles ?? 2.5;
  if (elapsed < 0 || elapsed >= FOLIAGE_SWAY_DURATION) return 0;
  const progress = elapsed / FOLIAGE_SWAY_DURATION;
  const envelope = Math.sin(Math.PI * progress);
  const amplitude = reducedMotion ? 0.06 : 0.24;
  return Math.sin(progress * Math.PI * cycles * 2) * envelope * amplitude * direction * strength;
}

export function claimGestureTarget(touched, target) {
  if (target == null || touched.has(target)) return false;
  touched.add(target);
  return true;
}

export function claimAnimationStart(touched, target, isAnimating) {
  return claimGestureTarget(touched, target) && !isAnimating;
}

export function shouldStartBrushAnimation(wasInside, isAnimating) {
  return !wasInside && !isAnimating;
}

export function withinGestureRadius(screenX, screenY, point, radius) {
  return (screenX - point.x) ** 2 + (screenY - point.y) ** 2 <= radius ** 2;
}
