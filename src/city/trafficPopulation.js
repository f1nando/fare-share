import { seededRandom, TRACKS, TRAFFIC_SPACING, STOP_LINE } from './world.js';
import { spawnRoadOpen } from './roadLayout.js';

import { chooseVehicleKind, VEHICLE_TYPES } from './vehicleTypes.js';

const colors = ['#ffffff', '#f4f4f4', '#e4e4e4', '#cdcdcd', '#a6a6a6', '#838383'];

// Shared by the real scene and CPU benchmark. Seed 0 preserves the city layout.
export function populateLane(axis, line, direction, settings, radius, centerPosition = 0, seed = 0, roadLayout = false) {
  const random = seededRandom(line * 7 + axis + seed, direction * 991);
  const typeRandom = seededRandom(line * 31 + axis + seed, direction * 1777);
  const spacing = settings.density > 0 ? TRAFFIC_SPACING * 100 / settings.density : Infinity;
  const count = Math.floor((radius * 2 + 1) * settings.blockSize / spacing), cars = [];
  for (const track of [0, 1]) for (let i = 0; i < count; i++) {
    const taxi = random() < settings.taxiShare / 100;
    const kind = chooseVehicleKind(taxi, typeRandom()), type = VEHICLE_TYPES[kind];
    const cruise = taxi ? 13 + random() * 2 : (3.4 + random() * 4.2) * type.speed;
    const acceleration = taxi ? 24 + random() * 5 : (2.2 + random() * 4) * type.acceleration;
    cars.push({ axis, line, direction,
      position: centerPosition - radius * settings.blockSize + i * spacing + track * spacing / 2 + random() * 1.5,
      taxi, kind, color: colors[Math.floor(random() * colors.length)],
      track, fromTrack: track, offset: TRACKS[track], cruise, speed: cruise, acceleration,
      baseCruise: cruise, baseAcceleration: acceleration,
      changing: false, merge: 1, cooldown: random(), steer: 0 });
  }
  return { axis, line, direction, cars: roadLayout ? cars.filter(car => spawnRoadOpen(car, settings.blockSize, STOP_LINE)) : cars, radius };
}
