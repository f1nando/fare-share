import * as THREE from 'three';
import { sceneryStage } from './revealStages.js';

// All repeated objects share geometry and use instancing, including moving cars.
export class Batches {
  constructor(scene, geometries, dynamic = false, reveal = null) {
    this.scene = scene;
    this.geometries = geometries;
    this.dynamic = dynamic;
    this.reveal = reveal;
    this.items = new Map();
    this.meshes = new Map();
    this.matrix = new THREE.Object3D();
    this.colors = new Map();
    this.material = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
    this.taxiDetailMaterial = this.material.clone();
    this.taxiMaterial = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true, toneMapped: false, emissive: '#ffbc00', emissiveIntensity: 0.12 });
    this.lightMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    this.beamMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.48, depthWrite: false, toneMapped: false });
  }
  reset() { for (const group of this.items.values()) group.count = 0; }
  add(kind, x, y, z, sx, sy, sz, color, rotation = 0, pitch = 0, roll = 0, stage) {
    let group = this.items.get(kind);
    if (!group) { group = { values: [], count: 0 }; this.items.set(kind, group); }
    const index = group.count++;
    const item = group.values[index] ?? (group.values[index] = new Array(10));
    item[0] = x; item[1] = y; item[2] = z; item[3] = sx; item[4] = sy;
    item[5] = sz; item[6] = color; item[7] = rotation; item[8] = pitch; item[9] = roll;
    item[10] = null;
    if (this.reveal && !this.reveal.done && !this.dynamic) item[11] = stage ?? sceneryStage(kind, y);
  }
  addPrepared(kind, record, matrix, offsetX, offsetZ) {
    this.add(kind, record[0] + offsetX, record[1], record[2] + offsetZ,
      record[3], record[4], record[5], record[6], record[7], record[8], record[9], record[10]);
    const group = this.items.get(kind);
    group.values[group.count - 1][10] = matrix;
  }
  flush() {
    for (const [kind, group] of this.items) {
      const count = group.count, items = group.values;
      let mesh = this.meshes.get(kind);
      if (!count) { if (mesh) mesh.count = 0; continue; }
      if (!mesh || mesh.instanceMatrix.count < count) {
        if (mesh) { this.reveal?.releaseMesh(mesh); this.scene.remove(mesh); mesh.dispose(); }
        const material = kind === 'taxi' ? this.taxiMaterial : kind === 'taxiDetail' ? this.taxiDetailMaterial : kind === 'light' ? this.lightMaterial : kind === 'beam' ? this.beamMaterial : this.material;
        mesh = new THREE.InstancedMesh(this.geometries[kind], material, Math.ceil(count * 1.3));
        this.reveal?.prepareMesh(mesh, this.dynamic);
        mesh.userData.colors = [];
        mesh.castShadow = !['paint', 'paving', 'light', 'beam'].includes(kind);
        mesh.receiveShadow = !['light', 'beam'].includes(kind);
        if (this.dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.meshes.set(kind, mesh);
        this.scene.add(mesh);
      }
      mesh.count = count;
      const geometry = this.geometries[kind];
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      const baseRadius = geometry.boundingSphere.radius + geometry.boundingSphere.center.length();
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let firstColor = count, lastColor = -1;
      const stages = mesh.geometry.getAttribute('sceneRevealStage');
      for (let index = 0; index < count; index++) {
        if (stages) stages.array[index] = items[index][11];
        const [x, y, z, sx, sy, sz, color, rotation, pitch, roll] = items[index];
        if (items[index][10]) {
          const offset = index * 16, values = mesh.instanceMatrix.array;
          values.set(items[index][10], offset);
          values[offset + 12] = x; values[offset + 14] = z;
        } else {
          this.matrix.position.set(x, y, z);
          this.matrix.scale.set(sx, sy, sz);
          this.matrix.rotation.set(pitch, rotation, roll, 'YXZ');
          this.matrix.updateMatrix();
          mesh.setMatrixAt(index, this.matrix.matrix);
        }
        if (mesh.userData.colors[index] !== color) {
          if (!this.colors.has(color)) this.colors.set(color, new THREE.Color(color));
          mesh.setColorAt(index, this.colors.get(color));
          mesh.userData.colors[index] = color;
          firstColor = Math.min(firstColor, index); lastColor = index;
        }
        // A sphere about each instance origin covers arbitrary rotations and
        // nonuniform scale, including lifted wheels and horn/headlight effects.
        const radius = baseRadius * Math.max(Math.abs(sx), Math.abs(sy), Math.abs(sz));
        minX = Math.min(minX, x - radius); maxX = Math.max(maxX, x + radius);
        minY = Math.min(minY, y - radius); maxY = Math.max(maxY, y + radius);
        minZ = Math.min(minZ, z - radius); maxZ = Math.max(maxZ, z + radius);
      }
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (stages) stages.needsUpdate = true;
      if (lastColor >= 0) {
        // Keep pending ranges until the renderer consumes them (a culled mesh
        // may skip uploads for several frames).
        mesh.instanceColor.addUpdateRange(firstColor * 3, (lastColor - firstColor + 1) * 3);
        mesh.instanceColor.needsUpdate = true;
      }
      if (!mesh.boundingSphere) mesh.boundingSphere = new THREE.Sphere();
      mesh.boundingSphere.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      mesh.boundingSphere.radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
    }
  }
  dispose() {
    for (const mesh of this.meshes.values()) { this.reveal?.releaseMesh(mesh); this.scene.remove(mesh); mesh.dispose(); }
    this.material.dispose();
    this.taxiDetailMaterial.dispose();
    this.taxiMaterial.dispose();
    this.lightMaterial.dispose();
    this.beamMaterial.dispose();
  }
}


