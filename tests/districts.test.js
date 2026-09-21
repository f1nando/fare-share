import test from 'node:test';
import assert from 'node:assert/strict';
import { districtKind } from '../src/city/districts.js';
import { populateBlock } from '../src/city/createCity.js';
import { parkAt } from '../src/city/roadLayout.js';
import { PAVED_ROAD } from '../src/city/world.js';

test('neighbourhoods stay contiguous across positive and negative world coordinates', () => {
  const types = new Set();
  for (let x = -10; x <= 10; x += 2) for (let z = -10; z <= 10; z += 2) {
    const kind = districtKind(x, z); types.add(kind);
    for (const dx of [0, 1]) for (const dz of [0, 1]) assert.equal(districtKind(x + dx, z + dz), kind);
  }
  assert.deepEqual(types, new Set(['residential', 'centre', 'industrial']));
});

test('new buildings clear the driveable shoulder at all block sizes and retain the previous height envelope', () => {
  let buildings = 0;
  for (const block of [24, 40, 48]) for (let gx = -5; gx <= 5; gx++) for (let gz = -5; gz <= 5; gz++) {
    if (parkAt(gx, gz)) continue;
    const parts = [];
    populateBlock({ add: (...part) => parts.push(part) }, gx, gz, 0, 0, block);
    for (const [kind, x, y, z, width, height, depth] of parts) {
      assert.ok([x, y, z, width, height, depth].every(Number.isFinite));
      assert.ok(width > 0 && height > 0 && depth > 0);
      if (kind !== 'building') continue;
      buildings++;
      const inset = PAVED_ROAD / 2 + 0.9 - 1e-8;
      assert.ok(x - width / 2 >= inset && z - depth / 2 >= inset);
      assert.ok(x + width / 2 <= block - inset && z + depth / 2 <= block - inset);
      assert.ok(y + height / 2 <= 8.05, 'preserve the established culling/shadow height allowance');
    }
  }
  assert.ok(buildings > 500);
});
