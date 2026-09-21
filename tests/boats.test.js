import test from 'node:test';
import assert from 'node:assert/strict';
import { addBoats } from '../src/city/boats.js';
import { canalDimensions, CANAL_WATER_LEVEL } from '../src/city/canal.js';
import { bridgeHeight } from '../src/city/bridgeProfile.js';

function scene(block, worldX, worldZ, time, area = { x: 2, z: 6 }) {
  const parts = [];
  addBoats({ add: (...part) => parts.push(part) }, block, worldX, worldZ, area, time);
  return parts;
}
const hulls = parts => parts.filter(p => p[0] === 'boat' && p[2] < CANAL_WATER_LEVEL + 0.1);

test('canals show more boats simultaneously in both directions', () => {
  const boats = hulls(scene(40, 0, 0, 0));
  assert.ok(boats.length >= 21 && boats.length <= 24, '13 blocks have about 23 boats instead of nine');
  assert.ok(Math.max(...boats.map(p => p[6])) > Math.min(...boats.map(p => p[6])) * 2);
  assert.equal(new Set(boats.map(p => p[6])).size, 4);
  assert.ok(boats.some(p => p[8] === 0) && boats.some(p => p[8] === Math.PI));
});

test('boat sizes and positions remain continuous across camera origin shifts', () => {
  const time = 117;
  const before = hulls(scene(40, 0, 0, time));
  const shifted = hulls(scene(40, 1, 1, time));
  let compared = 0;
  for (const a of before) {
    const b = shifted.find(p => Math.abs(p[1] + 40 - a[1]) < 1e-8 && Math.abs(p[3] + 40 - a[3]) < 1e-8);
    if (!b) continue;
    assert.deepEqual(b.slice(4), a.slice(4));
    compared++;
  }
  assert.ok(compared >= before.length - 4);
  const moving = hulls(scene(40, 0, 0, time + 0.1));
  for (const a of before) {
    const direction = a[8] === 0 ? 1 : -1;
    const b = moving.find(p => p[1] === a[1] && Math.abs(p[3] - a[3]) < 1);
    assert.ok(b && (b[3] - a[3]) * direction > 0);
    assert.deepEqual(b.slice(4), a.slice(4));
  }
});

test('all boat models fit the narrowest canal and clear bridge undersides', () => {
  for (const block of [24, 40, 48]) for (const worldX of [-12, 0, 12]) {
    const { left, right } = canalDimensions(block);
    const parts = scene(block, worldX, -3, 250);
    for (const p of parts) {
      assert.ok(p.slice(1, 7).every(Number.isFinite));
      assert.ok(p[1] - p[4] / 2 > left && p[1] + p[4] / 2 < right, 'stay inside the banks');
      if (p[0] !== 'box') continue;
      const underside = Math.min(bridgeHeight(p[1] - p[4] / 2, block), bridgeHeight(p[1] + p[4] / 2, block)) - 0.6;
      assert.ok(p[2] + p[5] / 2 < underside, 'cabin roofs clear the bridge');
    }
  }
});
