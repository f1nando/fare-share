import test from 'node:test';
import assert from 'node:assert/strict';
import { districtKind, districtLayout, populateDistrict } from '../src/city/districts.js';
import { populateBlock } from '../src/city/createCity.js';
import { parkAt } from '../src/city/roadLayout.js';
import { PAVED_ROAD, seededRandom } from '../src/city/world.js';

const palette = { grass: ['#b8b8b8', '#c4c4c4', '#aeaeae'], paving: '#cdcdcd',
  buildings: ['#eeeeee', '#d3d3d3', '#e2e2e2', '#c6c6c6', '#f3f3f3'] };
function districtParts(kind, gx, gz) {
  const parts = [];
  populateDistrict(kind, { gx, gz, palette, random: seededRandom(gx, gz),
    put: (...part) => parts.push(part),
    tree: (x, z, size) => {
      parts.push(['box', x, 0.85, z, 0.32, 1.45, 0.32]);
      parts.push(['crown', x, 1.55 + size * 0.65, z, 1.25 * size, 1.55 * size, 1.2 * size]);
    } });
  return parts;
}

test('each district gets five distinct compositions with bounded batched geometry', () => {
  const seen = new Map(), silhouettes = new Map();
  for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) {
    const kind = districtKind(x, z), { variant, turns } = districtLayout(x, z);
    const key = `${kind}:${variant}:${turns}`;
    if (seen.has(key)) continue;
    const parts = districtParts(kind, x, z);
    seen.set(key, true);
    assert.deepEqual(districtParts(kind, x, z), parts, 'repeatable world-coordinate seed');
    assert.ok(parts.length <= 13, `${key}: no more instances than the previous largest district`);
    for (const [type, px, py, pz, w, h, d] of parts) {
      assert.ok([px, py, pz, w, h, d].every(Number.isFinite));
      assert.ok(w > 0 && h > 0 && d > 0);
      if (type === 'building') {
        // Original lots rely on populateBlock's shoulder clamp; new templates
        // fit the smallest block even before that shared protection is applied.
        if (variant) {
          assert.ok(px - w / 2 >= 5 && px + w / 2 <= 19);
          assert.ok(pz - d / 2 >= 5 && pz + d / 2 <= 19);
        }
        assert.ok(py + h / 2 <= 8.05);
      }
    }
    if (turns === 0) {
      const shapes = silhouettes.get(kind) ?? new Set();
      shapes.add(JSON.stringify(parts.filter(p => p[0] === 'building').map(p => [p[1], p[3], p[4], p[6]])));
      silhouettes.set(kind, shapes);
    }
  }
  assert.equal(seen.size, 3 * 5 * 4, 'all variants and orientations occur in the world');
  for (const shapes of silhouettes.values()) assert.equal(shapes.size, 5);
});

test('industrial compositions preserve the existing parking apron and markings', () => {
  let apron;
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) {
    const actual = districtParts('industrial', x, z).filter(p => p[0] === 'paving' && p[3] === 18);
    assert.equal(actual.length, 7);
    if (apron) assert.deepEqual(actual, apron);
    apron = actual;
  }
});

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
