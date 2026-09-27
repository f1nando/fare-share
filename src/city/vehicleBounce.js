export const VEHICLE_BOUNCE_DURATION = 520;
export const STUNT_DURATIONS = { motorcycle: 900, taxi: 850, heavy: 950, boat: 1100, helicopter: 1000 };

export function vehicleBounceLift(elapsed, reducedMotion = false) {
  if (elapsed < 0 || elapsed >= VEHICLE_BOUNCE_DURATION) return 0;
  const progress = elapsed / VEHICLE_BOUNCE_DURATION;
  const height = reducedMotion ? 0.35 : 1.35;
  return Math.sin(Math.PI * progress) * height;
}

export function vehicleStunt(type, elapsed, direction = 1, reducedMotion = false) {
  const duration = STUNT_DURATIONS[type] ?? VEHICLE_BOUNCE_DURATION;
  if (elapsed < 0 || elapsed >= duration) return null;
  const progress = elapsed / duration;
  const turn = progress * progress * (3 - 2 * progress) * Math.PI * 2;
  const envelope = Math.sin(Math.PI * progress);
  if (reducedMotion) return { lift: envelope * 0.3, pitch: 0, roll: 0, yaw: 0 };
  if (type === 'motorcycle') return { lift: envelope * 1.35, pitch: turn * direction, roll: 0, yaw: 0 };
  if (type === 'taxi') return { lift: envelope * 0.8, pitch: 0, roll: turn, yaw: 0 };
  if (type === 'heavy') return { lift: envelope * 0.08, pitch: 0, roll: Math.sin(progress * Math.PI * 4) * envelope * 0.16, yaw: 0 };
  if (type === 'boat') return { lift: 0, pitch: Math.sin(progress * Math.PI * 4) * envelope * 0.045,
    roll: Math.sin(progress * Math.PI * 6) * envelope * 0.12, yaw: 0 };
  if (type === 'helicopter') return { lift: 0, pitch: 0, roll: 0, yaw: turn };
  return { lift: vehicleBounceLift(elapsed), pitch: 0, roll: 0, yaw: 0 };
}

export function stuntType(kind, taxi = false) {
  if (taxi) return 'taxi';
  if (kind === 'motorcycle' || kind === 'boat' || kind === 'helicopter') return kind;
  if (kind === 'truck' || kind === 'bus') return 'heavy';
  return 'car';
}

export function nearestScreenVehicle(vehicles, point, maxDistance = 30) {
  let nearest = null;
  let distanceSquared = maxDistance * maxDistance;
  for (const vehicle of vehicles) {
    const candidate = (vehicle.screenX - point.x) ** 2 + (vehicle.screenY - point.y) ** 2;
    if (candidate < distanceSquared) {
      nearest = vehicle;
      distanceSquared = candidate;
    }
  }
  return nearest;
}
