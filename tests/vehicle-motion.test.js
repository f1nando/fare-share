import test from 'node:test';
import assert from 'node:assert/strict';
import { laneChangeSteer, vehiclePose, MAX_MERGE_ANGLE, REAR_AXLE_Z, TRACKS, MERGE_DURATION, updateTraffic } from '../src/city/world.js';

test('turn grows smoothly to the midpoint and symmetrically returns to zero', () => {
  for (const [from, to] of [[0, 1], [1, 0]]) {
    const angles = Array.from({ length: 101 }, (_, i) => laneChangeSteer(i / 100, from, to));
    assert.equal(angles[0], 0);
    assert.equal(angles[100], 0);
    assert.equal(Math.abs(angles[50]), MAX_MERGE_ANGLE);
    for (let i = 1; i <= 50; i++) {
      assert.ok(Math.abs(angles[i]) >= Math.abs(angles[i - 1]));
      assert.ok(Math.abs(angles[i] - angles[100 - i]) < 1e-12);
    }
    assert.ok(Math.abs(angles[1]) < 0.001);
  }
});

test('rear axle stays on its path in every road direction while the nose turns', () => {
  for (const axis of [0, 1]) for (const direction of [-1, 1]) {
    const straight = vehiclePose(12, -8, axis, direction, 0);
    for (const steer of [-MAX_MERGE_ANGLE, 0, MAX_MERGE_ANGLE]) {
      const pose = vehiclePose(12, -8, axis, direction, steer);
      assert.ok(Math.abs(pose.x + REAR_AXLE_Z * pose.sin - (straight.x + REAR_AXLE_Z * straight.sin)) < 1e-12);
      assert.ok(Math.abs(pose.z + REAR_AXLE_Z * pose.cos - (straight.z + REAR_AXLE_Z * straight.cos)) < 1e-12);
    }
    assert.equal(straight.x, 12);
    assert.equal(straight.z, -8);
  }
});

test('slow or stopped merges never snap to ninety degrees and finish straight', () => {
  for (const speed of [0, 0.1, 0.49, 0.51, 15]) {
    const car = { position: 10, track: 1, fromTrack: 0, offset: TRACKS[0], taxi: true,
      speed, cruise: speed, acceleration: 0, cooldown: 2, changing: true, merge: 0, steer: 0 };
    updateTraffic([car], 1, MERGE_DURATION / 2, true);
    assert.equal(car.steer, MAX_MERGE_ANGLE);
    updateTraffic([car], 1, 0, true);
    assert.equal(car.steer, MAX_MERGE_ANGLE);
    updateTraffic([car], 1, MERGE_DURATION / 2, true);
    assert.equal(car.steer, 0);
    assert.equal(car.changing, false);
    assert.equal(car.offset, TRACKS[1]);
  }
});
