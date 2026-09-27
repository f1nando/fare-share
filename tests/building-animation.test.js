import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_STRETCH_DURATION, buildingStretch } from '../src/city/buildingAnimation.js';

test('clicked buildings stretch upward and settle back to their exact size', () => {
  assert.equal(buildingStretch(0), 1);
  assert.ok(buildingStretch(BUILDING_STRETCH_DURATION / 2) > 1.15);
  assert.equal(buildingStretch(BUILDING_STRETCH_DURATION), 1);
  assert.equal(buildingStretch(BUILDING_STRETCH_DURATION + 100), 1);
});

test('reduced-motion building stretch remains subtle', () => {
  assert.ok(buildingStretch(BUILDING_STRETCH_DURATION / 2, true) <= 1.05);
});
