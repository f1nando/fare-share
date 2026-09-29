export const VEHICLE_BOUNCE_DURATION = 520;
export const STUNT_DURATIONS = { motorcycle: 900, taxi: 850, heavy: 950, boat: 1100, helicopter: 1000 };

export function vehicleBounceLift(elapsed, reducedMotion = false) {
  if (elapsed < 0 || elapsed >= VEHICLE_BOUNCE_DURATION) return 0;
  const progress = elapsed / VEHICLE_BOUNCE_DURATION;
  const height = reducedMotion ? 0.35 : 1.35;
  return Math.sin(Math.PI * progress) * height;
}

export function animationVariation(random = Math.random) {
  return {
    direction: random() < 0.5 ? -1 : 1,
    strength: 0.65 + random() * 0.7,
    cycles: 1.5 + Math.floor(random() * 3) * 0.5,
  };
}

export function vehicleStunt(type, elapsed, variation = 1, reducedMotion = false) {
  const options = typeof variation === 'number' ? { direction: variation, strength: 1, cycles: 2 } : variation;
  const direction = options.direction ?? 1, strength = options.strength ?? 1, cycles = options.cycles ?? 2;
  const duration = STUNT_DURATIONS[type] ?? VEHICLE_BOUNCE_DURATION;
  if (elapsed >= duration) return null;
  // A frame timestamp can precede the input that scheduled the animation.
  // Keep it at rest until its start instead of treating it as completed.
  elapsed = Math.max(0, elapsed);
  const progress = elapsed / duration;
  const turn = progress * progress * (3 - 2 * progress) * Math.PI * 2;
  const envelope = Math.sin(Math.PI * progress);
  if (reducedMotion) return { lift: envelope * 0.3 * strength, pitch: 0, roll: 0, yaw: 0 };
  if (type === 'motorcycle') return { lift: envelope * 1.35 * strength, pitch: turn * direction,
    roll: Math.sin(progress * Math.PI * 2) * envelope * 0.12 * strength, yaw: 0 };
  if (type === 'taxi') return { lift: envelope * 0.8 * strength,
    pitch: Math.sin(progress * Math.PI * cycles) * envelope * 0.08 * strength, roll: turn * direction, yaw: 0 };
  if (type === 'heavy') return {
    lift: envelope * 0.24 * strength,
    pitch: Math.sin(progress * Math.PI * cycles * 2 + Math.PI / 2) * envelope * 0.09 * strength,
    roll: Math.sin(progress * Math.PI * cycles * 2) * envelope * 0.3 * strength * direction,
    yaw: 0,
  };
  if (type === 'boat') return { lift: 0, rippleProgress: progress, pitch: Math.sin(progress * Math.PI * cycles * 2) * envelope * 0.045 * strength,
    roll: Math.sin(progress * Math.PI * (cycles + 1) * 2) * envelope * 0.12 * strength * direction, yaw: 0 };
  if (type === 'helicopter') return { lift: 0, pitch: 0, roll: 0, yaw: turn * direction };
  return { lift: vehicleBounceLift(elapsed) * strength, pitch: 0, roll: 0, yaw: 0 };
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

export function vehicleBrushPadding(type) {
  return { motorcycle: 8, car: 12, taxi: 14, heavy: 22, boat: 28, helicopter: 36 }[type] ?? 12;
}
