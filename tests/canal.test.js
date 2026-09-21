import { streetHalf } from '../src/city/roadProfile.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { canalColumn, canalDimensions, CANAL_BRIDGE_HALF, CANAL_WATER_LEVEL, populateCanal } from '../src/city/canal.js';
import * as THREE from 'three';
import { createCanalGround } from '../src/city/canalGround.js';
import { parkAt, roadOpen } from '../src/city/roadLayout.js';
import { PAVED_ROAD, TRACKS, trackOffset, vehiclePose, MAX_MERGE_ANGLE } from '../src/city/world.js';
import { carCoordinates } from '../src/city/trafficNetwork.js';
import { populateBlock } from '../src/city/createCity.js';
import { canalBridge, bridgeHeight, liftBridgePose, BRIDGE_START, BRIDGE_SEGMENTS } from '../src/city/bridgeProfile.js';

test('canal columns have uninterrupted bank roads and bridges, never overlapping a merged park', () => {
  for (let x = -36; x <= 36; x++) {
    assert.equal(canalColumn(x), canalColumn(x + 12));
    if (!canalColumn(x)) continue;
    for (let z = -30; z <= 30; z++) {
      assert.equal(parkAt(x, z), null);
      assert.equal(roadOpen(0, z, x), canalBridge(z));
      assert.ok(roadOpen(1, x, z));
      assert.ok(roadOpen(1, x + 1, z));
    }
  }
});

test('water meets tile boundaries, decks cover it at crossings, and banks fit every block size', () => {
  for (let block = 24; block <= 48; block += 2) {
    const parts = []; populateCanal({ add: (...p) => parts.push(p) }, 0, 0, block);
    const water = parts.find(p => p[2] === CANAL_WATER_LEVEL - 0.01);
    const decks = parts.filter(p => p[0] === 'box' && p[5] === 0.6 && p[6] === (streetHalf(0,0)+1.75) * 2);
    const { left, right } = canalDimensions(block);
    assert.equal(water[3] - water[6] / 2, 0);
    assert.equal(water[3] + water[6] / 2, block);
    assert.equal(decks.length, BRIDGE_SEGMENTS);
    assert.ok(BRIDGE_START < left && block - BRIDGE_START > right);
    const material = new THREE.MeshBasicMaterial(), box = new THREE.BoxGeometry();
    const meshes = decks.map(p => {
      const mesh = new THREE.Mesh(box, material);
      mesh.position.set(p[1], p[2], p[3]); mesh.scale.set(p[4], p[5], p[6]); mesh.rotation.z = p[10];
      mesh.updateMatrixWorld(); return mesh;
    });
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    for (let x = BRIDGE_START + 0.03; x < block - BRIDGE_START; x += 0.31) {
      ray.ray.origin.set(x, 10, 1);
      const hit = ray.intersectObjects(meshes)[0];
      assert.ok(hit, 'no gaps in the deck');
      assert.ok(Math.abs(hit.point.y - bridgeHeight(x, block)) < 1e-7);
    }
    box.dispose(); material.dispose();
    for (const p of parts) assert.ok(p[4] > 0 && p[5] > 0 && p[6] > 0);
    const blocks = []; populateBlock({ add: (...p) => blocks.push(p) }, 0, 0, 0, 0, block);
    assert.ok(!blocks.some(p => p[0] === 'building'));
  }
});

test('water continues across many blocks with a bridge at alternate cross streets', () => {
  for (const block of [24, 40, 48]) {
    let previousEnd;
    for (let segment = -8; segment <= 8; segment++) {
      const parts = [];
      populateBlock({ add: (...p) => parts.push(p) }, 0, segment, 0, segment * block, block);
      const water = parts.find(p => p[2] === CANAL_WATER_LEVEL - 0.01);
      const decks = parts.filter(p => p[0] === 'box' && p[5] === 0.6 && p[6] === (streetHalf(0,segment)+1.75) * 2);
      const start = water[3] - water[6] / 2;
      if (previousEnd !== undefined) assert.equal(start, previousEnd, 'water has no gap between blocks');
      previousEnd = water[3] + water[6] / 2;
      assert.equal(decks.length, canalBridge(segment) ? BRIDGE_SEGMENTS : 0);
      assert.equal(roadOpen(0, segment, 0), canalBridge(segment));
      for (const deck of decks) assert.equal(deck[3], segment * block);
    }
  }
});

test('asphalt has continuous canal openings after rebasing and block-size changes', () => {
  const material = new THREE.MeshBasicMaterial();
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  for (const block of [24, 40, 48]) for (const origin of [-25, -1, 0, 1, 12, 25]) {
    const geometry = createCanalGround(block, origin), mesh = new THREE.Mesh(geometry, material);
    const { left, right } = canalDimensions(block);
    for (let x = -450; x <= 450; x += 1.7) {
      const absolute = x + origin * block, column = Math.floor(absolute / block), local = absolute - column * block;
      // BufferGeometry stores float32 vertices; do not classify exact shore edges.
      if (Math.min(Math.abs(local - left), Math.abs(local - right)) < 1e-4) continue;
      const inWater = canalColumn(column) && local > left && local < right;
      ray.ray.origin.set(x, 10, 13);
      assert.equal(ray.intersectObject(mesh).length > 0, !inWater, JSON.stringify({ block, origin, x }));
    }
    assert.ok(geometry.attributes.position.count < 100, 'ground stays a single small mesh');
    geometry.dispose();
  }
  material.dispose();
});

test('bridge parapets, bank walls and trunks leave normal and borrowed tracks clear', () => {
  for (const block of [24, 40, 48]) {
    const parts = []; populateCanal({ add: (...p) => parts.push(p) }, 0, 0, block);
    const obstacles = parts.filter(p => p[0] === 'box' && p[2] > 0.3 && (p[4] < 0.5 || p[6] < 0.5));
    for (const axis of [0, 1]) for (const direction of [-1, 1]) for (const track of (axis===0?[-1,0,1,2,3]:[-1,0,1,2])) {
      for (let along = 8; along <= block - 8; along += 0.5) {
        const car = { axis, line: 0, direction, position: along, offset: trackOffset(track) };
        const coordinates = carCoordinates(car, block);
        for (const steer of [-MAX_MERGE_ANGLE, 0, MAX_MERGE_ANGLE]) {
          const pose = vehiclePose(coordinates.x, coordinates.z, axis, direction, steer);
          for (const side of [-0.46, 0.46]) for (const end of [-1.125, 1.125]) {
            const x = pose.x + side * pose.cos + end * pose.sin, z = pose.z - side * pose.sin + end * pose.cos;
            for (const p of obstacles) assert.ok(!(Math.abs(x - p[1]) <= p[4] / 2 && Math.abs(z - p[3]) <= p[6] / 2));
          }
        }
      }
    }
    assert.ok(TRACKS[1] < PAVED_ROAD / 2);
  }
});

test('cars climb and descend with all wheels on the bridge, including reversed traffic', () => {
  for (const block of [24, 40, 48]) for (const direction of [-1, 1]) for (const column of [-12, 0, 12]) {
    let lastLift = 0;
    for (let local = 4; local <= block - 4; local += 0.1) {
      const pose = { x: column * block + local, z: 0.82, angle: direction * Math.PI / 2, lift: 0, pitch: 0, roll: 0, wheels: [0, 0, 0, 0] };
      const lift = liftBridgePose(pose, block);
      assert.ok(Math.abs(lift - lastLift) < 0.08, 'height changes smoothly'); lastLift = lift;
      assert.ok(Math.abs(pose.roll) < 1e-8);
      if (local > BRIDGE_START + 1 && local < block / 2 - 1) assert.ok(pose.pitch * direction < 0);
      if (local > block / 2 + 1 && local < block - BRIDGE_START - 1) assert.ok(pose.pitch * direction > 0);
      for (const height of pose.wheels) assert.ok(height >= 0 && height <= 2.4 + 1e-8);
    }
    const flat = { x: column * block + block / 2, z: block, angle: 0, lift: 0, pitch: 0, roll: 0, wheels: [0, 0, 0, 0] };
    assert.equal(liftBridgePose(flat, block), 0, 'no phantom bridge at the removed crossing');
  }
});
