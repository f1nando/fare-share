import test from 'node:test';
import assert from 'node:assert/strict';
import { sharkGeometry, animateSharkTail, addSharks } from '../src/city/sharks.js';
import { canalDimensions, CANAL_WATER_LEVEL } from '../src/city/canal.js';

function frame(block, worldX, worldZ, time) {
  const parts = [];
  addSharks({ add: (...p) => parts.push(p) }, block, worldX, worldZ, { x: 3, z: 6 }, time);
  return parts;
}

test('sharks are sparse, remain inside the canal and stay below boats and wakes', () => {
  const geometry = sharkGeometry();
  for (const block of [24, 40, 64]) for (const column of [-12, 0, 12]) for (const time of [0, 15, 120, 900]) {
    const parts = frame(block, column, 0, time);
    assert.ok(parts.length >= 2 && parts.length <= 4);
    const { left, right } = canalDimensions(block);
    animateSharkTail(geometry, time);
    for (const p of parts) {
      assert.equal(p[2], CANAL_WATER_LEVEL + 0.012);
      for (let i = 0; i < geometry.attributes.position.count; i++) {
        const localX = geometry.attributes.position.getX(i) * p[4];
        const localZ = geometry.attributes.position.getZ(i) * p[6];
        const x = p[1] + localX * Math.cos(p[8]) + localZ * Math.sin(p[8]);
        assert.ok(x > left && x < right, 'whole silhouette stays within the banks');
      }
    }
  }
  geometry.dispose();
});

test('world-anchored swimming stays continuous through rebasing and pause', () => {
  const before = frame(40, 0, 0, 15), after = frame(40, 1, 1, 15);
  assert.deepEqual(frame(40, 0, 0, 15), before);
  for (const p of before) {
    const match = after.find(q => Math.abs(q[1] + 40 - p[1]) < 1e-8 && Math.abs(q[3] + 40 - p[3]) < 1e-8);
    assert.ok(match);
    assert.deepEqual(match.slice(4), p.slice(4));
  }
  assert.notDeepEqual(frame(40, 0, 0, 16), before);
});

test('the first canal starts with a shark in the initial camera view, between bridges', () => {
  for (const block of [24, 40, 64]) {
    const parts = frame(block, 0, 0, 0);
    const shark = parts.find(p => Math.abs(p[3] - block / 2) < 1e-8);
    assert.ok(shark, 'a shark is guaranteed in the first canal block');
    assert.equal(shark[1], block / 2);
    const later = frame(block, 0, 0, 1).find(p => Math.abs(p[3] - block / 2 - 1.7) < 1e-8);
    assert.ok(later, 'the initial shark swims away continuously');
  }
});

test('tail motion deforms a tiny shared mesh without moving its nose or accumulating drift', () => {
  const geometry = sharkGeometry(), position = geometry.attributes.position;
  assert.ok(position.count < 100);
  animateSharkTail(geometry, 2);
  const first = position.array.slice();
  animateSharkTail(geometry, 3);
  assert.notDeepEqual(position.array, first);
  animateSharkTail(geometry, 2);
  assert.deepEqual(position.array, first);
  for (let i = 0; i < position.count; i++) if (position.getZ(i) > 1)
    assert.equal(position.getX(i), geometry.userData.rest[i * 3]);
  geometry.dispose();
});
