import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BLOCK, TRACKS, ROAD, seededRandom, greenLight, updateTraffic } from './world.js';

const palette = {
  sidewalk: '#f1eee4', curb: '#dedcd3', paving: '#e4e1d7',
  buildings: ['#f7f4eb', '#e9e7de', '#fffbf0', '#e9e4d9', '#f2eee5'],
  grass: ['#9fc65e', '#aed071', '#b5d47b'],
  leaves: ['#6aaa32', '#7cb83b', '#8ac247', '#589433', '#72a937'],
  cars: ['#ffffff', '#f4f4f2', '#e4e4e2', '#cbcdcc', '#a4a7a6', '#7f8382'],
};

// All repeated objects share geometry and use instancing, including moving cars.
class Batches {
  constructor(scene, geometries, dynamic = false) {
    this.scene = scene;
    this.geometries = geometries;
    this.dynamic = dynamic;
    this.items = new Map();
    this.meshes = new Map();
    this.matrix = new THREE.Object3D();
    this.color = new THREE.Color();
    this.material = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
    this.taxiMaterial = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true, toneMapped: false, emissive: '#ffbc00', emissiveIntensity: 0.12 });
  }
  reset() { this.items.clear(); }
  add(kind, x, y, z, sx, sy, sz, color, rotation = 0) {
    if (!this.items.has(kind)) this.items.set(kind, []);
    this.items.get(kind).push([x, y, z, sx, sy, sz, color, rotation]);
  }
  flush() {
    for (const [kind, mesh] of this.meshes) if (!this.items.has(kind)) mesh.count = 0;
    for (const [kind, items] of this.items) {
      let mesh = this.meshes.get(kind);
      if (!mesh || mesh.instanceMatrix.count < items.length) {
        if (mesh) { this.scene.remove(mesh); mesh.dispose(); }
        mesh = new THREE.InstancedMesh(this.geometries[kind], kind === 'taxi' ? this.taxiMaterial : this.material, Math.ceil(items.length * 1.3));
        mesh.castShadow = !['paint', 'paving'].includes(kind);
        mesh.receiveShadow = true;
        if (this.dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.meshes.set(kind, mesh);
        this.scene.add(mesh);
      }
      mesh.count = items.length;
      items.forEach(([x, y, z, sx, sy, sz, color, rotation], index) => {
        this.matrix.position.set(x, y, z);
        this.matrix.scale.set(sx, sy, sz);
        this.matrix.rotation.set(0, rotation, 0);
        this.matrix.updateMatrix();
        mesh.setMatrixAt(index, this.matrix.matrix);
        mesh.setColorAt(index, this.color.set(color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }
  dispose() {
    for (const mesh of this.meshes.values()) { this.scene.remove(mesh); mesh.dispose(); }
    this.material.dispose();
    this.taxiMaterial.dispose();
  }
}

function populateBlock(batch, gx, gz, x, z) {
  const random = seededRandom(gx, gz);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const put = (kind, dx, y, dz, w, h, d, color, rotation = 0) => batch.add(kind, x + dx, y, z + dz, w, h, d, color, rotation);
  const tree = (tx, tz, size = 1) => {
    put('box', tx, 0.85, tz, 0.32, 1.45, 0.32, '#947251');
    put('crown', tx, 1.55 + size * 0.65, tz, 1.25 * size, 1.55 * size, 1.2 * size, pick(palette.leaves), random() * 6);
  };

  put('round', 12, 0.10, 12, BLOCK - ROAD + 0.42, 0.3, BLOCK - ROAD + 0.42, palette.curb);
  put('round', 12, 0.25, 12, BLOCK - ROAD, 0.34, BLOCK - ROAD, palette.sidewalk);

  // Road markings stop before the intersection. Every tile owns two crossings.
  for (let p = 6; p < 21; p += 3.3) {
    put('paint', p, 0.016, 0, 1.3, 0.018, 0.14, '#f1efe7');
    put('paint', 0, 0.016, p, 0.14, 0.018, 1.3, '#f1efe7');
  }
  for (let p = -2.1; p <= 2.1; p += 0.66) {
    put('paint', 4.0, 0.02, p, 1.28, 0.025, 0.34, '#f9f7ef');
    put('paint', p, 0.02, 4.0, 0.34, 0.025, 1.28, '#f9f7ef');
  }

  const park = random() < 0.13;
  if (park) {
    put('round', 12, 0.45, 12, 15.7, 0.18, 15.7, pick(palette.grass));
    put('paving', 12, 0.56, 12, 1.3, 0.025, 15.5, '#f1e8d5');
    put('paving', 12, 0.56, 12, 15.5, 0.025, 1.3, '#f1e8d5');
    for (const [tx, tz] of [[7,7], [16,7], [7,16], [16,16], [5.8,11], [18,13]]) tree(tx, tz, 1 + random() * 0.55);
  } else {
    for (const [lx, lz] of [[7.8,7.8], [16,7.8], [7.8,16], [16,16]]) {
      if (random() < 0.27) {
        put('round', lx, 0.46, lz, 6.4, 0.16, 6.4, pick(palette.grass));
        tree(lx - 1.2, lz + 0.7, 1.15 + random() * 0.4);
        tree(lx + 1.5, lz - 1.6, 0.65 + random() * 0.4);
        continue;
      }
      const width = 4.3 + random() * 1.8;
      const depth = 4.0 + random() * 2.1;
      const height = 1.6 + random() * 3.7 + (random() < 0.09 ? 2.2 : 0);
      put('round', lx, 0.48, lz, width + 0.65, 0.2, depth + 0.65, palette.paving);
      put('building', lx, 0.55 + height / 2, lz, width, height, depth, pick(palette.buildings));
    }
  }
  // Small curbside trees give even the denser blocks a soft green border.
  for (const [tx, tz] of [[4.2,12], [19.9,12], [12,4.2]]) {
    if (random() < 0.62) {
      put('round', tx, 0.46, tz, 1.9, 0.14, 2.5, pick(palette.grass));
      tree(tx, tz, 0.65 + random() * 0.3);
    }
  }
}

function addCar(batch, car, originX, originZ, focus, camera) {
  const x = car.axis === 0 ? car.position - originX : car.line * BLOCK - originX - car.direction * car.offset;
  const z = car.axis === 0 ? car.line * BLOCK - originZ + car.direction * car.offset : car.position - originZ;
  // Simulate the offscreen traffic, but only upload visible cars to the GPU.
  const dx = x - focus.x, dz = z - focus.z;
  if (Math.abs(dx * 0.882 - dz * 0.471) > camera.right + 5 ||
      Math.abs(dx * 0.42 + dz * 0.786) > camera.top + 7) return;
  const angle = (car.axis === 0 ? car.direction * Math.PI / 2 : car.direction > 0 ? 0 : Math.PI) - car.steer;
  const sin = Math.sin(angle), cos = Math.cos(angle);
  const part = (kind, dx, y, dz, w, h, d, color) => batch.add(kind, x + dx * cos + dz * sin, y, z - dx * sin + dz * cos, w, h, d, color, angle);
  const color = car.taxi ? '#ffca00' : car.color;
  part(car.taxi ? 'taxi' : 'car', 0, 0.42, 0, 0.92, 0.48, 2.25, color);
  part('car', 0, 0.78, -0.12, 0.8, 0.4, 1.15, '#303536');
  part(car.taxi ? 'taxi' : 'car', 0, 0.99, -0.18, 0.81, 0.12, 0.72, color);
  for (const axle of [-0.69, 0.69]) part('box', 0, 0.22, axle, 1.04, 0.32, 0.34, '#303332');
  if (car.taxi) {
    part('box', 0, 1.13, -0.18, 0.42, 0.19, 0.24, '#292e2d');
  }
}

export function createCity(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f2efe6');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);

  const geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    paint: new THREE.BoxGeometry(1, 1, 1),
    paving: new THREE.BoxGeometry(1, 1, 1),
    round: new RoundedBoxGeometry(1, 1, 1, 2, 0.075),
    building: new THREE.BoxGeometry(1, 1, 1),
    car: new THREE.BoxGeometry(1, 1, 1),
    taxi: new THREE.BoxGeometry(1, 1, 1),
    crown: new THREE.DodecahedronGeometry(1, 0),
  };
  const staticBatch = new Batches(scene, geometries);
  const carsBatch = new Batches(scene, geometries, true);
  const groundMaterial = new THREE.MeshStandardMaterial({ color: '#505654', roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new THREE.HemisphereLight('#fff9ef', '#b8c2aa', 1.8));
  const sunlight = new THREE.DirectionalLight('#fff3df', 2.5);
  sunlight.position.set(-35, 70, -25);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunlight.shadow.camera, { left: -115, right: 115, top: 115, bottom: -115, near: 1, far: 220 });
  sunlight.shadow.normalBias = 0.07;
  sunlight.shadow.bias = -0.00015;
  sunlight.shadow.radius = 3;
  scene.add(sunlight, sunlight.target);

  const camera = new THREE.OrthographicCamera(-80, 80, 45, -45, 1, 400);
  const cameraOffset = new THREE.Vector3(24, 100, 45);
  const focus = new THREE.Vector3(12, 0, 12);
  let originX = 0, originZ = 0, worldX = 0, worldZ = 0, radius = 6;
  let lastCellX = NaN, lastCellZ = NaN;
  let lanes = new Map();
  let time = 0, previous = 0, disposed = false;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function rebuild() {
    staticBatch.reset();
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) populateBlock(staticBatch, worldX + x, worldZ + z, x * BLOCK, z * BLOCK);
    }
    staticBatch.flush();
    const next = new Map();
    for (let axis = 0; axis < 2; axis++) {
      const centerLine = axis === 0 ? worldZ : worldX;
      const centerPosition = (axis === 0 ? worldX : worldZ) * BLOCK;
      for (let line = centerLine - radius; line <= centerLine + radius; line++) {
        for (const direction of [-1, 1]) {
          const key = `${axis}:${line}:${direction}`;
          let lane = lanes.get(key);
          if (!lane) {
            const random = seededRandom(line * 7 + axis, direction * 991);
            lane = { axis, line, direction, cars: [] };
            const count = Math.floor((radius * 2 + 1) * BLOCK / 9.5);
            for (let track = 0; track < 2; track++) {
              for (let i = 0; i < count; i++) {
                const taxi = random() < 0.18;
                const cruise = taxi ? 8.2 + random() * 1.6 : 2.9 + random() * 0.9;
                lane.cars.push({ axis, line, direction,
                  position: centerPosition - radius * BLOCK + i * 9.5 + track * 4.75 + random() * 0.6,
                  taxi, color: palette.cars[Math.floor(random() * palette.cars.length)],
                  track, fromTrack: track, offset: TRACKS[track], cruise, speed: cruise,
                  changing: false, merge: 1, cooldown: random(), steer: 0,
                });
              }
            }
          }
          next.set(key, lane);
        }
      }
    }
    lanes = next;
  }

  function resize() {
    const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
    const aspect = width / height;
    // Desktop frames show ~6 by 3.5 blocks; portrait keeps cars readable.
    const viewWidth = aspect < 1 ? 76 * aspect : Math.min(144, 82 * aspect);
    const viewHeight = viewWidth / aspect;
    camera.left = -viewWidth / 2; camera.right = viewWidth / 2;
    camera.top = viewHeight / 2; camera.bottom = -viewHeight / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    const nextRadius = Math.max(5, Math.ceil(Math.hypot(viewWidth, viewHeight) / BLOCK / 2) + 2);
    if (radius !== nextRadius) { radius = nextRadius; lastCellX = NaN; }
  }

  function frame(timestamp) {
    if (disposed) return;
    const delta = previous ? Math.min((timestamp - previous) / 1000, 0.06) : 0;
    previous = timestamp;
    if (!document.hidden && !reducedMotion.matches) {
      time += delta;
      // Positive camera displacement projects down and right on the ground.
      focus.x += delta * 0.92;
      focus.z += delta * 0.36;
    }
    const shiftX = Math.floor(focus.x / BLOCK), shiftZ = Math.floor(focus.z / BLOCK);
    if (shiftX || shiftZ) {
      worldX += shiftX; worldZ += shiftZ;
      focus.x -= shiftX * BLOCK; focus.z -= shiftZ * BLOCK;
      originX = worldX * BLOCK; originZ = worldZ * BLOCK;
    }
    if (lastCellX !== worldX || lastCellZ !== worldZ) {
      rebuild(); lastCellX = worldX; lastCellZ = worldZ;
      renderer.shadowMap.needsUpdate = true;
    }
    camera.position.copy(focus).add(cameraOffset);
    camera.lookAt(focus);

    carsBatch.reset();
    for (const lane of lanes.values()) {
      const center = lane.axis === 0 ? originX + focus.x : originZ + focus.z;
      const half = (radius + 0.5) * BLOCK;
      for (const car of lane.cars) {
        if (car.position < center - half) car.position += half * 2;
        if (car.position > center + half) car.position -= half * 2;
      }
      if (!document.hidden && !reducedMotion.matches) updateTraffic(lane.cars, lane.direction, delta, greenLight(time, lane.axis));
      for (const car of lane.cars) {
        addCar(carsBatch, car, originX, originZ, focus, camera);
      }
    }
    carsBatch.flush();
    renderer.render(scene, camera);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  renderer.setAnimationLoop(frame);
  const visibility = () => { previous = 0; renderer.setAnimationLoop(document.hidden ? null : frame); };
  document.addEventListener('visibilitychange', visibility);
  return () => {
    disposed = true;
    observer.disconnect();
    document.removeEventListener('visibilitychange', visibility);
    renderer.setAnimationLoop(null);
    staticBatch.dispose(); carsBatch.dispose();
    Object.values(geometries).forEach(geometry => geometry.dispose());
    ground.geometry.dispose(); groundMaterial.dispose();
    sunlight.shadow.map?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
