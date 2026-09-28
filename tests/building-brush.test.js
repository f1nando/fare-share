import test from 'node:test';
import assert from 'node:assert/strict';
import { OrthographicCamera, Vector3 } from 'three';
import { withinBuildingBrush } from '../src/city/buildingBrush.js';

const camera = new OrthographicCamera(-50, 50, 50, -50, 0.1, 300);
camera.position.set(40, 80, 60);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const rect = { left: 30, top: 60, width: 1000, height: 800 };
function screen(x, y, z) {
  const p = new Vector3(x, y, z).project(camera);
  return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
}

test('long buildings react continuously along either axis and after rotation', () => {
  for (const [width, depth] of [[60, 6], [6, 60]]) {
    for (const rotation of [0, Math.PI / 2, Math.PI / 4]) {
      const item = [5, 4, -3, width, 8, depth, '#ddd', rotation];
      for (let distance = -30; distance <= 30; distance += 3) {
        const x = width > depth ? distance : 0, z = depth > width ? distance : 0;
        const point = screen(5 + x * Math.cos(rotation) + z * Math.sin(rotation), 4,
          -3 - x * Math.sin(rotation) + z * Math.cos(rotation));
        assert.equal(withinBuildingBrush(item, camera, rect, point, 12), true);
      }
      assert.equal(withinBuildingBrush(item, camera, rect, { x: -1000, y: -1000 }, 12), false);
    }
  }
});

test('brush keeps a bounded radius at the ends and handles a collapsed axis', () => {
  const front = new OrthographicCamera(-50, 50, 50, -50, 0.1, 300);
  front.position.set(0, 0, 100); front.lookAt(0, 0, 0); front.updateMatrixWorld();
  const viewport = { left: 0, top: 0, width: 1000, height: 1000 };
  const item = [0, 0, 0, 60, 8, 6, '#ddd', 0];
  assert.equal(withinBuildingBrush(item, front, viewport, { x: 812, y: 500 }, 12), true);
  assert.equal(withinBuildingBrush(item, front, viewport, { x: 813, y: 500 }, 12), false);
  assert.equal(withinBuildingBrush(item, front, viewport, { x: 500, y: 513 }, 12), false);
  item[3] = 0; item[5] = 0;
  assert.equal(withinBuildingBrush(item, front, viewport, { x: 500, y: 500 }, 12), true);
});
