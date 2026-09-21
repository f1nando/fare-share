import { seededRandom, TRACKS, TRAFFIC_SPACING, STOP_LINE } from './world.js';
import { spawnRoadOpen } from './roadLayout.js';
import { seedParking } from './parkingTraffic.js';

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
      changing: false, merge: 1, cooldown: random(), steer: 0,
      // Keep one object layout through parking, turns and taxi manoeuvres.
      // Adding these fields lazily produces many shapes in the hot physics loops.
      roadworks: undefined, turnCooldown: undefined, roadEnd: undefined, dividedRoad: undefined,
      roundaboutApproach: undefined, raceCooldown: undefined, flashCooldown: undefined,
      signalWait: undefined, yieldDelay: undefined, yieldRemaining: undefined,
      launchAttempt: undefined, launchChosen: undefined, burst: undefined, seekInner: undefined,
      feintCooldown: undefined, roadRoll: undefined, surfaceSupport: undefined, rideVelocity: undefined,
      rideHeight: undefined, roadPitch: undefined, wheelHeights: undefined, mergeSpeed: undefined,
      crossing: undefined, signalIndex: undefined, signalMode: undefined, flashAge: undefined,
      hornAge: undefined, pitchVelocity: undefined, pitch: undefined, rollVelocity: undefined,
      roll: undefined, overtake: undefined, parking: undefined, lastParkingLot: undefined,
      workBypass: undefined, turn: undefined, feint: undefined, turnsStarted: undefined,
      turnsCompleted: undefined, workAvoidances: undefined, race: undefined, raceResult: undefined,
      roundaboutsCompleted: undefined, diagonalsCompleted: undefined, requiredTurnsCompleted: undefined, launchesPrepared: undefined,
      launchesStarted: undefined, launchesCompleted: undefined, parksCompleted: undefined, parkingExits: undefined });
  }
  const lane={ axis, line, direction, cars: roadLayout ? cars.filter(car => spawnRoadOpen(car, settings.blockSize, STOP_LINE)) : cars, radius };
  if(roadLayout)seedParking(lane,settings.blockSize);
  return lane;
}
