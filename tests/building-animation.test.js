import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_STRETCH_DURATION, buildingMotion, buildingStretch } from '../src/city/buildingAnimation.js';

test('clicked buildings stretch upward and settle back to their exact size', () => {
  assert.equal(buildingStretch(0), 1);
  assert.ok(buildingStretch(BUILDING_STRETCH_DURATION / 2) > 1.15);
  assert.equal(buildingStretch(BUILDING_STRETCH_DURATION), 1);
  assert.equal(buildingStretch(BUILDING_STRETCH_DURATION + 100), 1);
});

test('reduced-motion building stretch remains subtle', () => {
  assert.ok(buildingStretch(BUILDING_STRETCH_DURATION / 2, true) <= 1.05);
});

test('building reaction visibly stretches, squashes, lifts and wobbles', () => {
  const strong = { strength: 1.3, direction: -1, cycles: 2.5 };
  const middle = buildingMotion(BUILDING_STRETCH_DURATION / 2, false, strong);
  const moving = buildingMotion(BUILDING_STRETCH_DURATION * 0.35, false, strong);
  assert.ok(middle.scaleY > 1.35);
  assert.ok(middle.scaleXZ < 0.9);
  assert.ok(middle.lift > 0.3);
  assert.ok(Math.abs(moving.tilt) > 0.03);
  assert.deepEqual(buildingMotion(BUILDING_STRETCH_DURATION, false, strong),
    { scaleY: 1, scaleXZ: 1, tilt: 0, lift: 0 });
});
