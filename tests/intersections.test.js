import test from 'node:test';
import assert from 'node:assert/strict';
import { intersectionAccess } from '../src/city/intersections.js';
import { STOP_LINE, TRACKS, greenLight, updateTraffic, resetSignal } from '../src/city/world.js';

const BLOCK = 40;
const vehicle = (axis, direction, position, taxi = false, line = 0, track = 0) => ({
  axis, direction, position, taxi, line, track, fromTrack: track, offset: TRACKS[track],
  speed: taxi ? 16 : 8, cruise: taxi ? 16 : 8, acceleration: taxi ? 25 : 4,
  cooldown: 0, changing: false, merge: 1, flashCooldown: Infinity,
});
function scene(cars) {
  const lanes = new Map();
  for (const car of cars) {
    const key = `${car.axis}:${car.line}:${car.direction}`;
    if (!lanes.has(key)) lanes.set(key, { axis: car.axis, direction: car.direction, cars: [] });
    lanes.get(key).cars.push(car);
  }
  return (time, delta = 0.02) => {
    const crossingAccess = intersectionAccess(lanes, BLOCK, time);
    for (const lane of lanes.values()) updateTraffic(lane.cars, lane.direction, delta, greenLight(time, lane.axis),
      { blockSize: BLOCK, weaving: 0, crossingAccess });
  };
}

test('taxi flies through an empty red crossing at entry speed on both axes and directions', () => {
  for (const axis of [0, 1]) for (const direction of [-1, 1]) for (const junction of [-80, 0, 80]) {
    const car = vehicle(axis, direction, junction - direction * 6, true, -2);
    const tick = scene([car]);
    for (let i = 0; i < 45; i++) {
      tick(axis === 0 ? 12 : 2);
      assert.ok(Math.abs(car.speed - 16) < 1e-9);
    }
    assert.ok((car.position - junction) * direction > STOP_LINE);
  }
});

test('ordinary cars still stop at red, taxis wait for occupied crossings and blocked exits', () => {
  for (const mode of ['ordinary', 'occupied', 'approaching', 'blocked-exit']) {
    const car = vehicle(0, 1, -6, mode !== 'ordinary');
    const cars = [car];
    if (mode === 'occupied') cars.push(vehicle(1, 1, 0));
    if (mode === 'approaching') cars.push(vehicle(1, 1, -12));
    if (mode === 'blocked-exit') {
      const stopped = vehicle(0, 1, 7); stopped.speed = stopped.cruise = 0; cars.push(stopped);
    }
    const tick = scene(cars);
    for (let i = 0; i < 8; i++) tick(12);
    assert.ok(car.position <= -STOP_LINE + 1e-9, mode);
  }
});

test('taxi waits for cross traffic then accelerates through the gap while still red', () => {
  const taxi = vehicle(0, 1, -6, true), crossing = vehicle(1, 1, -8);
  const tick = scene([taxi, crossing]);
  let stopped = false, crossed = false;
  for (let frame = 0; frame < 180; frame++) {
    tick(12);
    stopped ||= taxi.speed < 0.01;
    crossed ||= taxi.position > STOP_LINE;
    assert.ok(!(Math.abs(taxi.position) < STOP_LINE - 0.001 && Math.abs(crossing.position) < STOP_LINE - 0.001));
  }
  assert.ok(stopped && crossed);
});

test('committed taxi keeps the crossing across light changes and releases it afterwards', () => {
  const taxi = vehicle(0, 1, -STOP_LINE, true);
  const cross = vehicle(1, 1, -STOP_LINE);
  const tick = scene([taxi, cross]);
  tick(9); // Both red; ordinary cross traffic is stopped.
  assert.equal(Math.abs(taxi.crossing), 0);
  for (let frame = 0; frame < 200; frame++) {
    tick(11 + frame * 0.02); // Perpendicular light turns green during the manoeuvre.
    assert.ok(!(Math.abs(taxi.position) < STOP_LINE - 0.001 && Math.abs(cross.position) < STOP_LINE - 0.001));
  }
  assert.ok(cross.position > STOP_LINE);
  resetSignal(taxi);
  assert.equal(taxi.crossing, undefined);
});

test('cross-traffic lookup respects road axes, directions and negative block coordinates', () => {
  for (const axis of [0, 1]) for (const direction of [-1, 1]) for (const crossDirection of [-1, 1]) {
    const taxi = vehicle(axis, direction, -120 - direction * 6, true, -2);
    const crossing = vehicle(1 - axis, crossDirection, -80 - crossDirection * 2, false, -3);
    const tick = scene([taxi, crossing]);
    for (let frame = 0; frame < 8; frame++) tick(axis === 0 ? 12 : 2);
    assert.ok((taxi.position + 120) * direction <= -STOP_LINE + 1e-9);
  }
});

test('two red-running taxis never claim the same crossing on perpendicular axes', () => {
  const first = vehicle(0, 1, -STOP_LINE, true), second = vehicle(1, -1, 6, true);
  const tick = scene([first, second]);
  for (let frame = 0; frame < 400; frame++) {
    tick(frame * 0.02);
    assert.ok(!(Math.abs(first.position) < STOP_LINE - 0.001 && Math.abs(second.position) < STOP_LINE - 0.001));
  }
  assert.ok(first.position > STOP_LINE && second.position < -STOP_LINE);
});
