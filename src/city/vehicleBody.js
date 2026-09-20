export const MAX_BODY_PITCH = 0.09;
export const MAX_BODY_ROLL = 0.18;
const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));

export function updateBodyMotion(car, delta, previousSpeed) {
  if (!car.taxi || delta <= 0) return;
  const acceleration = (car.speed - previousSpeed) / delta;
  const pitchTarget = -clamp(acceleration / 35, 1) * MAX_BODY_PITCH;
  const rollTarget = -clamp(car.steer / 0.15, 1) * MAX_BODY_ROLL * Math.min(1, car.speed / 8);
  const steps = Math.ceil(delta / 0.025), step = delta / steps;
  for (let i = 0; i < steps; i++) {
    for (const [key, target, limit] of [['pitch', pitchTarget, MAX_BODY_PITCH], ['roll', rollTarget, MAX_BODY_ROLL]]) {
      const velocityKey = `${key}Velocity`;
      const angle = car[key] ?? 0, velocity = car[velocityKey] ?? 0;
      car[velocityKey] = velocity + ((target - angle) * 100 - velocity * 16) * step;
      car[key] = clamp(angle + car[velocityKey] * step, limit);
    }
  }
}

// Match the renderer's local roll -> pitch -> world heading rotation. Only the
// sprung body uses this transform; tyres and ground-level light beams stay flat.
export function bodyPartPose(x, y, z, pitch = 0, roll = 0) {
  const height = y - 0.42;
  const rolledX = x * Math.cos(roll) - height * Math.sin(roll);
  const rolledY = x * Math.sin(roll) + height * Math.cos(roll);
  return {
    x: rolledX,
    y: 0.42 + rolledY * Math.cos(pitch) - z * Math.sin(pitch),
    z: rolledY * Math.sin(pitch) + z * Math.cos(pitch),
  };
}
