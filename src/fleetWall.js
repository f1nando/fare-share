const ROAD_MARK_ASPECT = 56 / 360;

export function fleetColumnCount(width) {
  if (width <= 420) return 2;
  if (width <= 600) return 3;
  if (width <= 900) return 4;
  if (width <= 1200) return 5;
  if (width <= 1500) return 6;
  return 7;
}

export function fleetRoadStrip(settings) {
  const width = settings.markSpacing * 14 + settings.markWidth;
  return { width, height: settings.markWidth * ROAD_MARK_ASPECT };
}

export function fleetRoadPlaybackRate(bounds, clientX, clientY) {
  const distanceX = Math.max(bounds.left - clientX, 0, clientX - bounds.right);
  const distanceY = Math.max(bounds.top - clientY, 0, clientY - bounds.bottom);
  const distance = Math.hypot(distanceX, distanceY);
  const activationDistance = bounds.width * .5;
  let proximity;

  if (distance > 0) {
    proximity = Math.max(0, 1 - distance / activationDistance) * .5;
  } else {
    const depthInside = Math.min(
      clientX - bounds.left,
      bounds.right - clientX,
      clientY - bounds.top,
      bounds.bottom - clientY,
    );
    proximity = .5 + Math.min(1, depthInside / (bounds.width * .25)) * .5;
  }

  const smoothProximity = proximity ** 3 * (proximity * (proximity * 6 - 15) + 10);
  return 1 + smoothProximity * 9;
}
