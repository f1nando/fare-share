import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const PARTS = ['BODY', 'WHEELS', 'GLASS', 'HEADLIGHTS', 'TAILLIGHTS', 'ROOF_ACCESSORY', 'FRONT_ACCESSORY', 'REAR_ACCESSORY', 'SIDE_ACCESSORY', 'DECALS'];

export function createTemplate(id) {
  const root = new THREE.Group();
  root.name = id;
  root.userData = { collectionVersion: 1, units: 'meters', up: '+Y', forward: '-X', ground: 0 };
  const materials = {
    Body: new THREE.MeshStandardMaterial({ color: '#ffc318', roughness: 0.32, metalness: 0.15 }),
    Glass: new THREE.MeshStandardMaterial({ color: '#19252b', roughness: 0.22, metalness: 0.25 }),
    Black: new THREE.MeshStandardMaterial({ color: '#171a1d', roughness: 0.85 }),
    Lights: new THREE.MeshStandardMaterial({ color: '#f4f9ff', roughness: 0.3, emissive: '#bccfe5', emissiveIntensity: 0.3 }),
    Taillights: new THREE.MeshStandardMaterial({ color: '#e42632', roughness: 0.28, emissive: '#a30913', emissiveIntensity: 0.25 }),
    Wheels: new THREE.MeshStandardMaterial({ color: '#c3c9ce', roughness: 0.38, metalness: 0.45 }),
  };
  Object.entries(materials).forEach(([name, material]) => { material.name = name; });
  const groups = Object.fromEntries(PARTS.map(name => {
    const group = new THREE.Group(); group.name = name; root.add(group); return [name, group];
  }));
  function mesh(part, material, geometry, position = [0, 0, 0], rotation = [0, 0, 0], name = material) {
    const object = new THREE.Mesh(geometry, materials[material]);
    object.position.fromArray(position); object.rotation.set(...rotation); object.name = name;
    groups[part].add(object); return object;
  }
  function box(part, material, size, position, rotation, name) {
    return mesh(part, material, new THREE.BoxGeometry(...size), position, rotation, name);
  }
  return { root, groups, materials, mesh, box };
}

// Merge only inside a replaceable trait boundary. Wheels keep individual pivots.
export function optimizeParts(root) {
  for (const group of root.children) {
    if (group.name === 'WHEELS') continue;
    const buckets = new Map();
    for (const child of [...group.children]) {
      if (!child.isMesh) continue;
      child.updateMatrix();
      const geometry = child.geometry.clone().applyMatrix4(child.matrix);
      const plain = geometry.index ? geometry.toNonIndexed() : geometry;
      if (plain !== geometry) geometry.dispose();
      plain.deleteAttribute('uv');
      const list = buckets.get(child.material) ?? []; list.push(plain); buckets.set(child.material, list);
      group.remove(child); child.geometry.dispose();
    }
    for (const [material, geometries] of buckets) {
      const merged = mergeGeometries(geometries);
      const compact = mergeVertices(merged, 1e-5);
      const mesh = new THREE.Mesh(compact, material); mesh.name = `${group.name}_${material.name}`;
      group.add(mesh); merged.dispose(); geometries.forEach(g => g.dispose());
    }
  }
  return root;
}

export function modelStats(root) {
  let triangles = 0, meshes = 0; const materials = new Set();
  root.traverse(o => { if (o.isMesh) { triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; meshes++; materials.add(o.material); } });
  return { triangles, meshes, materials: materials.size };
}

export function applyTraits(root, { color, taxi = true, decals = true, spoiler = false, wheels = 'silver' } = {}) {
  root.traverse(o => {
    if (o.isMesh && o.material.name === 'Body' && color) o.material.color.set(color);
    if (o.isMesh && o.material.name === 'Wheels') o.material.color.set(wheels === 'dark' ? '#434a52' : '#c3c9ce');
  });
  root.getObjectByName('ROOF_ACCESSORY').visible = taxi;
  root.getObjectByName('DECALS').visible = decals;
  root.getObjectByName('REAR_ACCESSORY').visible = spoiler;
}

export function disposeModel(root) {
  const geometries = new Set(), materials = new Set();
  root.traverse(o => { if (o.isMesh) { geometries.add(o.geometry); materials.add(o.material); } });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}

// Grid with explicit outward winding; no double-sided materials or interior shells.
export function gridGeometry(rows, reverse = true) {
  const positions = rows.flat(2), indices = [], width = rows[0].length;
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < width - 1; j++) {
    const a = i * width + j, b = a + width;
    indices.push(...(reverse ? [a, a + 1, b, a + 1, b + 1, b] : [a, b, a + 1, a + 1, b, b + 1]));
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices); g.computeVertexNormals(); return g;
}
