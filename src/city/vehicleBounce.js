export const VEHICLE_BOUNCE_DURATION = 520;

export function vehicleBounceLift(elapsed, reducedMotion = false) {
  if (elapsed < 0 || elapsed >= VEHICLE_BOUNCE_DURATION) return 0;
  const progress = elapsed / VEHICLE_BOUNCE_DURATION;
  const height = reducedMotion ? 0.35 : 1.35;
  return Math.sin(Math.PI * progress) * height;
}

export function nearestClickableVehicle(vehicles, point, maxDistance = 3) {
  let nearest = null;
  let distanceSquared = maxDistance * maxDistance;
  for (const vehicle of vehicles) {
    const candidate = (vehicle.x - point.x) ** 2 + (vehicle.z - point.z) ** 2;
    if (candidate < distanceSquared) {
      nearest = vehicle;
      distanceSquared = candidate;
    }
  }
  return nearest;
}
