import test from 'node:test';
import assert from 'node:assert/strict';
import { FOLIAGE_SWAY_DURATION, claimAnimationStart, claimGestureTarget, foliageSwayAngle, shouldStartBrushAnimation, withinGestureRadius } from '../src/city/foliageAnimation.js';

test('clicked foliage sways both ways and returns exactly to rest', () => {
  const samples = Array.from({ length: 80 }, (_, index) => foliageSwayAngle(index * FOLIAGE_SWAY_DURATION / 80));
  assert.ok(samples.some(angle => angle > 0.1));
  assert.ok(samples.some(angle => angle < -0.1));
  assert.equal(foliageSwayAngle(0), 0);
  assert.equal(foliageSwayAngle(FOLIAGE_SWAY_DURATION), 0);
  assert.equal(foliageSwayAngle(FOLIAGE_SWAY_DURATION + 100), 0);
});

test('a pointer brush activates each object once until it leaves the area', () => {
  const touched = new Set(), tree = {}, taxi = {};
  assert.equal(claimGestureTarget(touched, tree), true);
  assert.equal(claimGestureTarget(touched, tree), false);
  assert.equal(claimGestureTarget(touched, taxi), true);
  touched.clear();
  assert.equal(claimGestureTarget(touched, tree), true);
});

test('gesture brush includes every object inside its circular area', () => {
  const point = { x: 100, y: 100 }, radius = 56;
  assert.equal(withinGestureRadius(100, 100, point, radius), true);
  assert.equal(withinGestureRadius(135, 135, point, radius), true);
  assert.equal(withinGestureRadius(156, 100, point, radius), true);
  assert.equal(withinGestureRadius(157, 100, point, radius), false);
  assert.equal(withinGestureRadius(150, 150, point, radius), false);
});

test('an animation in progress cannot be restarted by another brush pass', () => {
  const touched = new Set(), taxi = {};
  assert.equal(claimAnimationStart(touched, taxi, true), false);
  assert.equal(touched.has(taxi), true, 'active object remains claimed until it leaves the brush');
  assert.equal(claimAnimationStart(touched, taxi, false), false);
  touched.clear();
  assert.equal(claimAnimationStart(touched, taxi, false), true);
});

test('moving objects start only when newly entering the brush and currently idle', () => {
  assert.equal(shouldStartBrushAnimation(false, false), true);
  assert.equal(shouldStartBrushAnimation(true, false), false);
  assert.equal(shouldStartBrushAnimation(false, true), false);
  assert.equal(shouldStartBrushAnimation(true, true), false);
});

test('sway direction can be mirrored and reduced-motion stays subtle', () => {
  const elapsed = 180;
  assert.equal(foliageSwayAngle(elapsed, -1), -foliageSwayAngle(elapsed, 1));
  assert.ok(Math.abs(foliageSwayAngle(elapsed, 1, true)) < Math.abs(foliageSwayAngle(elapsed)));
});
