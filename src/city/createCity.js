import * as THREE from 'three';
import { Batches } from './Batches.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BLOCK, TRACKS, ROAD, PAVED_ROAD, STOP_LINE, TRAFFIC_SPACING, headlightsOn, resetSignal, seededRandom } from './world.js';
import { normalizeSettings } from './settings.js';
import { COLOR_SCHEMES, createBackgroundFade } from './colorSchemes.js';
import { carCoordinates, updateNetwork } from './trafficNetwork.js';
import { bodyPartPose } from './vehicleBody.js';
import { WHEEL_SIDES, WHEEL_AXLES } from './vehicleSurface.js';
import { SimulationClock } from './simulationClock.js';
import { presentation, interpolatePresentation, visiblePosition } from './vehiclePresentation.js';
import { HornEffects } from './hornEffects.js';
import { populateLane } from './trafficPopulation.js';
import { trafficSnapshot } from './benchmarkScenario.js';
import { CAMERA_OFFSET, activeWorldSize, originShift, resizeLanePopulation, releaseOutsideLanes } from './activeWorld.js';
import { TrafficWorkerClient } from './TrafficWorkerClient.js';
import { CAR_STRIDE, readPose, readAppearance, frameSnapshot } from './trafficFrames.js';
import { parkAt, roadOpen, boulevardRoad, relocateToRoad, spawnRoadOpen, CAMERA_DRIFT, roundaboutAt } from './roadLayout.js';
import { populateMedian } from './boulevards.js';
import { populatePark } from './parkGeometry.js';
import { districtKind, populateDistrict } from './districts.js';
import { SceneryCache } from './sceneryCache.js';
import { canalColumn, populateCanal } from './canal.js';
import { createCanalGround } from './canalGround.js';
import { bridgeHeight, liftBridgePose } from './bridgeProfile.js';
import { populateRoadworks } from './roadworkGeometry.js';
import { populateRoundabout, roundaboutSceneryBatch } from './roundabouts.js';
import { ROUNDABOUT_STOP } from './roundaboutDimensions.js';
import { roundaboutCornerGeometry } from './roundaboutGeometry.js';

const palette = {
  sidewalk: '#dedede', curb: '#bdbdbd', paving: '#cdcdcd',
  buildings: ['#eeeeee', '#d3d3d3', '#e2e2e2', '#c6c6c6', '#f3f3f3'],
  grass: ['#b8b8b8', '#c4c4c4', '#aeaeae'],
  leaves: ['#8d8d8d', '#a1a1a1', '#ababab', '#797979', '#969696'],
  cars: ['#ffffff', '#f4f4f4', '#e4e4e4', '#cdcdcd', '#a6a6a6', '#838383'],
};

export function populateBlock(batch, gx, gz, x, z, blockSize = BLOCK) {
  const parkLot = parkAt(gx, gz);
  const canal = canalColumn(gx);
  const northRoad = roadOpen(0, gz, gx), westRoad = roadOpen(1, gx, gz);
  const northBoulevard = northRoad && boulevardRoad(0, gz), westBoulevard = westRoad && boulevardRoad(1, gx);
  const random = seededRandom(gx, gz);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const lotBatch = roundaboutSceneryBatch(batch, gx, gz, x, z, blockSize);
  const ring = roundaboutAt(gx, gz), eastRing = roundaboutAt(gx + 1, gz), southRing = roundaboutAt(gx, gz + 1);
  let layoutScale = 1;
  const put = (kind, dx, y, dz, w, h, d, color, rotation = 0) => {
    // Small block settings must not push raised lawns or building plinths into
    // the driveable shoulder. Tree trunks are placed inside this boundary too.
    if (y >= 0.4 && ['round', 'paving', 'building'].includes(kind)) {
      const inset = PAVED_ROAD / 2 + 0.9;
      w = Math.min(w, 2 * Math.min(dx * layoutScale - inset, blockSize - dx * layoutScale - inset) / layoutScale);
      d = Math.min(d, 2 * Math.min(dz * layoutScale - inset, blockSize - dz * layoutScale - inset) / layoutScale);
    }
    const lift = canal && northRoad && kind === 'paint' && Math.abs(dz) < PAVED_ROAD / 2 + 0.1 ? bridgeHeight(dx, blockSize) : 0;
    const tilt = lift ? Math.atan2(bridgeHeight(dx + w / 2, blockSize) - bridgeHeight(dx - w / 2, blockSize), w) : 0;
    (kind === 'paint' ? batch : lotBatch).add(kind, x + dx * layoutScale, y + lift, z + dz * layoutScale, w * layoutScale, h, d * layoutScale, color, rotation, 0, tilt);
  };
  const tree = (tx, tz, size = 1) => {
    put('box', tx, 0.85, tz, 0.32, 1.45, 0.32, '#777777');
    put('crown', tx, 1.55 + size * 0.65, tz, 1.25 * size, 1.55 * size, 1.2 * size, pick(palette.leaves), random() * 6);
  };

  if (!parkLot && !canal) {
    put('round', blockSize / 2, 0.10, blockSize / 2, blockSize - PAVED_ROAD, 0.3, blockSize - PAVED_ROAD, palette.curb);
    put('round', blockSize / 2, 0.25, blockSize / 2, blockSize - PAVED_ROAD - 0.42, 0.34, blockSize - PAVED_ROAD - 0.42, palette.sidewalk);
  }
  // A narrow asphalt shoulder lets taxis ride the pavement with one side.
  for (const side of [-1, 1]) {
    const start = ring ? ROUNDABOUT_STOP : STOP_LINE;
    const endX = blockSize - (eastRing ? ROUNDABOUT_STOP : STOP_LINE), endZ = blockSize - (southRing ? ROUNDABOUT_STOP : STOP_LINE);
    if (northRoad) put('paint', (start + endX) / 2, 0.015, side * ROAD / 2, endX - start, 0.018, 0.06, '#8d8d8d');
    if (westRoad) put('paint', side * ROAD / 2, 0.015, (start + endZ) / 2, 0.06, 0.018, endZ - start, '#8d8d8d');
  }

  // Road markings stop before the intersection. Every tile owns two crossings.
  for (let p = 6.5; p < blockSize - 5; p += 3.3) {
    if (ring && p < ROUNDABOUT_STOP + 1) continue;
    if (northRoad && !northBoulevard && (!eastRing || p < blockSize - ROUNDABOUT_STOP - 1)) put('paint', p, 0.016, 0, 1.3, 0.018, 0.14, '#e9e9e9');
    if (westRoad && !westBoulevard && (!southRing || p < blockSize - ROUNDABOUT_STOP - 1)) put('paint', 0, 0.016, p, 0.14, 0.018, 1.3, '#e9e9e9');
  }
  for (let p = -PAVED_ROAD / 2 + 0.65; p <= PAVED_ROAD / 2 - 0.65; p += 0.66) {
    if (northRoad) put('paint', ring ? ROUNDABOUT_STOP : PAVED_ROAD / 2 + 1, 0.02, p, 1.28, 0.025, 0.34, '#f0f0f0');
    if (westRoad) put('paint', p, 0.02, ring ? ROUNDABOUT_STOP : PAVED_ROAD / 2 + 1, 0.34, 0.025, 1.28, '#f0f0f0');
  }

  populateRoadworks(batch, gx, gz, x, z, blockSize);
  populateRoundabout(batch, gx, gz, x, z);
  if (northBoulevard && !canal) populateMedian(lotBatch, 0, x, z, blockSize);
  if (westBoulevard) populateMedian(lotBatch, 1, x, z, blockSize);
  if (canal) {
    populateCanal(batch, x, z, blockSize, gz, northBoulevard);
    return;
  }
  if (parkLot) {
    if (parkLot.x === gx && parkLot.z === gz) populatePark(lotBatch, x, z, blockSize, parkLot);
    return;
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
    populateDistrict(districtKind(gx, gz), { put, tree, random, palette });
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

export function addCar(batch, car, originX, originZ, focus, camera, blockSize, hornEffects, previousPose = null, alpha = 1) {
  const coordinates = carCoordinates(car, blockSize);
  // Simulate the offscreen traffic, but only upload visible cars to the GPU.
  if (!visiblePosition(coordinates, originX, originZ, focus, camera)) return;
  const pose = interpolatePresentation(presentation(car, coordinates), previousPose, alpha);
  return drawCarPose(batch, car, pose, originX, originZ, camera, hornEffects, blockSize);
}

function drawCarPose(batch, car, pose, originX, originZ, camera, hornEffects, blockSize) {
  const bridgeLift = liftBridgePose(pose, blockSize);
  pose.x -= originX; pose.z -= originZ;
  pose.sin = Math.sin(pose.angle); pose.cos = Math.cos(pose.angle);
  const { pitch, roll, lift } = pose;
  if (car.taxi && typeof car.hornAge === 'number') hornEffects?.add(car, pose.x, pose.z, camera, bridgeLift);
  const part = (kind, dx, y, dz, w, h, d, color, sprung = true) => {
    const local = sprung && (pitch || roll) ? bodyPartPose(dx, y, dz, pitch, roll) : { x: dx, y, z: dz };
    batch.add(kind, pose.x + local.x * pose.cos + local.z * pose.sin, local.y + (sprung ? lift : 0),
      pose.z - local.x * pose.sin + local.z * pose.cos, w, h, d, color, pose.angle, sprung ? pitch : 0, sprung ? roll : 0);
  };
  const color = car.taxi ? '#ffca00' : car.color;
  part(car.taxi ? 'taxi' : 'car', 0, 0.42, 0, 0.92, 0.48, 2.25, color);
  part(car.taxi ? 'taxiDetail' : 'car', 0, 0.78, -0.12, 0.8, 0.4, 1.15, '#333333');
  part(car.taxi ? 'taxi' : 'car', 0, 0.99, -0.18, 0.81, 0.12, 0.72, color);
  for (const [a, axle] of WHEEL_AXLES.entries()) for (const [s, side] of WHEEL_SIDES.entries()) {
    part(car.taxi ? 'taxiDetail' : 'box', side, 0.22 + pose.wheels[a * 2 + s], axle, 0.18, 0.32, 0.34, '#303030', false);
  }
  if (car.taxi) {
    part('taxiDetail', 0, 1.13, -0.18, 0.42, 0.19, 0.24, '#292929');
    if (car.headlights ?? headlightsOn(car)) {
      for (const side of [-1, 1]) {
        part('light', side * 0.29, 0.5, 1.14, 0.24, 0.2, 0.06, '#fffce2');
        part('beam', side * 0.31, 0.035 + bridgeLift, 2.5, 0.62, 1, 2.6, '#fffce2', false);
      }
    }
  }
  return true;
}

export function addTrafficFrame(batch, frame, originX, originZ, focus, camera, hornEffects, blockSize = BLOCK) {
  if (!frame) return 0;
  const { lower, upper, alpha } = frame, pose = {}, previousPose = {}, car = {};
  let visible = 0;
  for (let offset = 0; offset < upper.data.length; offset += CAR_STRIDE) {
    pose.x = upper.data[offset + 1]; pose.z = upper.data[offset + 2];
    if (!visiblePosition(pose, originX, originZ, focus, camera, 2)) continue;
    readPose(upper.data, offset, pose);
    const before = lower.index.get(upper.data[offset]);
    if (before !== undefined) interpolatePresentation(pose, readPose(lower.data, before, previousPose), alpha);
    if (!visiblePosition(pose, originX, originZ, focus, camera)) continue;
    const source = before !== undefined && alpha < 1 ? lower : upper;
    readAppearance(source.data, source === lower ? before ?? offset : offset, car);
    if (car.hornAge !== undefined && upper.data[offset + 14] >= 0 && car.signalIndex === upper.data[offset + 15]) {
      car.hornAge += (upper.data[offset + 14] - car.hornAge) * alpha;
    }
    if (before !== undefined) car.rideHeight = lower.data[before + 16] + (upper.data[offset + 16] - lower.data[before + 16]) * alpha;
    drawCarPose(batch, car, pose, originX, originZ, camera, hornEffects, blockSize); visible++;
  }
  return visible;
}

export function createCity(container, initialSettings, benchmark = null) {
  let settings = normalizeSettings(initialSettings);
  let BLOCK = settings.blockSize;
  let rebuildTimer;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLOR_SCHEMES[settings.colorScheme].background);
  const backgroundFade = createBackgroundFade(settings.colorScheme);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(benchmark?.pixelRatio ?? Math.min(window.devicePixelRatio, 1.6));
  renderer.shadowMap.enabled = benchmark?.shadows ?? true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);
  benchmark?.onRenderer?.(renderer);

  const geometries = {
    roundaboutCurb: roundaboutCornerGeometry(),
    roundaboutWalk: roundaboutCornerGeometry(0.21),
    roundaboutCapCurb: roundaboutCornerGeometry(0,true),
    roundaboutCapWalk: roundaboutCornerGeometry(0.21,true),
    island: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
    cone: new THREE.ConeGeometry(0.5, 1, 4),
    box: new THREE.BoxGeometry(1, 1, 1),
    paint: new THREE.BoxGeometry(1, 1, 1),
    paving: new THREE.BoxGeometry(1, 1, 1),
    round: benchmark?.simpleCurbs ? new THREE.BoxGeometry(1, 1, 1) : new RoundedBoxGeometry(1, 1, 1, 1, 0.075),
    building: new THREE.BoxGeometry(1, 1, 1),
    car: new THREE.BoxGeometry(1, 1, 1),
    taxi: new THREE.BoxGeometry(1, 1, 1),
    taxiDetail: new THREE.BoxGeometry(1, 1, 1),
    light: new THREE.BoxGeometry(1, 1, 1),
    beam: new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([
      -0.14, 0, -0.5, 0.14, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5,
    ], 3)).setIndex([0, 2, 1, 2, 3, 1]),
    crown: new THREE.DodecahedronGeometry(1, 0),
  };
  const staticBatch = new Batches(scene, geometries);
  const scenery = new SceneryCache(populateBlock);
  const carsBatch = new Batches(scene, geometries, true);
  const hornEffects = new HornEffects(scene);
  const groundMaterial = new THREE.MeshStandardMaterial({ color: '#555555', roughness: 1 });
  for (const material of [staticBatch.material, carsBatch.material, groundMaterial]) backgroundFade.apply(material);
  const ground = new THREE.Mesh(createCanalGround(BLOCK), groundMaterial);
  let groundBlock = BLOCK, groundColumn = 0;
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
  const cameraOffset = new THREE.Vector3(CAMERA_OFFSET.x, CAMERA_OFFSET.y, CAMERA_OFFSET.z);
  const focus = new THREE.Vector3(BLOCK / 2, 0, BLOCK / 2);
  let originX = 0, originZ = 0, worldX = 0, worldZ = 0;
  let area = { x: 6, z: 6, extents: { x: 80, z: 80 } };
  let lastCellX = NaN, lastCellZ = NaN;
  let lanes = new Map();
  let time = 0, previous = 0, disposed = false;
  const simulationClock = new SimulationClock(1 / (benchmark?.simulationHz === 60 ? 60 : 30));
  const fixedSimulation = benchmark?.fixedStep !== false;
  let previousPoses = new WeakMap(), renderAlpha = 1;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let worker = null, workerFrame = null, workerFailure = null;
  const workerConfig = () => ({ settings: { ...settings, blockSize: BLOCK }, area,
    focus: { x: originX + focus.x, z: originZ + focus.z }, lightTime: time,
    seed: benchmark?.seed ?? 0, simulationHz: benchmark?.simulationHz === 60 ? 60 : 30,
    simulate: benchmark?.simulate !== false });
  const workerFailed = message => {
    workerFailure = message; worker = null; workerFrame = null;
    lanes.clear(); lastCellX = NaN; previous = 0;
    simulationClock.reset(); previousPoses = new WeakMap(); renderAlpha = 1;
  };

  function rebuild() {
    const layoutSettings = { ...settings, blockSize: BLOCK };
    if (groundBlock !== BLOCK || groundColumn !== worldX) {
      ground.geometry.dispose();
      ground.geometry = createCanalGround(BLOCK, worldX);
      groundBlock = BLOCK; groundColumn = worldX;
    }
    staticBatch.reset();
    scenery.configure(worldX, worldZ, area, BLOCK);
    for (let x = -area.x; x <= area.x; x++) {
      for (let z = -area.z; z <= area.z; z++) scenery.draw(staticBatch, worldX + x, worldZ + z, worldX, worldZ);
    }
    staticBatch.flush();
    if (worker) return;
    const next = new Map();
    for (let axis = 0; axis < 2; axis++) {
      const centerLine = axis === 0 ? worldZ : worldX;
      const centerPosition = (axis === 0 ? worldX : worldZ) * BLOCK;
      const along = axis === 0 ? area.x : area.z, across = axis === 0 ? area.z : area.x;
      for (let line = centerLine - across; line <= centerLine + across; line++) {
        for (const direction of [-1, 1]) {
          const key = `${axis}:${line}:${direction}`;
          let lane = lanes.get(key);
          if (!lane) lane = populateLane(axis, line, direction, layoutSettings, along, centerPosition, benchmark?.seed ?? 0, true);
          else if (lane.radius !== along) {
            const generated = populateLane(axis, line, direction, layoutSettings, along, centerPosition, benchmark?.seed ?? 0, true);
            resizeLanePopulation(lane, generated, centerPosition + (axis === 0 ? focus.x : focus.z),
              (along + 0.5) * BLOCK, axis === 0 ? area.extents.x : area.extents.z,
              car => spawnRoadOpen(car, BLOCK, STOP_LINE));
          }
          next.set(key, lane);
        }
      }
    }
    releaseOutsideLanes(lanes, next);
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
    const nextArea = activeWorldSize(viewWidth, viewHeight, { ...settings, blockSize: BLOCK });
    if (benchmark?.radius !== undefined) nextArea.x = nextArea.z = benchmark.radius;
    if (area.x !== nextArea.x || area.z !== nextArea.z) lastCellX = NaN;
    area = nextArea;
    worker?.configure(workerConfig());
  }

  function frame(timestamp) {
    if (disposed) return;
    const start = performance.now();
    const rafMs = previous ? timestamp - previous : 0;
    let rebuildMs = 0;
    const delta = previous ? Math.min((timestamp - previous) / 1000, 0.06) : 0;
    previous = timestamp;
    const moving = !document.hidden && (benchmark || !reducedMotion.matches) && !settings.paused;
    const bufferStart = benchmark ? performance.now() : 0;
    if (worker) {
      workerFrame = worker.advance(rafMs / 1000, moving);
      if (workerFrame) {
        focus.x = workerFrame.focusX - originX; focus.z = workerFrame.focusZ - originZ;
        time = workerFrame.lightTime;
      }
    } else if (moving) {
      // Positive camera displacement projects down and right on the ground.
      focus.x += delta * CAMERA_DRIFT.x * settings.cameraSpeed / 100;
      focus.z += delta * CAMERA_DRIFT.z * settings.cameraSpeed / 100;
    }
    const bufferCpuMs = benchmark && worker ? performance.now() - bufferStart : 0;
    const shiftX = originShift(focus.x, BLOCK), shiftZ = originShift(focus.z, BLOCK);
    if (shiftX || shiftZ) {
      worldX += shiftX; worldZ += shiftZ;
      focus.x -= shiftX * BLOCK; focus.z -= shiftZ * BLOCK;
      originX = worldX * BLOCK; originZ = worldZ * BLOCK;
    }
    if (lastCellX !== worldX || lastCellZ !== worldZ) {
      const rebuildStart = benchmark ? performance.now() : 0;
      rebuild(); lastCellX = worldX; lastCellZ = worldZ;
      renderer.shadowMap.needsUpdate = true;
      if (benchmark) rebuildMs = performance.now() - rebuildStart;
    }
    camera.position.copy(focus).add(cameraOffset);
    camera.lookAt(focus);

    carsBatch.reset();
    hornEffects.reset();
    for (const lane of lanes.values()) {
      const center = lane.axis === 0 ? originX + focus.x : originZ + focus.z;
      const half = ((lane.axis === 0 ? area.x : area.z) + 0.5) * BLOCK;
      for (const car of lane.cars) {
        const multiplier = (car.taxi ? settings.taxiSpeed : settings.trafficSpeed) / 100;
        car.cruise = car.baseCruise * multiplier;
        car.acceleration = car.baseAcceleration * multiplier;
        if (car.position < center - half) { car.position += half * 2; resetSignal(car); relocateToRoad(car, BLOCK, STOP_LINE); previousPoses.delete(car); }
        if (car.position > center + half) { car.position -= half * 2; resetSignal(car); relocateToRoad(car, BLOCK, STOP_LINE); previousPoses.delete(car); }
      }
    }
    const simulationStart = benchmark ? performance.now() : 0;
    let simulationSteps = 0;
    if (!worker && moving && benchmark?.simulate !== false) {
      const clockMultiplier = Math.min(1, settings.trafficSpeed / 100, settings.taxiSpeed / 100);
      const simulate = step => {
        if (fixedSimulation) for (const lane of lanes.values()) for (const car of lane.cars) {
          const coordinates = carCoordinates(car, BLOCK);
          if (visiblePosition(coordinates, originX, originZ, focus, camera, 2)) {
            previousPoses.set(car, presentation(car, coordinates, previousPoses.get(car)));
          } else previousPoses.delete(car);
        }
        time += step * clockMultiplier;
        updateNetwork(lanes, step, time, { blockSize: BLOCK, weaving: settings.weaving / 100, clockMultiplier, roadLayout: true });
      };
      if (fixedSimulation) {
        const result = simulationClock.advance(delta, simulate);
        simulationSteps = result.steps; renderAlpha = result.alpha;
      } else { simulate(delta); simulationSteps = delta > 0 ? 1 : 0; }
    }
    const prepareStart = benchmark ? performance.now() : 0;
    let visibleCars = worker ? addTrafficFrame(carsBatch, workerFrame, originX, originZ, focus, camera, hornEffects, BLOCK) : 0;
    for (const lane of lanes.values()) {
      for (const car of lane.cars) {
        if (addCar(carsBatch, car, originX, originZ, focus, camera, BLOCK, hornEffects,
          fixedSimulation ? previousPoses.get(car) : null, renderAlpha)) visibleCars++;
      }
    }
    carsBatch.flush();
    // At most one incoming tile in a light frame. A slow frame never has to
    // finish the entire next strip; missing tiles still have a synchronous path.
    if (moving && performance.now() - start < 4) scenery.warmOne();
    const renderStart = benchmark ? performance.now() : 0;
    benchmark?.beforeRender?.();
    renderer.render(scene, camera);
    if (benchmark) {
      const end = performance.now();
      benchmark.afterRender?.();
      const workerMetrics = worker?.takeMetrics();
      benchmark.onFrame?.({ rafMs, cpuMs: end - start, rebuildMs,
        simulationMs: prepareStart - simulationStart + bufferCpuMs, simulationSteps: workerMetrics?.workerSteps ?? simulationSteps,
        workerSimulationMs: 0, workerPackMs: 0, workerReceiveMs: 0, bufferMs: 0, bufferUnderruns: 0, playbackRate: 1,
        workerStatus: workerFailure ? 'fallback' : 'disabled', workerFailure, ...workerMetrics,
        prepareMs: renderStart - prepareStart,
        renderSubmitMs: end - renderStart, visibleCars,
        totalCars: worker ? workerFrame?.upper.cars ?? 0 : [...lanes.values()].reduce((sum, lane) => sum + lane.cars.length, 0),
        blocks: (area.x * 2 + 1) * (area.z * 2 + 1), radiusX: area.x, radiusZ: area.z,
        triangles: renderer.info.render.triangles, calls: renderer.info.render.calls,
        geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures });
    }
  }

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  camera.position.copy(focus).add(cameraOffset); camera.lookAt(focus);
  hornEffects.prepare(renderer, camera);
  if (fixedSimulation && benchmark?.worker !== false && typeof Worker !== 'undefined') {
    try { worker = new TrafficWorkerClient(workerConfig(), workerFailed); }
    catch (error) { workerFailed(error.message); }
  }
  renderer.setAnimationLoop(frame);
  const visibility = () => {
    previous = 0; simulationClock.reset(); previousPoses = new WeakMap(); renderAlpha = 1;
    renderer.setAnimationLoop(document.hidden ? null : frame);
  };
  document.addEventListener('visibilitychange', visibility);
  function updateSettings(value) {
    const next = normalizeSettings(value);
    const regenerate = next.blockSize !== settings.blockSize || next.density !== settings.density || next.taxiShare !== settings.taxiShare;
    const zoomChanged = next.zoom !== settings.zoom || next.trafficSpeed !== settings.trafficSpeed || next.taxiSpeed !== settings.taxiSpeed;
    settings = next;
    backgroundFade.setScheme(settings.colorScheme);
    scene.background.set(COLOR_SCHEMES[settings.colorScheme].background);
    if (zoomChanged) resize();
    worker?.configure(workerConfig());
    if (regenerate) {
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => {
        const scale = settings.blockSize / BLOCK;
        focus.multiplyScalar(scale);
        BLOCK = settings.blockSize;
        originX = worldX * BLOCK; originZ = worldZ * BLOCK;
        lanes.clear();
        previousPoses = new WeakMap(); simulationClock.reset(); renderAlpha = 1;
        lastCellX = NaN;
        resize();
        workerFrame = null;
        worker?.restart(workerConfig());
      }, 180);
    }
  }

  function dispose() {
    disposed = true;
    clearTimeout(rebuildTimer);
    worker?.dispose();
    observer.disconnect();
    document.removeEventListener('visibilitychange', visibility);
    renderer.setAnimationLoop(null);
    scenery.dispose(); staticBatch.dispose(); carsBatch.dispose(); hornEffects.dispose();
    Object.values(geometries).forEach(geometry => geometry.dispose());
    ground.geometry.dispose(); groundMaterial.dispose();
    sunlight.shadow.map?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  return { updateSettings, dispose, snapshot: () => worker ? frameSnapshot(workerFrame?.lower) : trafficSnapshot(lanes) };
}
