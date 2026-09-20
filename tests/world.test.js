import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom, advanceVehicle, greenLight } from '../src/city/world.js';

test('a block keeps the same layout after being unloaded and regenerated', () => {
  const a = seededRandom(-193, 204), b = seededRandom(-193, 204), c = seededRandom(-192, 204);
  const sample = (random) => Array.from({ length: 30 }, random);
  assert.deepEqual(sample(a), sample(b));
  assert.notDeepEqual(sample(seededRandom(-193, 204)), sample(c));
});

test('opposing road axes never have green simultaneously and have a clearing phase', () => {
  for (let time = 0; time < 100; time += 0.1) assert.ok(!(greenLight(time, 0) && greenLight(time, 1)));
  assert.equal(greenLight(9, 0), false);
  assert.equal(greenLight(9, 1), false);
});

test('cars stop before crossings in both directions, including negative world coordinates', () => {
  assert.equal(advanceVehicle(19, 1, 1, false), 19.6);
  assert.equal(advanceVehicle(-19, 1, -1, false), -19.6);
  assert.ok(Math.abs(advanceVehicle(-5, 1, 1, false) + 4.4) < 1e-9);
  assert.equal(advanceVehicle(19, 1, 1, true), 20);
  assert.equal(advanceVehicle(22, 1, 1, false), 23);
});
