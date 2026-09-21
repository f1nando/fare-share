import test from 'node:test';
import assert from 'node:assert/strict';
import { populateLane } from '../src/city/trafficPopulation.js';
import { updateTraffic, canMerge, TRACKS, STOP_LINE } from '../src/city/world.js';
import { VEHICLE_KINDS, vehicleType, vehicleGap } from '../src/city/vehicleTypes.js';
import { packTraffic, readAppearance, CAR_STRIDE } from '../src/city/trafficFrames.js';
import { drawTrafficVehicle } from '../src/city/vehicleModels.js';

const settings = { density: 100, taxiShare: 20, blockSize: 40 };
const vehicle = (kind, position, direction = 1) => ({ kind, position: position * direction,
  direction, axis: 0, line: 0, taxi: false, color: '#cccccc', track: 0, fromTrack: 0,
  offset: TRACKS[0], speed: 6, cruise: 6, acceleration: 3, cooldown: 0, steer: 0 });

test('mixed traffic is deterministic, preserves taxis and survives worker transfer', () => {
  const lane = populateLane(0, 0, 1, settings, 10);
  assert.deepEqual(lane, populateLane(0, 0, 1, settings, 10));
  assert.deepEqual(new Set(lane.cars.map(car => car.kind)), new Set(VEHICLE_KINDS));
  assert.ok(lane.cars.filter(car => car.taxi).every(car => car.kind === 'car'));
  assert.equal(populateLane(0, 0, 1, { ...settings, density: 0 }, 10).cars.length, 0);
  const frame = packTraffic(new Map([['lane', lane]]), { ids: new WeakMap(), next: 0, blockSize: 40 });
  lane.cars.forEach((car, i) => assert.equal(readAppearance(frame.data, i * CAR_STRIDE).kind, car.kind));
});

test('all new vehicles move on green and their noses stop before the crossing on red', () => {
  for (const kind of VEHICLE_KINDS.slice(1)) for (const direction of [-1, 1]) {
    const car = vehicle(kind, 15, direction);
    for (let i = 0; i < 240; i++) updateTraffic([car], direction, 1 / 30, false, { blockSize: 40 });
    assert.ok(car.position * direction > 15, `${kind} moves`);
    assert.ok(car.position * direction + vehicleType(car).length / 2 <= 40 - STOP_LINE + 1.125 + 1e-6, `${kind} stops safely`);
    const stopped = car.position * direction;
    for (let i = 0; i < 90; i++) updateTraffic([car], direction, 1 / 30, true, { blockSize: 40 });
    assert.ok(car.position * direction > stopped + 3, `${kind} restarts`);
  }
});

test('mixed queues and lane changes leave room for bus and truck bodies', () => {
  for (const frontKind of VEHICLE_KINDS) for (const rearKind of VEHICLE_KINDS) for (const direction of [-1, 1]) {
    const front = vehicle(frontKind, 25, direction), rear = vehicle(rearKind, 15, direction);
    const cars = [rear, front];
    for (let i = 0; i < 180; i++) {
      updateTraffic(cars, direction, 1 / 30, false, { blockSize: 40 });
      assert.ok((front.position - rear.position) * direction >= vehicleGap(front, rear) - 1e-6);
    }
  }
  const bus = vehicle('bus', 10), car = vehicle('car', 13.3);
  car.track = car.fromTrack = 1;
  assert.equal(canMerge(bus, [bus, car], 1, 1), false);
  car.position = 16;
  assert.equal(canMerge(bus, [bus, car], 1, 1), true);
});

test('models draw two motorcycle wheels or four heavy vehicle wheels with finite transforms', () => {
  for (const kind of VEHICLE_KINDS.slice(1)) {
    const parts = [];
    assert.equal(drawTrafficVehicle((...part) => parts.push(part), vehicle(kind, 0), { wheels: [0, 0, 0, 0] }), true);
    assert.equal(parts.filter(part => part[0] === 'wheel').length, kind === 'motorcycle' ? 2 : 4);
    assert.ok(parts.every(part => part.slice(1, 7).every(Number.isFinite)));
  }
});
