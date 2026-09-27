import test from 'node:test';
import assert from 'node:assert/strict';
import { FOLIAGE_SWAY_DURATION, claimGestureTarget, foliageSwayAngle } from '../src/city/foliageAnimation.js';

test('clicked foliage sways both ways and returns exactly to rest', () => {
  const samples = Array.from({ length: 80 }, (_, index) => foliageSwayAngle(index * FOLIAGE_SWAY_DURATION / 80));
  assert.ok(samples.some(angle => angle > 0.1));
  assert.ok(samples.some(angle => angle < -0.1));
  assert.equal(foliageSwayAngle(0), 0);
  assert.equal(foliageSwayAngle(FOLIAGE_SWAY_DURATION), 0);
  assert.equal(foliageSwayAngle(FOLIAGE_SWAY_DURATION + 100), 0);
});

test('a held-pointer gesture activates each object once until release', () => {
  const touched = new Set(), tree = {}, taxi = {};
  assert.equal(claimGestureTarget(touched, tree), true);
  assert.equal(claimGestureTarget(touched, tree), false);
  assert.equal(claimGestureTarget(touched, taxi), true);
  touched.clear();
  assert.equal(claimGestureTarget(touched, tree), true);
});

test('sway direction can be mirrored and reduced-motion stays subtle', () => {
  const elapsed = 180;
  assert.equal(foliageSwayAngle(elapsed, -1), -foliageSwayAngle(elapsed, 1));
  assert.ok(Math.abs(foliageSwayAngle(elapsed, 1, true)) < Math.abs(foliageSwayAngle(elapsed)));
});
