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
