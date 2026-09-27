import { SceneReveal, REVEAL } from './sceneReveal.js';
import { streetHalf, laneDividers } from './roadProfile.js';
import { boulevardSceneryBatch } from './boulevardGeometry.js';
import * as THREE from 'three';
import { Batches } from './Batches.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BLOCK, TRACKS, ROAD, PAVED_ROAD, STOP_LINE, TRAFFIC_SPACING, headlightsOn, resetSignal, seededRandom } from './world.js';
import { normalizeSettings } from './settings.js';
import { COLOR_SCHEMES, createBackgroundFade } from './colorSchemes.js';
import { carCoordinates, updateNetwork } from './trafficNetwork.js';
import { drawTrafficVehicle } from './vehicleModels.js';
import { bodyPartPose } from './vehicleBody.js';
import { WHEEL_SIDES, WHEEL_AXLES } from './vehicleSurface.js';
import { SimulationClock } from './simulationClock.js';
import { presentation, interpolatePresentation, visiblePosition } from './vehiclePresentation.js';
import { HornEffects } from './hornEffects.js';
import { populateLane } from './trafficPopulation.js';
import { trafficSnapshot } from './benchmarkScenario.js';
import { CAMERA_OFFSET, activeWorldSize, originShift, resizeLanePopulation, releaseOutsideLanes, recycleVehicle } from './activeWorld.js';
import { TrafficWorkerClient } from './TrafficWorkerClient.js';
import { CAR_STRIDE, readPose, readAppearance, frameSnapshot } from './trafficFrames.js';
import { parkAt, roadOpen, boulevardRoad, spawnRoadOpen, CAMERA_DRIFT, roundaboutAt, roundaboutStopAt } from './roadLayout.js';
import { populateMedian } from './boulevards.js';
import { populatePark } from './parkGeometry.js';
import { districtKind, populateDistrict } from './districts.js';
import { SceneryCache } from './sceneryCache.js';
import { canalColumn, populateCanal } from './canal.js';
import { createCanalGround } from './canalGround.js';
import { boatHullGeometry, addBoats } from './boats.js';
import { AirTraffic } from './airTraffic.js';
import { bridgeHeight, liftBridgePose } from './bridgeProfile.js';
import { populateRoadworks } from './roadworkGeometry.js';
import { populateRoundabout, roundaboutSceneryBatch } from './roundabouts.js';
import { ROUNDABOUT_STOP } from './roundaboutDimensions.js';
import { roundaboutCornerGeometry } from './roundaboutGeometry.js';
import { parkingAt, populateParking } from './parkingLayout.js';
import { diagonalAt, approachesNear } from './diagonalLayout.js';
import { diagonalLotGeometry, populateDiagonal, approachStreetBatch } from './diagonalGeometry.js';
import { animationVariation, stuntType, vehicleStunt } from './vehicleBounce.js';
import { FOLIAGE_SWAY_DURATION, claimAnimationStart, foliageSwayAngle, withinGestureRadius } from './foliageAnimation.js';
import { BUILDING_STRETCH_DURATION, buildingMotion } from './buildingAnimation.js';
import { AdaptiveQuality, QUALITY_PROFILES } from './adaptiveQuality.js';

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
  const parking = parkingAt(gx,gz,blockSize);
  const diagonal = diagonalAt(gx, gz, blockSize);
  const northRoad = roadOpen(0, gz, gx), westRoad = roadOpen(1, gx, gz);
  const northBoulevard = northRoad && boulevardRoad(0, gz), westBoulevard = westRoad && boulevardRoad(1, gx);
  const random = seededRandom(gx, gz);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const streetBatch=approachStreetBatch(batch,approachesNear(gx+.5,gz+.5,blockSize),blockSize,x-gx*blockSize,z-gz*blockSize);
  const lotBatch = roundaboutSceneryBatch(boulevardSceneryBatch(batch,gx,gz,x,z,blockSize), gx, gz, x, z, blockSize);
  const ring = roundaboutAt(gx, gz), eastRing = roundaboutAt(gx + 1, gz), southRing = roundaboutAt(gx, gz + 1);
  let layoutScale = 1;
  const put = (kind, dx, y, dz, w, h, d, color, rotation = 0, stage) => {
    // Small block settings must not push raised lawns or building plinths into
    // the driveable shoulder. Tree trunks are placed inside this boundary too.
    if (y >= 0.4 && ['round', 'paving', 'building'].includes(kind)) {
      const inset = PAVED_ROAD / 2 + 0.9;
      w = Math.min(w, 2 * Math.min(dx * layoutScale - inset, blockSize - dx * layoutScale - inset) / layoutScale);
      d = Math.min(d, 2 * Math.min(dz * layoutScale - inset, blockSize - dz * layoutScale - inset) / layoutScale);
    }
    const lift = canal && northRoad && kind === 'paint' && Math.abs(dz) < PAVED_ROAD / 2 + 0.1 ? bridgeHeight(dx, blockSize) : 0;
    const tilt = lift ? Math.atan2(bridgeHeight(dx + w / 2, blockSize) - bridgeHeight(dx - w / 2, blockSize), w) : 0;
    (kind === 'paint' ? streetBatch : lotBatch).add(kind, x + dx * layoutScale, y + lift, z + dz * layoutScale, w * layoutScale, h, d * layoutScale, color, rotation, 0, tilt, stage);
  };
  const tree = (tx, tz, size = 1) => {
    put('box', tx, 0.85, tz, 0.32, 1.45, 0.32, '#777777', 0, REVEAL.trees);
    put('crown', tx, 1.55 + size * 0.65, tz, 1.25 * size, 1.55 * size, 1.2 * size, pick(palette.leaves), random() * 6);
  };

  if (!parkLot && !canal && !parking && !diagonal) {
    put('round', blockSize / 2, 0.10, blockSize / 2, blockSize - PAVED_ROAD, 0.3, blockSize - PAVED_ROAD, palette.curb);
    put('round', blockSize / 2, 0.25, blockSize / 2, blockSize - PAVED_ROAD - 0.42, 0.34, blockSize - PAVED_ROAD - 0.42, palette.sidewalk);
  }
  // A narrow asphalt shoulder lets taxis ride the pavement with one side.
  for (const side of [-1, 1]) {
    const start = ring ? roundaboutStopAt(gx,gz,blockSize) : STOP_LINE;
    const endX = blockSize - (eastRing ? roundaboutStopAt(gx+1,gz,blockSize) : STOP_LINE), endZ = blockSize - (southRing ? roundaboutStopAt(gx,gz+1,blockSize) : STOP_LINE);
    if (northRoad) put('paint', (start + endX) / 2, 0.015, side * (streetHalf(0,gz)-.55), endX - start, 0.018, 0.06, '#8d8d8d');
    if (westRoad) put('paint', side * (streetHalf(1,gx)-.55), 0.015, (start + endZ) / 2, 0.06, 0.018, endZ - start, '#8d8d8d');
  }

  // Road markings stop before the intersection. Every tile owns two crossings.
  for (let p = 6.5; p < blockSize - 5; p += 3.3) {
    if (ring && p < ROUNDABOUT_STOP + 1) continue;
    if (northRoad && !northBoulevard && (!eastRing || p < blockSize - ROUNDABOUT_STOP - 1)) put('paint', p, 0.016, 0, 1.3, 0.018, 0.14, '#e9e9e9');
    if (westRoad && !westBoulevard && (!southRing || p < blockSize - ROUNDABOUT_STOP - 1)) put('paint', 0, 0.016, p, 0.14, 0.018, 1.3, '#e9e9e9');
  }
  for(const axis of[0,1])if(axis===0?northBoulevard:westBoulevard){
    const start=ring?roundaboutStopAt(gx,gz,blockSize):Math.max(STOP_LINE,streetHalf(1-axis,axis===0?gx:gz)+1.5);
    const end=blockSize-((axis===0?eastRing:southRing)?roundaboutStopAt(gx+(axis===0?1:0),gz+(axis===1?1:0),blockSize):7);
    for(let p=start+1;p<end;p+=3.3)for(const side of[-1,1])for(const offset of laneDividers(axis,axis===0?gz:gx))
      put('paint',axis===0?p:side*offset,.018,axis===0?side*offset:p,axis===0?1.3:.1,.02,axis===0?.1:1.3,'#e9e9e9');
  }
  for (let p = -Math.max(streetHalf(0,gz),streetHalf(1,gx)) + 0.65; p <= Math.max(streetHalf(0,gz),streetHalf(1,gx)) - 0.65; p += 0.66) {
    if (northRoad && Math.abs(p)<streetHalf(0,gz)-.5) put('paint', ring ? roundaboutStopAt(gx,gz,blockSize) : streetHalf(1,gx) + 1, 0.02, p, 1.28, 0.025, 0.34, '#f0f0f0');
    if (westRoad && Math.abs(p)<streetHalf(1,gx)-.5) put('paint', p, 0.02, ring ? roundaboutStopAt(gx,gz,blockSize) : streetHalf(0,gz) + 1, 0.34, 0.025, 1.28, '#f0f0f0');
  }

  populateRoadworks(batch, gx, gz, x, z, blockSize);
  populateRoundabout(batch, gx, gz, x, z, blockSize);
  if (northBoulevard && !canal) populateMedian(roundaboutSceneryBatch(streetBatch,gx,gz,x,z,blockSize), 0, x, z, blockSize);
  if (westBoulevard) populateMedian(roundaboutSceneryBatch(streetBatch,gx,gz,x,z,blockSize), 1, x, z, blockSize);
  if (diagonal) {
    populateDiagonal(batch, diagonal, x, z, blockSize, gx, gz);
    return;
  }
  if (canal) {
    populateCanal(batch, x, z, blockSize, gz, northBoulevard);
    return;
  }
  if (parkLot) {
    if (parkLot.x === gx && parkLot.z === gz) populatePark(lotBatch, x, z, blockSize, parkLot);
    return;
  }
  if (parking) {
    populateParking(boulevardSceneryBatch(batch,gx,gz,x,z,blockSize),gx,gz,x,z,blockSize);
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
    populateDistrict(districtKind(gx, gz), { put, tree, random, palette, gx, gz });
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

export function addCar(batch, car, originX, originZ, focus, camera, blockSize, hornEffects, previousPose = null, alpha = 1,
  visualEffect = null, onVisible = null, selectionKey = car) {
  const coordinates = carCoordinates(car, blockSize);
  // Simulate the offscreen traffic, but only upload visible cars to the GPU.
  if (!visiblePosition(coordinates, originX, originZ, focus, camera)) return;
  const pose = interpolatePresentation(presentation(car, coordinates), previousPose, alpha);
  return drawCarPose(batch, car, pose, originX, originZ, camera, hornEffects, blockSize, visualEffect, onVisible, selectionKey);
}

function drawCarPose(batch, car, pose, originX, originZ, camera, hornEffects, blockSize, visualEffect = null, onVisible = null,
  selectionKey = car) {
  const bridgeLift = liftBridgePose(pose, blockSize);
  pose.x -= originX; pose.z -= originZ;
  const visualType = stuntType(car.kind, car.taxi);
  onVisible?.(pose.x, 0.65 + (visualEffect?.lift ?? 0), pose.z, selectionKey, visualType);
  pose.sin = Math.sin(pose.angle); pose.cos = Math.cos(pose.angle);
  const { pitch, roll, lift } = pose;
  if (car.taxi && typeof car.hornAge === 'number') hornEffects?.add(car, pose.x, pose.z, camera, bridgeLift);
  const part = (kind, dx, y, dz, w, h, d, color, sprung = true) => {
    const local = sprung && (pitch || roll) ? bodyPartPose(dx, y, dz, pitch, roll) : { x: dx, y, z: dz };
    const animated = kind !== 'beam' && (visualEffect?.pitch || visualEffect?.roll)
      ? bodyPartPose(local.x, local.y, local.z, visualEffect.pitch, visualEffect.roll) : local;
    const visualLift = kind === 'beam' ? 0 : visualEffect?.lift ?? 0;
    batch.add(kind, pose.x + animated.x * pose.cos + animated.z * pose.sin, animated.y + (sprung ? lift : 0) + visualLift,
      pose.z - animated.x * pose.sin + animated.z * pose.cos, w, h, d, color, pose.angle,
      (sprung ? pitch : 0) + (kind === 'beam' ? 0 : visualEffect?.pitch ?? 0),
      (sprung ? roll : 0) + (kind === 'beam' ? 0 : visualEffect?.roll ?? 0));
  };
  if (drawTrafficVehicle(part, car, pose)) return true;
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

export function addTrafficFrame(batch, frame, originX, originZ, focus, camera, hornEffects, blockSize = BLOCK,
  effectFor = null, onVisible = null) {
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
    const key = `worker:${upper.data[offset]}`;
    const type = stuntType(car.kind, car.taxi);
    drawCarPose(batch, car, pose, originX, originZ, camera, hornEffects, blockSize,
      effectFor?.(key, type), onVisible, key); visible++;
  }
  return visible;
}

export function createCity(container, initialSettings, benchmark = null) {
  let settings = normalizeSettings(initialSettings);
  let qualityProfile = QUALITY_PROFILES.high;
  let BLOCK = settings.blockSize;
  let rebuildTimer;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLOR_SCHEMES[settings.colorScheme].background);
  const backgroundFade = createBackgroundFade(settings.colorScheme);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(benchmark?.pixelRatio ?? Math.min(window.devicePixelRatio, qualityProfile.pixelRatio));
  renderer.shadowMap.enabled = benchmark?.shadows ?? true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);
  benchmark?.onRenderer?.(renderer);

  const geometries = {
    diagonalLot: diagonalLotGeometry(),
    boat: boatHullGeometry(),
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
    wheel: new THREE.CylinderGeometry(0.5, 0.5, 1, 10).rotateZ(Math.PI / 2),
    taxi: new THREE.BoxGeometry(1, 1, 1),
    taxiDetail: new THREE.BoxGeometry(1, 1, 1),
    light: new THREE.BoxGeometry(1, 1, 1),
    beam: new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([
      -0.14, 0, -0.5, 0.14, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5,
    ], 3)).setIndex([0, 2, 1, 2, 3, 1]),
    crown: new THREE.DodecahedronGeometry(1, 0),
  };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reveal = new SceneReveal({ reducedMotion: reducedMotion.matches, paused: settings.paused });
  const staticBatch = new Batches(scene, geometries, false, reveal);
  const scenery = new SceneryCache(populateBlock);
  const carsBatch = new Batches(scene, geometries, true, reveal);
  const hornEffects = new HornEffects(scene);
  const airTraffic = new AirTraffic(scene);
  for (const material of airTraffic.materials) {
    if (material.colorWrite) backgroundFade.apply(material);
  }
  const groundMaterial = new THREE.MeshStandardMaterial({ color: '#555555', roughness: 1 });
  for (const material of [staticBatch.material, carsBatch.material, groundMaterial]) backgroundFade.apply(material);
  for (const batch of [staticBatch, carsBatch]) {
    for (const material of [batch.material, batch.taxiMaterial, batch.taxiDetailMaterial, batch.lightMaterial, batch.beamMaterial]) {
      reveal.apply(material, batch.dynamic ? REVEAL.cars : null);
    }
  }
  reveal.apply(groundMaterial, REVEAL.roads);
  const ground = new THREE.Mesh(createCanalGround(BLOCK), groundMaterial);
  let groundBlock = BLOCK, groundColumn = 0;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new THREE.HemisphereLight('#ffffff', '#b8b8b8', 1.8));
  const sunlight = new THREE.DirectionalLight('#ffffff', 2.5);
  sunlight.position.set(-35, 70, -25);
  sunlight.castShadow = true;
  const initialShadowSize = benchmark ? 2048 : qualityProfile.shadowMapSize;
  sunlight.shadow.mapSize.set(initialShadowSize, initialShadowSize);
  Object.assign(sunlight.shadow.camera, { left: -115, right: 115, top: 115, bottom: -115, near: 1, far: 220 });
  sunlight.shadow.normalBias = 0.07;
  sunlight.shadow.bias = -0.00015;
  sunlight.shadow.radius = 3;
  scene.add(sunlight, sunlight.target);
  renderer.domElement.dataset.quality = qualityProfile.name;

  const camera = new THREE.OrthographicCamera(-80, 80, 45, -45, 1, 400);
  const cameraOffset = new THREE.Vector3(CAMERA_OFFSET.x, CAMERA_OFFSET.y, CAMERA_OFFSET.z);
  const focus = new THREE.Vector3(BLOCK / 2, 0, BLOCK / 2);
  let originX = 0, originZ = 0, worldX = 0, worldZ = 0;
  let area = { x: 6, z: 6, extents: { x: 80, z: 80 } };
  let lastCellX = NaN, lastCellZ = NaN;
  let lanes = new Map();
  let time = 0, previous = 0, disposed = false;
  let boatTime = 0;
  const simulationClock = new SimulationClock(1 / (benchmark?.simulationHz === 60 ? 60 : 30));
  const fixedSimulation = benchmark?.fixedStep !== false;
  let previousPoses = new WeakMap(), renderAlpha = 1;
  let worker = null, workerFrame = null, workerFailure = null;
  let activeBrushEvent = null;
  const projectedVehicle = new THREE.Vector3();
  const foliageAnimatedMatrix = new THREE.Matrix4();
  const foliageRotationMatrix = new THREE.Matrix4();
  const foliageTranslationMatrix = new THREE.Matrix4();
  const buildingAnimatedMatrix = new THREE.Matrix4();
  const buildingScaleMatrix = new THREE.Matrix4();
  const buildingRotationMatrix = new THREE.Matrix4();
  const buildingTranslationMatrix = new THREE.Matrix4();
  const clickableVehicles = [];
  const clickableVehiclePool = [];
  const vehicleStunts = new Map();
  const foliageSwings = new Map();
  const buildingStretches = new Map();
  const addClickableVehicle = (x, y, z, key, type) => {
    const index = clickableVehicles.length;
    const vehicle = clickableVehiclePool[index] ?? (clickableVehiclePool[index] = {
      x: 0, y: 0, z: 0, screenX: 0, screenY: 0, key: null, type: 'car',
    });
    vehicle.x = x; vehicle.y = y; vehicle.z = z; vehicle.key = key; vehicle.type = type;
    clickableVehicles.push(vehicle);
  };
  const workerConfig = () => ({ settings: { ...settings, blockSize: BLOCK }, area,
    focus: { x: originX + focus.x, z: originZ + focus.z }, lightTime: time,
    seed: benchmark?.seed ?? 0, simulationHz: benchmark?.simulationHz === 60 ? 60 : 30,
    simulate: benchmark?.simulate !== false });
  const workerFailed = message => {
    workerFailure = message; worker = null; workerFrame = null;
    lanes.clear(); lastCellX = NaN; previous = 0;
    simulationClock.reset(); previousPoses = new WeakMap(); renderAlpha = 1;
  };

  function restartPopulation() {
    lanes.clear(); previousPoses = new WeakMap(); simulationClock.reset(); renderAlpha = 1;
    lastCellX = NaN; workerFrame = null;
    worker?.restart(workerConfig());
  }

  function applyQuality(profile) {
    if (profile === qualityProfile) return;
    qualityProfile = profile;
    renderer.domElement.dataset.quality = profile.name;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, profile.pixelRatio));
    renderer.shadowMap.enabled = profile.shadows;
    sunlight.castShadow = profile.shadows;
    if (profile.shadows && sunlight.shadow.mapSize.x !== profile.shadowMapSize) {
      sunlight.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
      sunlight.shadow.map?.dispose(); sunlight.shadow.map = null;
    }
    renderer.shadowMap.needsUpdate = profile.shadows;
    resize();
  }

  // Benchmarks keep explicit graphics settings so before/after runs remain
  // comparable. The live scene selects quality from measured frame cadence.
  const adaptiveQuality = benchmark ? null : new AdaptiveQuality(applyQuality);

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
    foliageSwings.clear();
    buildingStretches.clear();
    if (!reveal.done && !reveal.initialized) {
      reveal.waterPresent = [...staticBatch.items.values()].some(group =>
        group.values.slice(0, group.count).some(item => item[11] === REVEAL.water));
      reveal.initialized = true;
    }
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
    if (moving) boatTime += delta;
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
        if(car.turn?.kind==='diagonal')continue;
        const multiplier = (car.taxi ? settings.taxiSpeed : settings.trafficSpeed) / 100;
        car.cruise = car.baseCruise * multiplier;
        car.acceleration = car.baseAcceleration * multiplier;
        if(recycleVehicle(lane,car,center,half,lane.axis===0?area.extents.x:area.extents.z,BLOCK))previousPoses.delete(car);
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
    clickableVehicles.length = 0;
    const effectFor = (key, type) => {
      const stunt = vehicleStunts.get(key);
      if (!stunt) return null;
      const effect = vehicleStunt(type, timestamp - stunt.started, stunt.variation, reducedMotion.matches);
      if (!effect) vehicleStunts.delete(key);
      return effect;
    };
    let visibleCars = worker ? addTrafficFrame(carsBatch, workerFrame, originX, originZ, focus, camera, hornEffects, BLOCK,
      effectFor, addClickableVehicle) : 0;
    for (const lane of lanes.values()) {
      for (const car of lane.cars) {
        if (addCar(carsBatch, car, originX, originZ, focus, camera, BLOCK, hornEffects,
          fixedSimulation ? previousPoses.get(car) : null, renderAlpha, effectFor(car, stuntType(car.kind, car.taxi)),
          addClickableVehicle, car)) visibleCars++;
      }
    }
    addBoats(carsBatch, BLOCK, worldX, worldZ, area, boatTime, { effectFor, onVisible: addClickableVehicle });
    airTraffic.update(boatTime, focus, camera, { effectFor, onVisible: addClickableVehicle });
    if (activeBrushEvent) animateAtPointer(activeBrushEvent, true);
    carsBatch.flush();
    for (const [index, swing] of foliageSwings) {
      const elapsed = timestamp - swing.started;
      if (elapsed >= FOLIAGE_SWAY_DURATION) {
        for (const target of swing.targets) {
          target.mesh.setMatrixAt(target.index, target.base);
          target.mesh.instanceMatrix.needsUpdate = true;
        }
        foliageSwings.delete(index);
        continue;
      }
      const angle = foliageSwayAngle(elapsed, swing.variation, reducedMotion.matches);
      foliageAnimatedMatrix.makeTranslation(swing.x, swing.pivotY, swing.z);
      foliageRotationMatrix.makeRotationZ(angle);
      foliageAnimatedMatrix.multiply(foliageRotationMatrix);
      foliageRotationMatrix.makeRotationX(angle * 0.45);
      foliageAnimatedMatrix.multiply(foliageRotationMatrix);
      foliageTranslationMatrix.makeTranslation(-swing.x, -swing.pivotY, -swing.z);
      foliageAnimatedMatrix.multiply(foliageTranslationMatrix);
      for (const target of swing.targets) {
        target.animated.copy(foliageAnimatedMatrix).multiply(target.base);
        target.mesh.setMatrixAt(target.index, target.animated);
        target.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    for (const [index, stretch] of buildingStretches) {
      const elapsed = timestamp - stretch.started;
      if (elapsed >= BUILDING_STRETCH_DURATION) {
        stretch.mesh.setMatrixAt(index, stretch.base);
        stretch.mesh.instanceMatrix.needsUpdate = true;
        buildingStretches.delete(index);
        continue;
      }
      const motion = buildingMotion(elapsed, reducedMotion.matches, stretch.variation);
      buildingAnimatedMatrix.makeTranslation(stretch.x, stretch.bottom + motion.lift, stretch.z);
      buildingRotationMatrix.makeRotationZ(motion.tilt);
      buildingAnimatedMatrix.multiply(buildingRotationMatrix);
      buildingScaleMatrix.makeScale(motion.scaleXZ, motion.scaleY, motion.scaleXZ);
      buildingAnimatedMatrix.multiply(buildingScaleMatrix);
      buildingTranslationMatrix.makeTranslation(-stretch.x, -stretch.bottom, -stretch.z);
      buildingAnimatedMatrix.multiply(buildingTranslationMatrix).multiply(stretch.base);
      stretch.mesh.setMatrixAt(index, buildingAnimatedMatrix);
      stretch.mesh.instanceMatrix.needsUpdate = true;
    }
    if (!reveal.done) {
      reveal.advance(delta, { paused: settings.paused || document.hidden, reducedMotion: reducedMotion.matches });
      // Horns are pooled transparent sprites with their own animated opacity.
      for (const effect of [...hornEffects.rings, ...hornEffects.labels]) effect.material.opacity *= reveal.opacity.value[REVEAL.cars];
    }
    // At most one incoming tile in a light frame. A slow frame never has to
    // finish the entire next strip; missing tiles still have a synchronous path.
    if (moving && performance.now() - start < 4) scenery.warmOne();
    const renderStart = benchmark ? performance.now() : 0;
    benchmark?.beforeRender?.();
    renderer.render(scene, camera);
    adaptiveQuality?.record(timestamp, rafMs);
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
  let gesturePointer = null;
  const gestureTargets = new Set();
  const brushTargetsNow = new Set();
  const brushVehicleTargets = new Set();
  const brushVehiclesNow = new Set();
  const gesturePoint = { x: 0, y: 0 };
  const overControl = event => event.target instanceof Element && event.target.closest('button, input, select, textarea, a');
  const activateFoliage = (index, item, targetsInBrush) => {
    const key = `foliage:${index}`;
    targetsInBrush.add(key);
    if (!claimAnimationStart(gestureTargets, key, foliageSwings.has(index))) return;
    const crownMesh = staticBatch.meshes.get('crown'), crownBase = new THREE.Matrix4();
    crownMesh.getMatrixAt(index, crownBase);
    const targets = [{ mesh: crownMesh, index, base: crownBase, animated: new THREE.Matrix4() }];
    let pivotY = item[1] - item[4];
    const trunkGroup = staticBatch.items.get('box');
    const trunkIndex = trunkGroup?.values.slice(0, trunkGroup.count).findIndex(trunk =>
      trunk[11] === REVEAL.trees && Math.hypot(trunk[0] - item[0], trunk[2] - item[2]) < 0.08) ?? -1;
    if (trunkIndex >= 0) {
      const trunkMesh = staticBatch.meshes.get('box'), trunkBase = new THREE.Matrix4();
      trunkMesh.getMatrixAt(trunkIndex, trunkBase);
      targets.push({ mesh: trunkMesh, index: trunkIndex, base: trunkBase, animated: new THREE.Matrix4() });
      pivotY = trunkGroup.values[trunkIndex][1] - trunkGroup.values[trunkIndex][4] / 2;
    }
    foliageSwings.set(index, { targets, started: performance.now(), variation: animationVariation(),
      x: item[0], pivotY, z: item[2] });
  };
  const activateBuilding = (index, item, targetsInBrush) => {
    const key = `building:${index}`;
    targetsInBrush.add(key);
    if (!claimAnimationStart(gestureTargets, key, buildingStretches.has(index))) return;
    const mesh = staticBatch.meshes.get('building'), base = new THREE.Matrix4();
    mesh.getMatrixAt(index, base);
    buildingStretches.set(index, { mesh, base, started: performance.now(), variation: animationVariation(),
      x: item[0], bottom: item[1] - item[4] / 2, z: item[2] });
  };
  function animateAtPointer(event, vehiclesOnly = false) {
    const rect = renderer.domElement.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      activeBrushEvent = null; gestureTargets.clear(); return;
    }
    const radius = event.pointerType === 'touch' ? 72 : 56;
    const targetsInBrush = brushTargetsNow;
    targetsInBrush.clear();
    brushVehiclesNow.clear();
    gesturePoint.x = event.clientX; gesturePoint.y = event.clientY;
    for (const vehicle of clickableVehicles) {
      projectedVehicle.set(vehicle.x, vehicle.y, vehicle.z).project(camera);
      vehicle.screenX = rect.left + (projectedVehicle.x + 1) * rect.width / 2;
      vehicle.screenY = rect.top + (1 - projectedVehicle.y) * rect.height / 2;
      if (!withinGestureRadius(vehicle.screenX, vehicle.screenY, gesturePoint, radius)) continue;
      targetsInBrush.add(vehicle.key);
      brushVehiclesNow.add(vehicle.key);
      if (!claimAnimationStart(gestureTargets, vehicle.key, vehicleStunts.has(vehicle.key))) continue;
      vehicleStunts.set(vehicle.key, { started: performance.now(), variation: animationVariation() });
    }
    if (vehiclesOnly) {
      for (const target of brushVehicleTargets) if (!brushVehiclesNow.has(target)) gestureTargets.delete(target);
      brushVehicleTargets.clear();
      for (const target of brushVehiclesNow) brushVehicleTargets.add(target);
      return;
    }
    const crownGroup = staticBatch.items.get('crown');
    for (let index = 0; index < (crownGroup?.count ?? 0); index++) {
      const item = crownGroup.values[index];
      projectedVehicle.set(item[0], item[1], item[2]).project(camera);
      const screenX = rect.left + (projectedVehicle.x + 1) * rect.width / 2;
      const screenY = rect.top + (1 - projectedVehicle.y) * rect.height / 2;
      if (withinGestureRadius(screenX, screenY, gesturePoint, radius)) activateFoliage(index, item, targetsInBrush);
    }
    const buildingGroup = staticBatch.items.get('building');
    for (let index = 0; index < (buildingGroup?.count ?? 0); index++) {
      const item = buildingGroup.values[index];
      projectedVehicle.set(item[0], item[1], item[2]).project(camera);
      const screenX = rect.left + (projectedVehicle.x + 1) * rect.width / 2;
      const screenY = rect.top + (1 - projectedVehicle.y) * rect.height / 2;
      if (withinGestureRadius(screenX, screenY, gesturePoint, radius)) activateBuilding(index, item, targetsInBrush);
    }
    for (const target of gestureTargets) if (!targetsInBrush.has(target)) gestureTargets.delete(target);
    brushVehicleTargets.clear();
    for (const target of brushVehiclesNow) brushVehicleTargets.add(target);
  }
  const updateActiveBrush = event => {
    activeBrushEvent ??= {};
    activeBrushEvent.clientX = event.clientX;
    activeBrushEvent.clientY = event.clientY;
    activeBrushEvent.pointerType = event.pointerType || 'mouse';
  };
  const beginGesture = event => {
    if (event.pointerType === 'mouse' || event.button !== 0 || overControl(event)) return;
    gesturePointer = event.pointerId;
    gestureTargets.clear();
    updateActiveBrush(event);
    animateAtPointer(event);
  };
  const continueGesture = event => {
    if (event.pointerType === 'mouse') return;
    if (event.pointerId !== gesturePointer) return;
    if (overControl(event)) { activeBrushEvent = null; return; }
    updateActiveBrush(event);
    const points = event.getCoalescedEvents?.() ?? [event];
    for (const point of points.length ? points : [event]) animateAtPointer(point);
  };
  const endGesture = event => {
    if (event.pointerType === 'mouse') return;
    if (event.pointerId !== gesturePointer) return;
    gesturePointer = null;
    activeBrushEvent = null;
    gestureTargets.clear();
  };
  const continueMouseGesture = event => {
    if (overControl(event)) { activeBrushEvent = null; gestureTargets.clear(); return; }
    updateActiveBrush(event); animateAtPointer(event);
  };
  const leaveMouseBrush = () => {
    activeBrushEvent = null;
    gestureTargets.clear();
  };
  window.addEventListener('pointerdown', beginGesture, true);
  window.addEventListener('pointermove', continueGesture, true);
  window.addEventListener('pointerup', endGesture, true);
  window.addEventListener('pointercancel', endGesture, true);
  window.addEventListener('mousemove', continueMouseGesture, true);
  document.documentElement.addEventListener('mouseleave', leaveMouseBrush);
  const visibility = () => {
    previous = 0; simulationClock.reset(); previousPoses = new WeakMap(); renderAlpha = 1;
    adaptiveQuality?.reset();
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
        resize();
        restartPopulation();
      }, 180);
    }
  }

  function dispose() {
    disposed = true;
    clearTimeout(rebuildTimer);
    worker?.dispose();
    observer.disconnect();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pointerdown', beginGesture, true);
    window.removeEventListener('pointermove', continueGesture, true);
    window.removeEventListener('pointerup', endGesture, true);
    window.removeEventListener('pointercancel', endGesture, true);
    window.removeEventListener('mousemove', continueMouseGesture, true);
    document.documentElement.removeEventListener('mouseleave', leaveMouseBrush);
    renderer.setAnimationLoop(null);
    reveal.finish();
    scenery.dispose(); staticBatch.dispose(); carsBatch.dispose(); hornEffects.dispose(); airTraffic.dispose();
    Object.values(geometries).forEach(geometry => geometry.dispose());
    ground.geometry.dispose(); groundMaterial.dispose();
    sunlight.shadow.map?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  return { updateSettings, dispose, quality: () => qualityProfile,
    snapshot: () => worker ? frameSnapshot(workerFrame?.lower) : trafficSnapshot(lanes) };
}
