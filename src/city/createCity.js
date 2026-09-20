import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BLOCK, TRACKS, ROAD, PAVED_ROAD, STOP_LINE, TRAFFIC_SPACING, vehiclePose, headlightsOn, resetSignal, seededRandom } from './world.js';
import { normalizeSettings } from './settings.js';
import { carCoordinates, turnPose, updateNetwork } from './trafficNetwork.js';
import { bodyPartPose } from './vehicleBody.js';
import { WHEEL_SIDES, WHEEL_AXLES } from './vehicleSurface.js';
import { hornAnimation } from './hornAnimation.js';
import { HornEffects } from './hornEffects.js';

const palette = {
  sidewalk: '#dedede', curb: '#bdbdbd', paving: '#cdcdcd',
  buildings: ['#eeeeee', '#d3d3d3', '#e2e2e2', '#c6c6c6', '#f3f3f3'],
  grass: ['#b8b8b8', '#c4c4c4', '#aeaeae'],
  leaves: ['#8d8d8d', '#a1a1a1', '#ababab', '#797979', '#969696'],
  cars: ['#ffffff', '#f4f4f4', '#e4e4e4', '#cdcdcd', '#a6a6a6', '#838383'],
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
    this.lightMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    this.beamMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.48, depthWrite: false, toneMapped: false });
  }
  reset() { this.items.clear(); }
  add(kind, x, y, z, sx, sy, sz, color, rotation = 0, pitch = 0, roll = 0) {
    if (!this.items.has(kind)) this.items.set(kind, []);
    this.items.get(kind).push([x, y, z, sx, sy, sz, color, rotation, pitch, roll]);
  }
  flush() {
    for (const [kind, mesh] of this.meshes) if (!this.items.has(kind)) mesh.count = 0;
    for (const [kind, items] of this.items) {
      let mesh = this.meshes.get(kind);
      if (!mesh || mesh.instanceMatrix.count < items.length) {
        if (mesh) { this.scene.remove(mesh); mesh.dispose(); }
        const material = kind === 'taxi' ? this.taxiMaterial : kind === 'light' ? this.lightMaterial : kind === 'beam' ? this.beamMaterial : this.material;
        mesh = new THREE.InstancedMesh(this.geometries[kind], material, Math.ceil(items.length * 1.3));
        mesh.castShadow = !['paint', 'paving', 'light', 'beam'].includes(kind);
        mesh.receiveShadow = !['light', 'beam'].includes(kind);
        if (this.dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.meshes.set(kind, mesh);
        this.scene.add(mesh);
      }
      mesh.count = items.length;
      items.forEach(([x, y, z, sx, sy, sz, color, rotation, pitch, roll], index) => {
        this.matrix.position.set(x, y, z);
        this.matrix.scale.set(sx, sy, sz);
        this.matrix.rotation.set(pitch, rotation, roll, 'YXZ');
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
    this.lightMaterial.dispose();
    this.beamMaterial.dispose();
  }
}

export function populateBlock(batch, gx, gz, x, z, blockSize = BLOCK) {
  const random = seededRandom(gx, gz);
  const pick = (list) => list[Math.floor(random() * list.length)];
  let layoutScale = 1;
  const put = (kind, dx, y, dz, w, h, d, color, rotation = 0) => {
    // Small block settings must not push raised lawns or building plinths into
    // the driveable shoulder. Tree trunks are placed inside this boundary too.
    if (y >= 0.4 && ['round', 'paving', 'building'].includes(kind)) {
      const inset = PAVED_ROAD / 2 + 0.9;
      w = Math.min(w, 2 * Math.min(dx * layoutScale - inset, blockSize - dx * layoutScale - inset) / layoutScale);
      d = Math.min(d, 2 * Math.min(dz * layoutScale - inset, blockSize - dz * layoutScale - inset) / layoutScale);
    }
    batch.add(kind, x + dx * layoutScale, y, z + dz * layoutScale, w * layoutScale, h, d * layoutScale, color, rotation);
  };
  const tree = (tx, tz, size = 1) => {
    put('box', tx, 0.85, tz, 0.32, 1.45, 0.32, '#777777');
    put('crown', tx, 1.55 + size * 0.65, tz, 1.25 * size, 1.55 * size, 1.2 * size, pick(palette.leaves), random() * 6);
  };

  put('round', blockSize / 2, 0.10, blockSize / 2, blockSize - PAVED_ROAD, 0.3, blockSize - PAVED_ROAD, palette.curb);
  put('round', blockSize / 2, 0.25, blockSize / 2, blockSize - PAVED_ROAD - 0.42, 0.34, blockSize - PAVED_ROAD - 0.42, palette.sidewalk);
  // A narrow asphalt shoulder lets taxis ride the pavement with one side.
  for (const side of [-1, 1]) {
    put('paint', blockSize / 2, 0.015, side * ROAD / 2, blockSize - STOP_LINE * 2, 0.018, 0.06, '#8d8d8d');
    put('paint', side * ROAD / 2, 0.015, blockSize / 2, 0.06, 0.018, blockSize - STOP_LINE * 2, '#8d8d8d');
  }

  // Road markings stop before the intersection. Every tile owns two crossings.
  for (let p = 6.5; p < blockSize - 5; p += 3.3) {
    put('paint', p, 0.016, 0, 1.3, 0.018, 0.14, '#e9e9e9');
    put('paint', 0, 0.016, p, 0.14, 0.018, 1.3, '#e9e9e9');
  }
  for (let p = -PAVED_ROAD / 2 + 0.65; p <= PAVED_ROAD / 2 - 0.65; p += 0.66) {
    put('paint', PAVED_ROAD / 2 + 1, 0.02, p, 1.28, 0.025, 0.34, '#f0f0f0');
    put('paint', p, 0.02, PAVED_ROAD / 2 + 1, 0.34, 0.025, 1.28, '#f0f0f0');
  }

  // The simple 24-unit lot layout expands with the block; roads stay separate.
  layoutScale = blockSize / 24;
  const park = random() < 0.13;
  if (park) {
    const parkSize = Math.min(15.7, 24 - (PAVED_ROAD + 0.8) / layoutScale);
    put('round', 12, 0.45, 12, parkSize, 0.18, parkSize, pick(palette.grass));
    put('paving', 12, 0.56, 12, 1.3, 0.025, parkSize - 0.2, '#dddddd');
    put('paving', 12, 0.56, 12, parkSize - 0.2, 0.025, 1.3, '#dddddd');
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
  const treeInset = Math.max(4.2, (PAVED_ROAD / 2 + 1.4) / layoutScale);
  for (const [tx, tz] of [[treeInset,12], [24 - treeInset,12], [12,treeInset]]) {
    if (random() < 0.62) {
      put('round', tx, 0.46, tz, 1.9, 0.14, 2.5, pick(palette.grass));
      tree(tx, tz, 0.65 + random() * 0.3);
    }
  }
}

export function addCar(batch, car, originX, originZ, focus, camera, blockSize, hornEffects) {
  const coordinates = carCoordinates(car, blockSize);
  const x = coordinates.x - originX, z = coordinates.z - originZ;
  // Simulate the offscreen traffic, but only upload visible cars to the GPU.
  const dx = x - focus.x, dz = z - focus.z;
  if (Math.abs(dx * 0.882 - dz * 0.471) > camera.right + 5 ||
      Math.abs(dx * 0.42 + dz * 0.786) > camera.top + 7) return;
  const pose = car.turn ? { ...turnPose(car.turn), x, z } : vehiclePose(x, z, car.axis, car.direction, car.steer);
  const pitch = (car.taxi ? car.pitch ?? 0 : 0) + (car.roadPitch ?? 0);
  const roll = (car.taxi ? car.roll ?? 0 : 0) + (car.roadRoll ?? 0);
  const hop = hornAnimation(car.hornAge).bounce;
  const lift = (car.rideHeight ?? 0) + hop;
  if (car.taxi && typeof car.hornAge === 'number') hornEffects?.add(car, x, z, camera);
  const part = (kind, dx, y, dz, w, h, d, color, sprung = true) => {
    const local = sprung && (pitch || roll) ? bodyPartPose(dx, y, dz, pitch, roll) : { x: dx, y, z: dz };
    batch.add(kind, pose.x + local.x * pose.cos + local.z * pose.sin, local.y + (sprung ? lift : 0),
      pose.z - local.x * pose.sin + local.z * pose.cos, w, h, d, color, pose.angle, sprung ? pitch : 0, sprung ? roll : 0);
  };
  const color = car.taxi ? '#ffca00' : car.color;
  part(car.taxi ? 'taxi' : 'car', 0, 0.42, 0, 0.92, 0.48, 2.25, color);
  part('car', 0, 0.78, -0.12, 0.8, 0.4, 1.15, '#333333');
  part(car.taxi ? 'taxi' : 'car', 0, 0.99, -0.18, 0.81, 0.12, 0.72, color);
  const airborne = Math.max(0, lift - (car.surfaceSupport ?? 0));
  for (const [a, axle] of WHEEL_AXLES.entries()) for (const [s, side] of WHEEL_SIDES.entries()) {
    part('box', side, 0.22 + (car.wheelHeights?.[a * 2 + s] ?? 0) + airborne, axle, 0.18, 0.32, 0.34, '#303030', false);
  }
  if (car.taxi) {
    part('box', 0, 1.13, -0.18, 0.42, 0.19, 0.24, '#292929');
    if (headlightsOn(car)) {
      for (const side of [-1, 1]) {
        part('light', side * 0.29, 0.5, 1.14, 0.24, 0.2, 0.06, '#fffce2');
        part('beam', side * 0.31, 0.035, 2.5, 0.62, 1, 2.6, '#fffce2', false);
      }
    }
  }
}

export function createCity(container, initialSettings) {
  let settings = normalizeSettings(initialSettings);
  let BLOCK = settings.blockSize;
  let rebuildTimer;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dedede');
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
    light: new THREE.BoxGeometry(1, 1, 1),
    beam: new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([
      -0.14, 0, -0.5, 0.14, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5,
    ], 3)).setIndex([0, 2, 1, 2, 3, 1]),
    crown: new THREE.DodecahedronGeometry(1, 0),
  };
  const staticBatch = new Batches(scene, geometries);
  const carsBatch = new Batches(scene, geometries, true);
  const hornEffects = new HornEffects(scene);
  const groundMaterial = new THREE.MeshStandardMaterial({ color: '#555555', roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new THREE.HemisphereLight('#ffffff', '#b8b8b8', 1.8));
  const sunlight = new THREE.DirectionalLight('#ffffff', 2.5);
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
  const focus = new THREE.Vector3(BLOCK / 2, 0, BLOCK / 2);
  let originX = 0, originZ = 0, worldX = 0, worldZ = 0, radius = 6;
  let lastCellX = NaN, lastCellZ = NaN;
  let lanes = new Map();
  let time = 0, previous = 0, disposed = false;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function rebuild() {
    staticBatch.reset();
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) populateBlock(staticBatch, worldX + x, worldZ + z, x * BLOCK, z * BLOCK, BLOCK);
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
            const spacing = settings.density > 0 ? TRAFFIC_SPACING * 100 / settings.density : Infinity;
            const count = Math.floor((radius * 2 + 1) * BLOCK / spacing);
            for (let track = 0; track < 2; track++) {
              for (let i = 0; i < count; i++) {
                const taxi = random() < settings.taxiShare / 100;
                const cruise = taxi ? 13 + random() * 2 : 3.4 + random() * 4.2;
                const acceleration = taxi ? 24 + random() * 5 : 2.2 + random() * 4;
                lane.cars.push({ axis, line, direction,
                  position: centerPosition - radius * BLOCK + i * spacing + track * spacing / 2 + random() * 1.5,
                  taxi, color: palette.cars[Math.floor(random() * palette.cars.length)],
                  track, fromTrack: track, offset: TRACKS[track], cruise, speed: cruise, acceleration,
                  baseCruise: cruise, baseAcceleration: acceleration,
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
    // Keep the framing fixed so larger blocks also appear larger on screen.
    const viewWidth = (aspect < 1 ? 76 * aspect : Math.min(144, 82 * aspect)) * 100 / settings.zoom;
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
    const moving = !document.hidden && !reducedMotion.matches && !settings.paused;
    if (moving) {
      time += delta * Math.min(1, settings.trafficSpeed / 100, settings.taxiSpeed / 100);
      // Positive camera displacement projects down and right on the ground.
      focus.x += delta * 0.92 * settings.cameraSpeed / 100;
      focus.z += delta * 0.36 * settings.cameraSpeed / 100;
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
    hornEffects.reset();
    for (const lane of lanes.values()) {
      const center = lane.axis === 0 ? originX + focus.x : originZ + focus.z;
      const half = (radius + 0.5) * BLOCK;
      for (const car of lane.cars) {
        const multiplier = (car.taxi ? settings.taxiSpeed : settings.trafficSpeed) / 100;
        car.cruise = car.baseCruise * multiplier;
        car.acceleration = car.baseAcceleration * multiplier;
        if (car.position < center - half) { car.position += half * 2; resetSignal(car); }
        if (car.position > center + half) { car.position -= half * 2; resetSignal(car); }
      }
    }
    if (moving) updateNetwork(lanes, delta, time, { blockSize: BLOCK, weaving: settings.weaving / 100,
      clockMultiplier: Math.min(1, settings.trafficSpeed / 100, settings.taxiSpeed / 100) });
    for (const lane of lanes.values()) {
      for (const car of lane.cars) {
        addCar(carsBatch, car, originX, originZ, focus, camera, BLOCK, hornEffects);
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
  function updateSettings(value) {
    const next = normalizeSettings(value);
    const regenerate = next.blockSize !== settings.blockSize || next.density !== settings.density || next.taxiShare !== settings.taxiShare;
    const zoomChanged = next.zoom !== settings.zoom;
    settings = next;
    if (zoomChanged) resize();
    if (regenerate) {
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => {
        const scale = settings.blockSize / BLOCK;
        focus.multiplyScalar(scale);
        BLOCK = settings.blockSize;
        originX = worldX * BLOCK; originZ = worldZ * BLOCK;
        lanes.clear();
        lastCellX = NaN;
        resize();
      }, 180);
    }
  }

  function dispose() {
    disposed = true;
    clearTimeout(rebuildTimer);
    observer.disconnect();
    document.removeEventListener('visibilitychange', visibility);
    renderer.setAnimationLoop(null);
    staticBatch.dispose(); carsBatch.dispose(); hornEffects.dispose();
    Object.values(geometries).forEach(geometry => geometry.dispose());
    ground.geometry.dispose(); groundMaterial.dispose();
    sunlight.shadow.map?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  return { updateSettings, dispose };
}
