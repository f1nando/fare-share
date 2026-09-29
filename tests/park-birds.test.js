import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, RingGeometry } from 'three';
import { ParkBirds, birdWingGeometry, MAX_BIRD_PARKS, BIRDS_PER_PARK } from '../src/city/parkBirds.js';
import { Batches } from '../src/city/Batches.js';
import { parkAt } from '../src/city/roadLayout.js';

function frame(birds, x = 0, z = 0, time = 10) {
  const parts = [];
  birds.update({ add: (...p) => parts.push(p) }, 40, x, z, { x: 6, z: 6 }, time);
  return parts;
}

test('small flocks remain above actual parks with bounded geometry and cached park selection', () => {
  const birds = new ParkBirds(), parts = frame(birds);
  assert.equal(parts.length, MAX_BIRD_PARKS * BIRDS_PER_PARK * 2);
  const parks = birds.parks;
  for (const part of parts) {
    assert.ok(parkAt(Math.floor(part[1] / 40), Math.floor(part[3] / 40)));
    assert.ok(part[2] > 6 && part[2] < 9);
    assert.ok(part.slice(1, 7).every(Number.isFinite));
  }
  assert.deepEqual(frame(birds), parts, 'paused time produces a stable pose');
  assert.equal(birds.parks, parks, 'park search is not repeated each frame');
  assert.notDeepEqual(frame(birds, 0, 0, 10.1), parts);
  for (let x = -30; x <= 30; x++) {
    assert.ok(frame(birds, x).length <= MAX_BIRD_PARKS * BIRDS_PER_PARK * 2);
  }
});

test('retained flocks keep their world positions after an origin shift', () => {
  const birds = new ParkBirds(), before = frame(birds);
  const after = frame(birds, 1);
  const matched = before.filter(a => after.some(b => Math.abs(b[1] + 40 - a[1]) < 1e-8 &&
    Math.abs(b[3] - a[3]) < 1e-8 && b[2] === a[2]));
  assert.ok(matched.length >= BIRDS_PER_PARK * 2);
});

test('birds and greeting rings use two instanced draws without shadows and dispose cleanly', () => {
  const scene = new Scene();
  const geometries = { birdWing: birdWingGeometry(), boatRipple: new RingGeometry(0.91, 1, 24).rotateX(-Math.PI / 2) };
  const batch = new Batches(scene, geometries, true);
  new ParkBirds().update(batch, 40, 0, 0, { x: 6, z: 6 }, 10);
  batch.add('boatRipple', 0, -2.365, 0, 1, 1, 1, '#aaa');
  batch.flush();
  assert.equal(batch.meshes.size, 2);
  for (const mesh of batch.meshes.values()) {
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, false);
  }
  batch.dispose();
  Object.values(geometries).forEach(geometry => geometry.dispose());
  assert.equal(scene.children.length, 0);
});
