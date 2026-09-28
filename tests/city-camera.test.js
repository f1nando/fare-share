import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { positionCityCamera } from '../src/city/createCity.js';

test('interaction projection uses the current camera position, not the previous frame', () => {
  const camera = new THREE.OrthographicCamera(-80, 80, 45, -45, 1, 400);
  const offset = new THREE.Vector3(-58, 72, 74);
  const focus = new THREE.Vector3(20, 0, 20);
  positionCityCamera(camera, focus, offset);
  focus.set(35, 0, 27);
  positionCityCamera(camera, focus, offset);
  const projectedFocus = focus.clone().project(camera);
  assert.ok(Math.abs(projectedFocus.x) < 1e-12);
  assert.ok(Math.abs(projectedFocus.y) < 1e-12);
});
