import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AirTraffic, flightPose } from '../src/city/airTraffic.js';
import { CAMERA_OFFSET } from '../src/city/activeWorld.js';

test('occasional flights enter and leave outside the view on desktop and portrait screens', () => {
  for (const [right, top] of [[90, 50], [19, 43]]) {
    const camera = new THREE.OrthographicCamera(-right, right, top, -top, 1, 400);
    camera.position.set(CAMERA_OFFSET.x, CAMERA_OFFSET.y, CAMERA_OFFSET.z);
    camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    for (const [kind, start, duration, period] of [['helicopter', 6, 15, 58], ['airplane', 28, 9, 83]]) {
      assert.equal(flightPose(kind, start - 0.01, { x: 0, z: 0 }, camera), null);
      assert.equal(flightPose(kind, start + duration, { x: 0, z: 0 }, camera), null);
      assert.equal(flightPose(kind, start + period - 1, { x: 0, z: 0 }, camera), null);
      for (const cycle of [0, 1]) {
        const poses = [0, duration / 2, duration - 0.001].map(age => flightPose(kind, start + cycle * period + age, { x: 0, z: 0 }, camera));
        const projected = poses.map(p => new THREE.Vector3(p.x, p.y, p.z).project(camera));
        assert.ok(Math.abs(projected[0].x) > 1.2 && Math.abs(projected[2].x) > 1.2);
        assert.ok(projected[0].x * projected[2].x < 0);
        assert.ok(Math.abs(projected[1].x) < 1e-8 && Math.abs(projected[1].y) < 0.5);
      }
    }
  }
});

test('aircraft and rotor animation freeze with the clock and follow origin rebasing', () => {
  const scene = new THREE.Scene(), traffic = new AirTraffic(scene), camera = { right: 70, top: 40 };
  traffic.update(12, { x: 25, z: 10 }, camera);
  const before = traffic.helicopter.position.clone(), rotor = traffic.rotor.rotation.y;
  assert.equal(traffic.helicopter.visible, true);
  traffic.update(12, { x: -15, z: 50 }, camera);
  assert.ok(Math.abs(traffic.helicopter.position.x - before.x + 40) < 1e-8);
  assert.ok(Math.abs(traffic.helicopter.position.z - before.z - 40) < 1e-8);
  assert.equal(traffic.rotor.rotation.y, rotor);
  traffic.update(12.1, { x: -15, z: 50 }, camera);
  assert.notEqual(traffic.rotor.rotation.y, rotor);
  traffic.dispose();
  assert.equal(scene.children.length, 0);
});

test('airplane casts a shadow without writing visible pixels or hiding the city', () => {
  const scene = new THREE.Scene(), traffic = new AirTraffic(scene);
  traffic.update(32, { x: 0, z: 0 }, { right: 70, top: 40 });
  assert.equal(traffic.helicopter.visible, false);
  assert.equal(traffic.airplane.visible, true);
  assert.equal(traffic.airplane.castShadow, true);
  assert.equal(traffic.airplane.material.visible, true);
  assert.equal(traffic.airplane.material.colorWrite, false);
  assert.equal(traffic.airplane.material.depthWrite, false);
  let heliMeshes = 0;
  traffic.helicopter.traverse(part => { if (part.isMesh) { assert.equal(part.castShadow, true); heliMeshes++; } });
  assert.ok(heliMeshes > 5);
  let disposed = 0;
  for (const item of [...traffic.geometries, ...traffic.materials]) item.addEventListener('dispose', () => disposed++);
  traffic.dispose();
  assert.equal(disposed, traffic.geometries.length + traffic.materials.length);
});
