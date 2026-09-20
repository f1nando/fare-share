import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, CAR_GAP, FLASH_DURATION, headlightsOn, updateTraffic, occupiesTrack, resetSignal, greenLight } from '../src/city/world.js';

const vehicle = (position, track, taxi = false) => ({
  position, track, fromTrack: track, offset: TRACKS[track], taxi,
  speed: taxi ? 8.5 : 3.2, cruise: taxi ? 8.5 : 3.2,
  cooldown: 0, changing: false, merge: 1, steer: 0,
});

test('three flashes make the leading car accelerate and yield in both directions', () => {
  for (const direction of [-1, 1]) {
    const taxi = vehicle(0, 0, true), leader = vehicle(direction * 10, 0);
    const cars = [taxi, leader];
    let flashes = 0, previous = false;
    for (let frame = 0; frame < 150; frame++) {
      updateTraffic(cars, direction, 0.02, true);
      const on = headlightsOn(taxi);
      if (on && !previous) flashes++;
      previous = on;
      if (frame < 50) assert.equal(leader.track, 0);
    }
    assert.equal(flashes, 3);
    assert.equal(headlightsOn(taxi), false);
    assert.equal(leader.track, 1);
    assert.ok(leader.speed > leader.cruise);
    assert.equal(taxi.track, 0);
  }
});

test('a blocked adjacent lane postpones yielding without overlap', () => {
  const taxi = vehicle(0, 0, true), leader = vehicle(10, 0), neighbour = vehicle(10, 1);
  const cars = [taxi, leader, neighbour];
  for (let i = 0; i < 80; i++) updateTraffic(cars, 1, 0.02, true);
  assert.ok(leader.yieldRemaining > 0);
  assert.equal(leader.track, 0);
  assert.equal(neighbour.yieldRemaining, 0);
});

test('taxi can flash at a red queue, and recycling clears old flashes', () => {
  const taxi = vehicle(0, 0, true), leader = vehicle(10, 0);
  updateTraffic([taxi, leader], 1, 0.05, false, { weaving: 0 });
  assert.equal(headlightsOn(taxi), true);
  assert.ok(leader.yieldRemaining > 0);
  resetSignal(taxi);
  assert.equal(headlightsOn(taxi), false);
  assert.equal(taxi.signalWait, 0);
  taxi.flashAge = FLASH_DURATION;
  assert.equal(headlightsOn(taxi), false);
});

test('dense traffic with requests keeps clearances through light changes', () => {
  for (const direction of [-1, 1]) {
    const cars = Array.from({ length: 30 }, (_, i) => vehicle(direction * (Math.floor(i / 2) * 9.5 + (i % 2) * 4.75), i % 2, i % 7 === 0));
    for (let frame = 0; frame < 800; frame++) {
      updateTraffic(cars, direction, 0.05, greenLight(frame * 0.05, 0));
      for (const track of [0, 1]) {
        const members = cars.filter(car => occupiesTrack(car, track)).sort((a, b) => a.position - b.position);
        for (let i = 1; i < members.length; i++) assert.ok(members[i].position - members[i - 1].position >= CAR_GAP - 1e-8);
      }
    }
  }
});
