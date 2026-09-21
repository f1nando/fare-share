import test from 'node:test';
import assert from 'node:assert/strict';
import { STOP_LINE, TRACKS, updateTraffic } from '../src/city/world.js';
import { intersectionAccess } from '../src/city/intersections.js';

const vehicle = (position, taxi = false) => ({ axis: 0, line: 0, direction: 1, position, taxi,
  track: 0, fromTrack: 0, offset: TRACKS[0], speed: taxi ? 16 : 8, cruise: taxi ? 16 : 8,
  acceleration: taxi ? 26 : 4, changing: false, merge: 1, cooldown: Infinity, steer: 0, flashCooldown: Infinity });

test('visible stop is approached with bounded braking and no last-frame speed cut', () => {
  for (const taxi of [false, true]) for (const direction of [-1, 1]) {
    const car = { ...vehicle((-STOP_LINE - 18) * direction, taxi), direction };
    const obstacle = { ...vehicle(0), axis: 1, speed: 0, cruise: 0 };
    const lanes = new Map([[`0:0:${direction}`, { cars: [car] }], ['1:0:1', { cars: [obstacle] }]]);
    let brakingFrames = 0;
    for (let i = 0; i < 300; i++) {
      const before = car.speed;
      updateTraffic([car], direction, 0.02, false, { blockSize: 40, crossingAccess: intersectionAccess(lanes, 40, 12) });
      const slowdown = before - car.speed;
      if (slowdown > 0.01) brakingFrames++;
      assert.ok(slowdown < (taxi ? 13 : 7) * 0.02 + 0.015, `single-frame drop ${slowdown}`);
      assert.ok(car.position * direction <= -STOP_LINE + 1e-8);
    }
    assert.ok(brakingFrames > 20);
    assert.ok(car.speed < 0.01);
    assert.ok(Math.abs(car.position * direction + STOP_LINE) < 0.01);
  }
});

test('previewing a clear red crossing neither reserves it nor changes the taxi', () => {
  const car = vehicle(-STOP_LINE - 8, true);
  const access = intersectionAccess(new Map([['0:0:1', { cars: [car] }]]), 40, 12);
  const before = { ...car };
  assert.equal(access.preview(car, 9, false, Infinity, car.speed), true);
  assert.deepEqual(car, before);
  assert.equal(access(car, 0.2, false, Infinity, car.speed), false);
  assert.equal(car.crossing, undefined);
});

test('space reserved for an overtaking taxi opens progressively instead of acting as an invisible bumper', () => {
  const leader = vehicle(0), front = vehicle(10), taxi = vehicle(-5, true);
  taxi.track = taxi.fromTrack = -1; taxi.offset = -TRACKS[0];
  taxi.overtake = { leader, remaining: 4, returnSpace: 16, returnTrack: 0, passTrack: -1 };
  updateTraffic([front, leader, taxi], 1, 0.02, true, { blockSize: 40 });
  assert.ok(leader.speed > 7.8 && leader.speed < 8);
  assert.ok(leader.position > 0.15);
});
