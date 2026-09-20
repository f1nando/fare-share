import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, CAR_GAP, ONCOMING_TRACK, updateTraffic, occupiesTrack, canMerge, greenTimeLeft, resetSignal, seededRandom } from '../src/city/world.js';

const vehicle = (position, track, taxi = false) => ({
  position, track, fromTrack: track, offset: TRACKS[track], taxi,
  speed: taxi ? 12 : 4, cruise: taxi ? 16 : 4, acceleration: taxi ? 25 : 4,
  cooldown: 0, changing: false, merge: 1, steer: 0, flashCooldown: Infinity,
});
const scenario = (direction = 1) => {
  const taxi = vehicle(direction * 6, 0, true);
  return { taxi, leader: vehicle(direction * 13, 0), neighbour: vehicle(direction * 7, 1) };
};

test('taxi passes on a clear oncoming lane and smoothly returns ahead in either direction', () => {
  for (const direction of [-1, 1]) {
    const { taxi, leader, neighbour } = scenario(direction);
    const cars = [taxi, leader, neighbour];
    let borrowed = false, returned = false;
    for (let frame = 0; frame < 150; frame++) {
      updateTraffic(cars, direction, 0.02, true, { blockSize: 40, opposing: [] });
      borrowed ||= taxi.offset < 0;
      if (borrowed && !taxi.changing && taxi.track === 0) {
        assert.ok((taxi.position - leader.position) * direction > CAR_GAP);
        returned = true;
        break;
      }
      assert.ok(Number.isFinite(taxi.offset) && Math.abs(taxi.steer) <= Math.PI / 15);
    }
    assert.ok(borrowed && returned);
    assert.equal(taxi.overtake, null);
  }
});

test('oncoming traffic, missing return space, red light and nearby junction block overtaking', () => {
  for (const mode of ['oncoming', 'merging-oncoming', 'return-slot', 'red', 'junction', 'green-ending', 'disabled']) {
    const { taxi, leader, neighbour } = scenario();
    const cars = [taxi, leader, neighbour];
    const opposing = [];
    if (mode.includes('oncoming')) {
      const approaching = vehicle(48, 0);
      approaching.speed = approaching.cruise = 15;
      if (mode === 'merging-oncoming') { approaching.track = 1; approaching.changing = true; }
      opposing.push(approaching);
    }
    if (mode === 'return-slot') cars.push(vehicle(24, 0));
    if (mode === 'junction') cars.forEach(car => car.position += 30);
    updateTraffic(cars, 1, 0.02, mode !== 'red', {
      blockSize: 40, opposing, greenRemaining: mode === 'green-ending' ? 0.5 : 8,
      weaving: mode === 'disabled' ? 0 : 1,
    });
    assert.notEqual(taxi.track, ONCOMING_TRACK, mode);
  }
});

test('default-density traffic with flashing produces actual oncoming overtakes', () => {
  const random = seededRandom(1, 2), streams = [[], []];
  let passes = 0;
  for (const cars of streams) for (let track = 0; track < 2; track++) for (let i = 0; i < 35; i++) {
    const car = vehicle(-250 + i * 15 + track * 7.5 + random() * 1.5, track, random() < 0.07);
    car.speed = car.cruise = car.taxi ? (13 + random() * 2) * 1.2 : (3.4 + random() * 4.2) * 1.3;
    car.flashCooldown = 0;
    cars.push(car);
  }
  for (let frame = 0; frame < 2400; frame++) for (let d = 0; d < 2; d++) {
    const cars = streams[d], opposing = streams[1 - d];
    const previous = new Set(cars.filter(car => car.overtake));
    const remaining = greenTimeLeft(frame * 0.025, 0);
    updateTraffic(cars, d === 0 ? 1 : -1, 0.025, remaining > 0,
      { blockSize: 40, weaving: 0.1, opposing, greenRemaining: remaining });
    passes += cars.filter(car => car.overtake && !previous.has(car)).length;
    for (const car of cars.filter(car => occupiesTrack(car, -1))) {
      for (const other of opposing.filter(other => occupiesTrack(other, 0))) {
        assert.ok(Math.abs(car.position - other.position) >= CAR_GAP);
      }
    }
  }
  assert.ok(passes > 0, 'overtaking should occur with the saved default settings');
});

test('active overtake reserves return slot and prevents an oncoming car from merging into its path', () => {
  const { taxi, leader, neighbour } = scenario();
  const cars = [taxi, leader, neighbour];
  updateTraffic(cars, 1, 0.02, true, { blockSize: 40, opposing: [] });
  assert.equal(taxi.track, ONCOMING_TRACK);
  const intruder = vehicle(21, 1);
  assert.equal(canMerge(intruder, [...cars, intruder], 0, 1), false);
  const approaching = vehicle(35, 1);
  assert.equal(canMerge(approaching, [approaching], 0, -1, cars), false);
  resetSignal(taxi);
  assert.equal(taxi.track, 0);
  assert.equal(taxi.offset, TRACKS[0]);
  assert.equal(taxi.overtake, null);
});

test('two-way traffic stays separated while taxis overtake through repeated light phases', () => {
  const forward = [], backward = [];
  for (const direction of [-1, 1]) {
    const cars = direction === 1 ? forward : backward;
    for (let block = -4; block <= 4; block++) {
      const { taxi, leader, neighbour } = scenario(direction);
      for (const car of [taxi, leader, neighbour]) { car.position += block * 40; cars.push(car); }
    }
  }
  for (let frame = 0; frame < 800; frame++) {
    const time = frame * 0.025;
    const remaining = greenTimeLeft(time, 0);
    for (const [cars, opposing, direction] of [[forward, backward, 1], [backward, forward, -1]]) {
      updateTraffic(cars, direction, 0.025, remaining > 0, { blockSize: 40, opposing, greenRemaining: remaining });
      for (const car of cars) {
        assert.ok(Number.isFinite(car.offset));
        for (const other of opposing) {
          if ((occupiesTrack(car, -1) && occupiesTrack(other, 0)) ||
              (occupiesTrack(car, 0) && occupiesTrack(other, -1))) {
            assert.ok(Math.abs(car.position - other.position) >= CAR_GAP, 'opposing cars must not overlap');
          }
        }
      }
    }
  }
});
