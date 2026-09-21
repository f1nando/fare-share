import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Batches } from '../src/city/Batches.js';

test('batches reuse records, upload changed colors, grow and hide stale instances', () => {
  const scene = new THREE.Scene(), geometry = new THREE.BoxGeometry();
  const batch = new Batches(scene, { car: geometry, taxi: geometry }, true);
  const add = (kind = 'car', color = '#ffffff', x = 1) => batch.add(kind, x, 0, 0, 1, 1, 1, color);
  add(); add('taxi', '#ffca00'); batch.flush();
  const mesh = batch.meshes.get('car'), record = batch.items.get('car').values[0];
  const version = mesh.instanceColor.version;
  batch.reset(); add('car', '#ffffff', 2); batch.flush();
  assert.equal(batch.items.get('car').values[0], record);
  assert.equal(mesh.instanceColor.version, version);
  assert.equal(batch.meshes.get('taxi').count, 0);
  batch.reset(); add('car', '#838383'); batch.flush();
  const color = new THREE.Color(); mesh.getColorAt(0, color);
  const expected = new THREE.Color('#838383');
  for (const channel of ['r', 'g', 'b']) assert.ok(Math.abs(color[channel] - expected[channel]) < 1e-6);
  assert.equal(mesh.instanceColor.version, version + 1);
  assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 0, count: 16 }]);
  batch.reset(); for (let i = 0; i < 10; i++) add('car', '#ffffff', i); batch.flush();
  assert.equal(batch.meshes.get('car').count, 10);
  assert.equal(scene.children.length, 2);
  batch.reset(); batch.flush();
  assert.equal(batch.meshes.get('car').count, 0);
  batch.dispose(); geometry.dispose(); assert.equal(scene.children.length, 0);
});

test('conservative bounds contain every transformed vertex, including offset geometry', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0.3, -0.2, 1);
  const batch = new Batches(new THREE.Scene(), { box: geometry }, true);
  for (let i = 0; i < 12; i++) batch.add('box', i * 2 - 12, i / 2, -i, 0.3 + i, 0.4, 2,
    '#ffffff', i * 0.7, i * 0.2, -i * 0.3);
  batch.flush();
  const mesh = batch.meshes.get('box'), matrix = new THREE.Matrix4(), vertex = new THREE.Vector3();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    for (let j = 0; j < geometry.attributes.position.count; j++) {
      vertex.fromBufferAttribute(geometry.attributes.position, j).applyMatrix4(matrix);
      assert.ok(mesh.boundingSphere.containsPoint(vertex));
    }
  }
  batch.dispose(); geometry.dispose();
});
