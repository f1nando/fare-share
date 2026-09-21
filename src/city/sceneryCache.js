import { Object3D } from 'three';

// Cache only the active rectangle and one incoming row/column. Coordinates in
// records are tile-local, so camera rebasing never invalidates prepared matrices.
export class SceneryCache {
  constructor(populate) {
    this.populate = populate; this.tiles = new Map(); this.matrix = new Object3D();
  }
  configure(worldX, worldZ, area, blockSize) {
    if (this.blockSize !== blockSize) this.tiles.clear();
    this.blockSize = blockSize;
    this.bounds = { left: worldX - area.x, right: worldX + area.x + 1,
      top: worldZ - area.z, bottom: worldZ + area.z + 1 };
    for (const [key, tile] of this.tiles) if (!this.contains(tile.x, tile.z)) this.tiles.delete(key);
    this.pending = [];
    for (let x = this.bounds.left; x <= this.bounds.right; x++)
      for (let z = this.bounds.top; z <= this.bounds.bottom; z++)
        if (x === this.bounds.right || z === this.bounds.bottom) this.pending.push([x, z]);
  }
  contains(x, z) {
    const b = this.bounds;
    return x >= b.left && x <= b.right && z >= b.top && z <= b.bottom;
  }
  get(x, z) {
    const key = `${x}:${z}`;
    if (this.tiles.has(key)) return this.tiles.get(key);
    const tile = { x, z, records: [] }, matrix = this.matrix;
    this.populate({ add(kind, px, y, pz, sx, sy, sz, color, rotation = 0, pitch = 0, roll = 0) {
      matrix.position.set(px, y, pz); matrix.scale.set(sx, sy, sz);
      matrix.rotation.set(pitch, rotation, roll, 'YXZ'); matrix.updateMatrix();
      tile.records.push({ kind, values: [px, y, pz, sx, sy, sz, color, rotation, pitch, roll], matrix: matrix.matrix.elements.slice() });
    } }, x, z, 0, 0, this.blockSize);
    this.tiles.set(key, tile);
    return tile;
  }
  draw(batch, x, z, worldX, worldZ) {
    const offsetX = (x - worldX) * this.blockSize, offsetZ = (z - worldZ) * this.blockSize;
    for (const record of this.get(x, z).records) batch.addPrepared(record.kind, record.values, record.matrix, offsetX, offsetZ);
  }
  warmOne() {
    while (this.pending?.length) {
      const [x, z] = this.pending.pop();
      if (!this.tiles.has(`${x}:${z}`)) { this.get(x, z); return; }
    }
  }
  dispose() { this.tiles.clear(); this.pending = []; }
}
