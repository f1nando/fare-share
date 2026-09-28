import { Vector3 } from 'three';
import { withinGestureRadius } from './foliageAnimation.js';

const start = new Vector3(), end = new Vector3();

export function withinBuildingBrush(item, camera, rect, point, radius) {
  const [x, y, z, width, , depth, , rotation = 0] = item;
  const halfX = width >= depth ? width / 2 : 0;
  const halfZ = depth > width ? depth / 2 : 0;
  const dx = halfX * Math.cos(rotation) + halfZ * Math.sin(rotation);
  const dz = -halfX * Math.sin(rotation) + halfZ * Math.cos(rotation);
  start.set(x - dx, y, z - dz).project(camera);
  end.set(x + dx, y, z + dz).project(camera);
  const ax = rect.left + (start.x + 1) * rect.width / 2;
  const ay = rect.top + (1 - start.y) * rect.height / 2;
  const bx = rect.left + (end.x + 1) * rect.width / 2;
  const by = rect.top + (1 - end.y) * rect.height / 2;
  const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
  // A continuous row of activation points: no gaps even at a large zoom.
  const t = lengthSquared ? Math.max(0, Math.min(1,
    ((point.x - ax) * (bx - ax) + (point.y - ay) * (by - ay)) / lengthSquared)) : 0;
  return withinGestureRadius(ax + t * (bx - ax), ay + t * (by - ay), point, radius);
}
