import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/city/settings.js';
import { populateLane } from '../src/city/trafficPopulation.js';
import { vehicleGap } from '../src/city/vehicleTypes.js';

test('missing or invalid saved settings retain working defaults', () => {
  for (const input of [null, undefined, 'bad', [], { density: 'many', zoom: NaN, paused: 'yes' }]) {
    assert.deepEqual(normalizeSettings(input), DEFAULT_SETTINGS);
  }
});

test('saved controls clamp to supported ranges and ignore unknown fields', () => {
  const settings = normalizeSettings({ density: 999, taxiShare: -10, blockSize: 35, zoom: Infinity, cameraSpeed: 0, paused: true, injected: 123 });
  assert.equal(settings.density, 200);
  assert.equal(settings.taxiShare, 0);
  assert.equal(settings.blockSize, 36);
  assert.equal(settings.zoom, 80);
  assert.equal(settings.cameraSpeed, 0);
  assert.equal(settings.paused, true);
  assert.equal(settings.injected, undefined);
  assert.equal(DEFAULT_SETTINGS.density, 70);
});

test('maximum density starts mixed vehicles with room for their bodies and safety gap', () => {
  for (let line = -5; line <= 5; line++) {
    const lane = populateLane(0, line, 1, { ...DEFAULT_SETTINGS, density: 200 }, 3, 0);
    for (const track of [0, 1]) {
      const cars = lane.cars.filter(car => car.track === track).sort((a, b) => a.position - b.position);
      for (let i = 1; i < cars.length; i++) assert.ok(cars[i].position - cars[i - 1].position >= vehicleGap(cars[i], cars[i - 1]));
    }
  }
});
