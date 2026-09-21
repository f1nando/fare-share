import { vehiclePose } from './world.js';
import { turnPose } from './trafficNetwork.js';
import { hornAnimation } from './hornAnimation.js';

export function presentation(car, coordinates, target = {}) {
  const pose = car.parking ? coordinates : car.turn ? turnPose(car.turn) : vehiclePose(coordinates.x, coordinates.z, car.axis, car.direction, car.steer);
  target.x = pose.x; target.z = pose.z; target.angle = pose.angle;
  target.pitch = (car.taxi ? car.pitch ?? 0 : 0) + (car.roadPitch ?? 0);
  target.roll = (car.taxi ? car.roll ?? 0 : 0) + (car.roadRoll ?? 0);
  target.lift = (car.rideHeight ?? 0) + (car.hornAge == null ? 0 : hornAnimation(car.hornAge).bounce);
  const airborne = Math.max(0, target.lift - (car.surfaceSupport ?? 0));
  target.wheels ??= [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) target.wheels[i] = (car.wheelHeights?.[i] ?? 0) + airborne;
  return target;
}

export function interpolatePresentation(current, previous, alpha) {
  // Recycled cars and newly exposed roads have no continuous previous pose.
  if (!previous || Math.hypot(current.x - previous.x, current.z - previous.z) > 4) return current;
  alpha = Math.max(0, Math.min(1, alpha));
  const angle = Math.atan2(Math.sin(current.angle - previous.angle), Math.cos(current.angle - previous.angle));
  current.angle = previous.angle + angle * alpha;
  for (const key of ['x', 'z', 'pitch', 'roll', 'lift']) current[key] = previous[key] + (current[key] - previous[key]) * alpha;
  for (let i = 0; i < 4; i++) current.wheels[i] = previous.wheels[i] + (current.wheels[i] - previous.wheels[i]) * alpha;
  return current;
}

export function visiblePosition(coordinates, originX, originZ, focus, camera, margin = 0) {
  const dx = coordinates.x - originX - focus.x, dz = coordinates.z - originZ - focus.z;
  return Math.abs(dx * 0.882 - dz * 0.471) <= camera.right + 5 + margin &&
    Math.abs(dx * 0.42 + dz * 0.786) <= camera.top + 7 + margin;
}
