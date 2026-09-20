import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom, advanceVehicle, greenLight, BLOCK, STOP_LINE, TRACKS, CAR_GAP, canMerge, occupiesTrack, updateTraffic } from '../src/city/world.js';

test('a block keeps the same layout after being unloaded and regenerated', () => {
  const a = seededRandom(-193, 204), b = seededRandom(-193, 204), c = seededRandom(-192, 204);
  const sample = (random) => Array.from({ length: 30 }, random);
  assert.deepEqual(sample(a), sample(b));
  assert.notDeepEqual(sample(seededRandom(-193, 204)), sample(c));
});

const vehicle = (position, track, taxi = false) => ({
  position, track, fromTrack: track, offset: TRACKS[track], taxi,
  speed: taxi ? 8.5 : 3.2, cruise: taxi ? 8.5 : 3.2,
  cooldown: 0, changing: false, merge: 1, steer: 0,
});

test('taxis merge to pass slower traffic and cannot merge into an occupied gap', () => {
  const taxi = vehicle(0, 0, true), leader = vehicle(9, 0), neighbour = vehicle(1, 1);
  assert.equal(canMerge(taxi, [taxi, leader, neighbour], 1, 1), false);
  const cars = [taxi, leader];
  updateTraffic(cars, 1, 0.05, true);
  assert.equal(taxi.changing, true);
  assert.equal(taxi.track, 1);
  assert.ok(taxi.offset > TRACKS[0] && taxi.offset < TRACKS[1]);
  for (let i = 0; i < 9; i++) updateTraffic(cars, 1, 0.05, true);
  assert.equal(taxi.offset, TRACKS[1]);
  for (let i = 0; i < 80; i++) updateTraffic(cars, 1, 0.05, true);
  assert.ok(taxi.position > leader.position);
});

test('taxis weave between staggered cars instead of staying in the passing lane', () => {
  const taxi = vehicle(0, 0, true);
  const cars = [taxi, vehicle(12, 0), vehicle(35, 1), vehicle(60, 0)];
  let switches = 0, previousTrack = taxi.track;
  for (let frame = 0; frame < 300; frame++) {
    updateTraffic(cars, 1, 0.05, true);
    if (taxi.track !== previousTrack) switches++;
    previousTrack = taxi.track;
  }
  assert.ok(switches >= 2);
});

test('ordinary cars open a larger gap when traffic starts moving', () => {
  const leader = vehicle(8, 0), follower = vehicle(0, 0);
  follower.speed = 0;
  for (let frame = 0; frame < 100; frame++) updateTraffic([leader, follower], 1, 0.05, true);
  assert.ok(leader.position - follower.position > 8);
});

test('dense traffic keeps distance through merges and stop phases in either direction', () => {
  for (const direction of [-1, 1]) {
    const cars = Array.from({ length: 30 }, (_, i) => vehicle(direction * (Math.floor(i / 2) * 9.5 + (i % 2) * 4.75), i % 2, i % 7 === 0));
    for (let frame = 0; frame < 700; frame++) {
      updateTraffic(cars, direction, 0.05, greenLight(frame * 0.05, 0));
      for (let track = 0; track < 2; track++) {
        const members = cars.filter(car => occupiesTrack(car, track)).sort((a, b) => a.position - b.position);
        for (let i = 1; i < members.length; i++) assert.ok(members[i].position - members[i - 1].position >= CAR_GAP - 1e-8);
      }
      for (const car of cars) assert.ok(car.offset >= TRACKS[0] && car.offset <= TRACKS[1]);
    }
  }
});

test('opposing road axes never have green simultaneously and have a clearing phase', () => {
  for (let time = 0; time < 100; time += 0.1) assert.ok(!(greenLight(time, 0) && greenLight(time, 1)));
  assert.equal(greenLight(9, 0), false);
  assert.equal(greenLight(9, 1), false);
});

test('cars stop before crossings in both directions, including negative world coordinates', () => {
  const stop = BLOCK - STOP_LINE;
  assert.ok(Math.abs(advanceVehicle(stop - 0.5, 1, 1, false) - stop) < 1e-9);
  assert.ok(Math.abs(advanceVehicle(-stop + 0.5, 1, -1, false) + stop) < 1e-9);
  assert.ok(Math.abs(advanceVehicle(-STOP_LINE - 0.5, 1, 1, false) + STOP_LINE) < 1e-9);
  assert.equal(advanceVehicle(stop - 0.5, 1, 1, true), stop + 0.5);
  assert.equal(advanceVehicle(BLOCK - 2, 1, 1, false), BLOCK - 1);
});
