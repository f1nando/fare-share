import { DIAGONAL_LANE, diagonalFromJunction } from './diagonalLayout.js';
import { TRACKS, STOP_LINE, occupiesTrack } from './world.js';
import { vehicleGap, extraHalfLength } from './vehicleTypes.js';

export function diagonalTarget(car, cross, block) {
  const road = diagonalFromJunction(car.axis === 0 ? cross : car.line, car.axis === 0 ? car.line : cross, block);
  if (!road) return null;
  const dx = road.end.x - road.start.x, dz = road.end.z - road.start.z;
  if (car.direction !== (car.axis === 0 ? dx : dz)) return null;
  // Outer lanes have a shallow turn onto the new fifth arm. Avoid cutting
  // across the parallel entry lane; long vehicles stay on the main streets.
  if (car.track !== 1 || extraHalfLength(car) > .5) return null;
  const direction = car.direction, axis = car.axis;
  const centerX = road.start.x * block, centerZ = road.start.z * block;
  const exitX = road.end.x * block, exitZ = road.end.z * block;
  return { kind: 'diagonal', axis, line: axis === 0 ? road.end.z : road.end.x, direction, track: 1,
    position: (axis === 0 ? exitX : exitZ) + direction * (STOP_LINE + 1), side: 0,
    junction: `${road.start.x}:${road.start.z}`, exitJunction: `${road.end.x}:${road.end.z}`,
    roadId: road.key, centerX, centerZ, exitX, exitZ, dx: dx / Math.SQRT2, dz: dz / Math.SQRT2 };
}

const cubic = (a, b, c, d, t) => {
  const u = 1 - t;
  return { x: u*u*u*a.x + 3*u*u*t*b.x + 3*u*t*t*c.x + t*t*t*d.x,
    z: u*u*u*a.z + 3*u*u*t*b.z + 3*u*t*t*c.z + t*t*t*d.z };
};

export function buildDiagonalPath(car, turn, start, block) {
  const { dx, dz } = turn, right = { x: -dz * DIAGONAL_LANE, z: dx * DIAGONAL_LANE };
  const inset = Math.min(10, block * .36);
  const a = { x: turn.centerX + dx * inset + right.x, z: turn.centerZ + dz * inset + right.z };
  const b = { x: turn.exitX - dx * inset + right.x, z: turn.exitZ - dz * inset + right.z };
  const end = turn.axis === 0 ? { x: turn.position, z: turn.line * block + turn.direction * TRACKS[turn.track] } :
    { x: turn.line * block - turn.direction * TRACKS[turn.track], z: turn.position };
  const forward = { x: car.axis === 0 ? car.direction : 0, z: car.axis === 1 ? car.direction : 0 };
  const points = [start];
  const entry = [start, { x: start.x + forward.x * 4.2, z: start.z + forward.z * 4.2 },
    { x: a.x - dx * 3, z: a.z - dz * 3 }, a];
  for (let i = 1; i <= 16; i++) points.push(cubic(...entry, i / 16));
  const entryIndex = points.length - 1;
  points.push(b);
  const exitIndex = points.length - 1;
  const exit = [b, { x: b.x + dx * 3, z: b.z + dz * 3 },
    { x: end.x - forward.x * 4.2, z: end.z - forward.z * 4.2 }, end];
  for (let i = 1; i <= 16; i++) points.push(cubic(...exit, i / 16));
  const samples = [0];
  for (let i = 1; i < points.length; i++) samples.push(samples.at(-1) + Math.hypot(points[i].x - points[i-1].x, points[i].z - points[i-1].z));
  const heading = Math.atan2(forward.x, forward.z);
  const angles = points.map((p, i) => i === 0 || i === points.length - 1 ? heading :
    Math.atan2(points[i+1].x - points[i-1].x, points[i+1].z - points[i-1].z));
  // Exact tangent at the join, independent of the length of the straight leg.
  angles[entryIndex] = angles[exitIndex] = Math.atan2(dx, dz);
  Object.assign(turn, { path: points, samples, angles, entryLength: samples[entryIndex] + 2,
    exitStart: samples[exitIndex], length: samples.at(-1), distance: 0 });
  return turn;
}

export function diagonalLandingClear(car, turn, lanes) {
  const lane = lanes.get(`${turn.axis}:${turn.line}:${turn.direction}`);
  return lane && lane.cars.every(other => other === car || !occupiesTrack(other, turn.track) ||
    Math.abs(other.position - turn.position) >= vehicleGap(car, other) + 1);
}
