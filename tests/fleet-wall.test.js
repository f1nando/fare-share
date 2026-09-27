import test from 'node:test';
import assert from 'node:assert/strict';
import { fleetColumnCount, fleetRoadStrip } from '../src/fleetWall.js';

test('fleet wall renders only columns visible at the current breakpoint', () => {
  assert.equal(fleetColumnCount(390), 2);
  assert.equal(fleetColumnCount(600), 3);
  assert.equal(fleetColumnCount(900), 4);
  assert.equal(fleetColumnCount(1200), 5);
  assert.equal(fleetColumnCount(1500), 6);
  assert.equal(fleetColumnCount(1920), 7);
});

test('one SVG strip spans the same fifteen road-mark positions', () => {
  const strip = fleetRoadStrip({ markSpacing: 37, markWidth: 17 });
  assert.equal(strip.width, 535);
  assert.ok(Math.abs(strip.height - 17 * 56 / 360) < 1e-12);
  assert.equal((strip.width - 17) / 37 + 1, 15);
});
