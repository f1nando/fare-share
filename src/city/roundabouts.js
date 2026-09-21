import { roundaboutAt } from './roadLayout.js';

export const RING_RADIUS = 2.65;
export const ISLAND_RADIUS = 1.1;
const TAU = Math.PI * 2;
const heading = (axis, direction) => axis === 0 ? direction > 0 ? 0 : Math.PI : direction > 0 ? Math.PI / 2 : -Math.PI / 2;

export function populateRoundabout(batch, gx, gz, x, z) {
  if (!roundaboutAt(gx, gz)) return;
  batch.add('island', x, 0.12, z, ISLAND_RADIUS * 2, 0.24, ISLAND_RADIUS * 2, '#bdbdbd');
  batch.add('island', x, 0.26, z, 1.85, 0.08, 1.85, '#929292');
  // Short tangential dashes make the direction around the island readable.
  for (let i = 0; i < 12; i++) {
    const a = i * TAU / 12;
    batch.add('paint', x + Math.cos(a) * 1.5, 0.016, z + Math.sin(a) * 1.5,
      0.12, 0.018, 0.32, '#e9e9e9', -a);
  }
}

const cubic = (a, b, c, d, t) => {
  const u = 1 - t;
  return { x: u*u*u*a.x + 3*u*u*t*b.x + 3*u*t*t*c.x + t*t*t*d.x,
    z: u*u*u*a.z + 3*u*u*t*b.z + 3*u*t*t*c.z + t*t*t*d.z };
};

// Entry and exit are tangent to the circle and to the original street lanes.
// A distance table is built only when admitting a car, never for the whole city.
export function buildRoundaboutPath(car, turn, start, end) {
  const incoming = heading(car.axis, car.direction), outgoing = heading(turn.axis, turn.direction);
  const entry = incoming + Math.PI * 0.75, exit = outgoing + Math.PI * 0.25;
  const sweep = ((entry - exit) % TAU + TAU) % TAU;
  const onRing = angle => ({ x: turn.centerX + RING_RADIUS * Math.cos(angle), z: turn.centerZ + RING_RADIUS * Math.sin(angle) });
  const a = onRing(entry), b = onRing(exit), points = [start];
  const before = { x: start.x + Math.cos(incoming) * 1.4, z: start.z + Math.sin(incoming) * 1.4 };
  const join = { x: a.x - Math.sin(entry), z: a.z + Math.cos(entry) };
  for (let i = 1; i <= 16; i++) points.push(cubic(start, before, join, a, i / 16));
  const count = Math.ceil(sweep / (Math.PI / 48));
  for (let i = 1; i <= count; i++) points.push(onRing(entry - sweep * i / count));
  const leave = { x: b.x + Math.sin(exit), z: b.z - Math.cos(exit) };
  const after = { x: end.x - Math.cos(outgoing) * 1.4, z: end.z - Math.sin(outgoing) * 1.4 };
  for (let i = 1; i <= 16; i++) points.push(cubic(b, leave, after, end, i / 16));
  const samples = [0];
  for (let i = 1; i < points.length; i++) samples.push(samples[i - 1] + Math.hypot(points[i].x - points[i-1].x, points[i].z - points[i-1].z));
  const angles = points.map((p, i) => i === 0 ? Math.PI / 2 - incoming : i === points.length - 1 ? Math.PI / 2 - outgoing :
    Math.atan2(points[i+1].x-points[i-1].x, points[i+1].z-points[i-1].z));
  Object.assign(turn, { kind: 'roundabout', path: points, angles, samples, length: samples.at(-1), distance: 0, elapsed: 0,
    startSpeed: car.speed, acceleration: car.acceleration ?? (car.taxi ? 25 : 4),
    limit: Math.max(car.speed, Math.min(car.cruise, car.taxi ? 10 : 7)), incoming, outgoing });
  return turn;
}

export function roundaboutMotion(turn, elapsed) {
  const accelerating = Math.min(elapsed, Math.max(0, turn.limit - turn.startSpeed) / turn.acceleration);
  return { distance: turn.startSpeed * accelerating + turn.acceleration * accelerating ** 2 / 2 + turn.limit * (elapsed - accelerating),
    speed: Math.min(turn.limit, turn.startSpeed + turn.acceleration * elapsed) };
}

function duration(turn) {
  const accelerationTime = Math.max(0, turn.limit - turn.startSpeed) / turn.acceleration;
  const accelerationDistance = (turn.startSpeed + turn.limit) * accelerationTime / 2;
  return turn.length <= accelerationDistance ?
    (Math.sqrt(turn.startSpeed ** 2 + 2 * turn.acceleration * turn.length) - turn.startSpeed) / turn.acceleration :
    accelerationTime + (turn.length - accelerationDistance) / turn.limit;
}

export function roundaboutPose(turn, distance = turn.distance) {
  const d = Math.min(distance, turn.length), samples = turn.samples;
  let low = 1, high = samples.length - 1;
  while (low < high) { const mid = (low + high) >>> 1; if (samples[mid] < d) low = mid + 1; else high = mid; }
  const a = turn.path[low - 1], b = turn.path[low], t = (d - samples[low-1]) / Math.max(1e-9, samples[low] - samples[low-1]);
  const from = turn.angles[low-1], to = turn.angles[low];
  const angle = from + Math.atan2(Math.sin(to-from), Math.cos(to-from)) * t;
  return { x: a.x + (b.x-a.x)*t, z: a.z + (b.z-a.z)*t, angle, sin: Math.sin(angle), cos: Math.cos(angle), drift: 0 };
}

// Reserve a gap in time, not the whole ring. The same analytic speed profile
// drives both prediction and actual motion, including cars accelerating in.
export function roundaboutGap(turn, circulating) {
  for (const other of circulating) {
    if (other.junction !== turn.junction) continue;
    const horizon = Math.max(duration(turn), duration(other) - other.elapsed);
    if (!Number.isFinite(horizon)) return false;
    for (let t = 0; t <= horizon + 0.1; t += 0.1) {
      const incoming = roundaboutMotion(turn, t), existing = roundaboutMotion(other, other.elapsed + t);
      const a = roundaboutPose(turn, incoming.distance), b = roundaboutPose(other, existing.distance);
      // Circumscribed body circles plus half a sampling interval of travel.
      if (Math.hypot(a.x - b.x, a.z - b.z) < 3.25) return false;
      if (incoming.distance >= turn.length && existing.distance >= other.length) break;
    }
  }
  return true;
}
