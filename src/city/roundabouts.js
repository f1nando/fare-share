import { roundaboutAt, roundaboutClosedArm } from './roadLayout.js';

import { RING_RADIUS, ISLAND_RADIUS, ROUNDABOUT_CLEARANCE } from './roundaboutDimensions.js';
export { RING_RADIUS, ISLAND_RADIUS } from './roundaboutDimensions.js';
const TAU = Math.PI * 2;
const heading = (axis, direction) => axis === 0 ? direction > 0 ? 0 : Math.PI : direction > 0 ? Math.PI / 2 : -Math.PI / 2;

// Open the corners of adjoining lots. Curved curb inserts fill this cutout;
// the surrounding flat slabs are split into a few boxes, while
// trees and buildings that would occupy the widened junction are omitted.
// The expanded range also covers a two-block park owned by this tile.
export function roundaboutSceneryBatch(batch, gx, gz, x, z, block) {
  const cuts = [];
  for (let dx = 0; dx <= 2; dx++) for (let dz = 0; dz <= 2; dz++) if (roundaboutAt(gx + dx, gz + dz)) {
    cuts.push({ left: x + dx * block - ROUNDABOUT_CLEARANCE, right: x + dx * block + ROUNDABOUT_CLEARANCE,
      top: z + dz * block - ROUNDABOUT_CLEARANCE, bottom: z + dz * block + ROUNDABOUT_CLEARANCE });
  }
  if (!cuts.length) return batch;
  return { add(kind, px, y, pz, w, h, d, color, rotation = 0, pitch = 0, roll = 0) {
    const flat = h < 0.65 && rotation === 0 && !pitch && !roll;
    const scale = kind === 'crown' ? 1 : 0.5;
    const halfX = (Math.abs(Math.cos(rotation)) * w + Math.abs(Math.sin(rotation)) * d) * scale;
    const halfZ = (Math.abs(Math.sin(rotation)) * w + Math.abs(Math.cos(rotation)) * d) * scale;
    let pieces = [{ left: px - halfX, right: px + halfX, top: pz - halfZ, bottom: pz + halfZ }], changed = false;
    for (const cut of cuts) {
      const next = [];
      for (const p of pieces) {
        if (p.right <= cut.left || p.left >= cut.right || p.bottom <= cut.top || p.top >= cut.bottom) { next.push(p); continue; }
        if (!flat) return;
        changed = true;
        const left = Math.max(p.left, cut.left), right = Math.min(p.right, cut.right);
        if (p.left < left) next.push({ ...p, right: left });
        if (p.right > right) next.push({ ...p, left: right });
        if (p.top < cut.top) next.push({ left, right, top: p.top, bottom: cut.top });
        if (p.bottom > cut.bottom) next.push({ left, right, top: cut.bottom, bottom: p.bottom });
      }
      pieces = next;
    }
    if (!changed) batch.add(kind, px, y, pz, w, h, d, color, rotation, pitch, roll);
    else for (const p of pieces) batch.add('box', (p.left + p.right) / 2, y, (p.top + p.bottom) / 2,
      p.right - p.left, h, p.bottom - p.top, color);
  } };
}

export function populateRoundabout(batch, gx, gz, x, z) {
  if (!roundaboutAt(gx, gz)) return;
  const closed=roundaboutClosedArm(gx,gz);
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    if(closed>=0&&(quadrant===(5-closed)%4||quadrant===(4-closed)%4))continue;
    const rotation = quadrant * Math.PI / 2;
    batch.add('roundaboutCurb',x,0.1,z,1,0.3,1,'#bdbdbd',rotation);
    batch.add('roundaboutWalk',x,0.25,z,1,0.34,1,'#dedede',rotation);
  }
  if(closed>=0) {
    const rotation=(1-closed)*Math.PI/2;
    batch.add('roundaboutCapCurb',x,0.1,z,1,.3,1,'#bdbdbd',rotation);
    batch.add('roundaboutCapWalk',x,0.25,z,1,.34,1,'#dedede',rotation);
  }
  batch.add('island', x, 0.12, z, ISLAND_RADIUS * 2, 0.24, ISLAND_RADIUS * 2, '#bdbdbd');
  batch.add('island', x, 0.26, z, ISLAND_RADIUS * 2 - 0.35, 0.08, ISLAND_RADIUS * 2 - 0.35, '#929292');
  // Short tangential dashes make the direction around the island readable.
  for (let i = 0; i < 12; i++) {
    const a = i * TAU / 12;
    batch.add('paint', x + Math.cos(a) * (ISLAND_RADIUS + 0.4), 0.016, z + Math.sin(a) * (ISLAND_RADIUS + 0.4),
      0.12, 0.018, 0.9, '#e9e9e9', -a);
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
  const before = { x: start.x + Math.cos(incoming) * 2.8, z: start.z + Math.sin(incoming) * 2.8 };
  const join = { x: a.x - Math.sin(entry) * 2, z: a.z + Math.cos(entry) * 2 };
  for (let i = 1; i <= 16; i++) points.push(cubic(start, before, join, a, i / 16));
  const count = Math.ceil(sweep / (Math.PI / 48));
  for (let i = 1; i <= count; i++) points.push(onRing(entry - sweep * i / count));
  const leave = { x: b.x + Math.sin(exit) * 2, z: b.z - Math.cos(exit) * 2 };
  const after = { x: end.x - Math.cos(outgoing) * 2.8, z: end.z - Math.sin(outgoing) * 2.8 };
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

function bodyGap(a,b) {
  const dx=b.x-a.x,dz=b.z-a.z,halfWidth=.8,halfLength=1.47;
  if(dx*dx+dz*dz>4*(halfWidth*halfWidth+halfLength*halfLength))return true;
  const axes=[[a.cos,-a.sin],[a.sin,a.cos],[b.cos,-b.sin],[b.sin,b.cos]];
  for(const [x,z] of axes) {
    const radius = p => halfWidth*Math.abs(x*p.cos-z*p.sin)+halfLength*Math.abs(x*p.sin+z*p.cos);
    if(Math.abs(dx*x+dz*z)>=radius(a)+radius(b))return true;
  }
  return false;
}

// Reserve a gap in time, not the whole ring. The same analytic speed profile
// drives both prediction and actual motion, including cars accelerating in.
export function roundaboutGap(turn, circulating) {
  for (const other of circulating) {
    if (other.junction !== turn.junction) continue;
    const horizon = Math.max(duration(turn), duration(other) - other.elapsed);
    if (!Number.isFinite(horizon)) return false;
    const step = Math.min(.08,.5/Math.max(turn.limit,other.limit,1));
    for (let t = 0; t <= horizon + step; t += step) {
      const incoming = roundaboutMotion(turn, t), existing = roundaboutMotion(other, other.elapsed + t);
      const a = roundaboutPose(turn, incoming.distance), b = roundaboutPose(other, existing.distance);
      // Oriented bodies distinguish adjacent lanes from a crossing conflict.
      // The margin covers movement between samples, even for fast taxi entries.
      if (!bodyGap(a,b)) return false;
      if (incoming.distance >= turn.length && existing.distance >= other.length) break;
    }
  }
  return true;
}
