import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { activeWorldSize, groundExtents, CAMERA_OFFSET, originShift, resizeLanePopulation, releaseOutsideLanes } from '../src/city/activeWorld.js';
import { scenarioSettings, scenarioTraffic, trafficSnapshot } from '../src/city/benchmarkScenario.js';
import { visiblePosition } from '../src/city/vehiclePresentation.js';

test('projected ground bounds cover real camera corner rays at all supported framings', () => {
  for (const [width, height] of [[393, 651], [393, 852], [852, 393], [1365, 570], [2560, 1080]]) {
    for (const zoom of [70, 150]) for (const blockSize of [24, 40, 48]) {
      const aspect = width / height, viewWidth = (aspect < 1 ? 76 * aspect : Math.min(144, 82 * aspect)) * 100 / zoom;
      const viewHeight = viewWidth / aspect;
      const settings = { ...scenarioSettings(), zoom, blockSize, taxiSpeed: 180, trafficSpeed: 180 };
      const area = activeWorldSize(viewWidth, viewHeight, settings), extents = groundExtents(viewWidth, viewHeight);
      const camera = new THREE.OrthographicCamera(-viewWidth / 2, viewWidth / 2, viewHeight / 2, -viewHeight / 2, 1, 400);
      camera.position.set(CAMERA_OFFSET.x, CAMERA_OFFSET.y, CAMERA_OFFSET.z); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
      const ray = new THREE.Raycaster(), point = new THREE.Vector3(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const canalTop = new THREE.Vector3(0, 0, -area.z * blockSize).project(camera);
      const canalBottom = new THREE.Vector3(0, 0, area.z * blockSize).project(camera);
      assert.ok(Math.abs(canalTop.x - canalBottom.x) < 1e-8, 'canal runs vertically on screen');
      assert.ok(canalTop.y > 1 && canalBottom.y < -1, 'canal extends past both screen edges');
      for (const x of [-1, 1]) for (const y of [-1, 1]) {
        ray.setFromCamera(new THREE.Vector2(x, y), camera); ray.ray.intersectPlane(plane, point);
        assert.ok(visiblePosition(point, 0, 0, { x: 0, z: 0 }, camera), 'cars on screen edges stay visible');
        assert.ok(Math.abs(point.x) <= extents.x + 1e-8 && Math.abs(point.z) <= extents.z + 1e-8);
        for (const axis of ['x', 'z']) assert.ok(area[axis] * blockSize >= extents[axis] + area.buffer + blockSize / 2);
      }
    }
  }
});

test('origin rebasing preserves absolute coordinates and keeps at most half a block drift', () => {
  for (const block of [24, 40, 48]) for (const position of [-102.1, -40.1, -20, 0, 19.99, 20, 200.3]) {
    const shift = originShift(position, block), local = position - shift * block;
    assert.ok(local >= -block / 2 && local < block / 2);
    assert.equal(local + shift * block, position);
  }
});

test('phone workload shrinks with unchanged per-street density and sufficient margin', () => {
  const settings = scenarioSettings();
  const area = activeWorldSize(76 * (393 / 852) / 0.7, 76 / 0.7, settings);
  assert.deepEqual([area.x, area.z], [3, 4]);
  assert.equal(trafficSnapshot(scenarioTraffic(settings, area)).cars, 1228);
  assert.ok(area.buffer >= settings.blockSize);
});

test('resizing retains visible car identities and fills only outside the visible stretch', () => {
  const visible = { position: 0, track: 0, speed: 4 }, far = { position: 200, track: 1 };
  const lane = { cars: [visible, far], radius: 5 };
  const generated = { radius: 3, cars: [{ position: 1, track: 0 }, { position: 80, track: 1 }] };
  resizeLanePopulation(lane, generated, 0, 140, 50);
  assert.ok(lane.cars.includes(visible)); assert.equal(visible.position, 0); assert.equal(visible.speed, 4);
  assert.ok(!lane.cars.includes(far)); assert.equal(lane.cars.length, 2); assert.equal(lane.cars[1].position, 80);
  const growing = { cars: [visible], radius: 2 };
  resizeLanePopulation(growing, { radius: 3, cars: [{ position: 145, track: 1 }, { position: 0, track: 0 }] }, 0, 140, 50);
  assert.equal(growing.cars.length, 2);
  assert.equal(growing.cars[1].position, -135, 'wrap a candidate into the new offscreen buffer');
});

test('unloaded streets release races, overtakes and destinations without stopping live cars', () => {
  const gone = { track: 0 }, live = { track: -1, position: 10, speed: 12, overtake: { leader: gone, returnTrack: 0 } };
  const race = { leader: gone, follower: live }; gone.race = live.race = race;
  const retained = { cars: [live] }, removed = { cars: [gone] };
  releaseOutsideLanes(new Map([['0:0:1', retained], ['0:9:1', removed]]), new Map([['0:0:1', retained]]));
  assert.equal(live.overtake, null); assert.equal(live.race, null); assert.equal(live.track, 0);
  assert.equal(live.speed, 12); assert.equal(live.position, 10);
});
