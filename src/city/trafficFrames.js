import { carCoordinates } from './trafficNetwork.js';
import { headlightsOn } from './world.js';
import { presentation } from './vehiclePresentation.js';

// Transfer only drawing data, never the simulation's cyclic car/reservation graph.
export const CAR_STRIDE = 17;

export function packTraffic(lanes, identities) {
  let count = 0, taxis = 0, turns = 0, launches = 0;
  for (const lane of lanes.values()) count += lane.cars.length;
  const data = new Float64Array(count * CAR_STRIDE), pose = {}, colors = new Map();
  let offset = 0;
  for (const lane of lanes.values()) for (const car of lane.cars) {
    if (!identities.ids.has(car)) identities.ids.set(car, ++identities.next);
    presentation(car, carCoordinates(car, identities.blockSize), pose);
    if (!colors.has(car.color)) colors.set(car.color, parseInt(car.color.slice(1), 16));
    data.set([identities.ids.get(car), pose.x, pose.z, pose.angle, pose.pitch, pose.roll, pose.lift,
      ...pose.wheels, Number(car.taxi), colors.get(car.color), Number(headlightsOn(car)),
      car.hornAge ?? -1, car.signalIndex ?? 0, car.rideHeight ?? 0], offset);
    offset += CAR_STRIDE;
    taxis += Number(car.taxi); turns += car.turnsCompleted ?? 0; launches += car.launchesCompleted ?? 0;
  }
  return { data, cars: count, taxis, turns, launches };
}

export function readPose(data, offset, target = {}) {
  target.x = data[offset + 1]; target.z = data[offset + 2]; target.angle = data[offset + 3];
  target.pitch = data[offset + 4]; target.roll = data[offset + 5]; target.lift = data[offset + 6];
  target.wheels ??= [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) target.wheels[i] = data[offset + 7 + i];
  return target;
}

export function readAppearance(data, offset, target = {}) {
  target.taxi = Boolean(data[offset + 11]); target.color = data[offset + 12];
  target.headlights = Boolean(data[offset + 13]);
  target.hornAge = data[offset + 14] < 0 ? undefined : data[offset + 14];
  target.signalIndex = data[offset + 15]; target.rideHeight = data[offset + 16];
  return target;
}

export function frameSnapshot(frame) {
  if (!frame) return null;
  let hash = 2166136261;
  for (const number of frame.data) hash = Math.imul(hash ^ Math.round(number * 1e6), 16777619);
  return { cars: frame.cars, taxis: frame.taxis, turns: frame.turns, launches: frame.launches,
    checksum: (hash >>> 0).toString(16).padStart(8, '0'), checksumScope: 'presentation', time: frame.time };
}
