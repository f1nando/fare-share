import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Batches } from '../src/city/Batches.js';
import { SceneryCache } from '../src/city/sceneryCache.js';
import { populateBlock } from '../src/city/createCity.js';

test('cached scenery retains identical transforms and colors across origins and block sizes', () => {
  const geometry = new THREE.BoxGeometry(), geometries = Object.fromEntries(
    ['box', 'round', 'paint', 'paving', 'building', 'crown', 'cone', 'island', 'roundaboutCurb', 'roundaboutWalk', 'roundaboutCapCurb', 'roundaboutCapWalk'].map(kind => [kind, geometry]));
  const cache = new SceneryCache(populateBlock), area = { x: 1, z: 1 };
  for (const blockSize of [24, 40, 48]) for (const [worldX, worldZ] of [[-3, -2], [0, 0], [1, 1], [8, 5]]) {
    const original = new Batches(new THREE.Scene(), geometries), cached = new Batches(new THREE.Scene(), geometries);
    cache.configure(worldX, worldZ, area, blockSize);
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
      populateBlock(original, worldX + x, worldZ + z, x * blockSize, z * blockSize, blockSize);
      cache.draw(cached, worldX + x, worldZ + z, worldX, worldZ);
    }
    original.flush(); cached.flush();
    for (const [kind, mesh] of original.meshes) {
      const actual = cached.meshes.get(kind);
      assert.equal(actual.count, mesh.count);
      assert.deepEqual(actual.instanceMatrix.array, mesh.instanceMatrix.array, kind);
      assert.deepEqual(actual.instanceColor.array, mesh.instanceColor.array, kind);
      assert.ok(actual.boundingSphere.center.distanceTo(mesh.boundingSphere.center) < 1e-8, kind);
      assert.ok(Math.abs(actual.boundingSphere.radius - mesh.boundingSphere.radius) < 1e-8, kind);
    }
    for (let i = 0; i < 12; i++) cache.warmOne();
    assert.ok(cache.tiles.size <= 16);
    original.dispose(); cached.dispose();
  }
  cache.dispose(); assert.equal(cache.tiles.size, 0); geometry.dispose();
});

test('incoming tiles are prepared once and the cache stays bounded while travelling', () => {
  let generated = 0;
  const cache = new SceneryCache(() => { generated++; });
  cache.configure(0, 0, {x:1,z:1}, 40);
  cache.warmOne(); assert.equal(generated, 1);
  cache.get(0, 0); cache.get(0, 0); assert.equal(generated, 2);
  for (let worldX = 0; worldX < 100; worldX++) {
    cache.configure(worldX, worldX, {x:1,z:1}, 40);
    for (let i = 0; i < 20; i++) cache.warmOne();
    assert.ok(cache.tiles.size <= 16);
  }
});
