import { normalizeSettings } from './settings.js';
import { originShift, resizeLanePopulation, releaseOutsideLanes } from './activeWorld.js';
import { populateLane } from './trafficPopulation.js';
import { resetSignal, STOP_LINE } from './world.js';
import { relocateToRoad, spawnRoadOpen, CAMERA_DRIFT } from './roadLayout.js';
import { updateNetwork } from './trafficNetwork.js';
import { packTraffic } from './trafficFrames.js';

export class TrafficSimulation {
  constructor({ settings, area, focus, lightTime = 0, seed = 0, simulationHz = 30, simulate = true }) {
    this.settings = normalizeSettings(settings); this.area = area;
    this.focus = { ...focus }; this.lightTime = lightTime; this.seed = seed;
    this.step = 1 / simulationHz; this.simulate = simulate; this.time = 0;
    this.lanes = new Map(); this.identities = { ids: new WeakMap(), next: 0, blockSize: this.settings.blockSize };
    this.rebuild();
  }

  configure({ settings, area }) {
    // Population/block changes create a new simulation epoch in the client.
    this.settings = { ...normalizeSettings(settings), blockSize: this.settings.blockSize,
      density: this.settings.density, taxiShare: this.settings.taxiShare };
    const resize = area.x !== this.area.x || area.z !== this.area.z;
    this.area = area;
    if (resize) this.rebuild();
  }

  rebuild() {
    const { settings, area, focus } = this, block = settings.blockSize;
    this.worldX = originShift(focus.x, block); this.worldZ = originShift(focus.z, block);
    const next = new Map();
    for (const axis of [0, 1]) {
      const centerLine = axis === 0 ? this.worldZ : this.worldX;
      const centerPosition = (axis === 0 ? this.worldX : this.worldZ) * block;
      const along = axis === 0 ? area.x : area.z, across = axis === 0 ? area.z : area.x;
      for (let line = centerLine - across; line <= centerLine + across; line++) for (const direction of [-1, 1]) {
        const key = `${axis}:${line}:${direction}`;
        let lane = this.lanes.get(key);
        if (!lane) lane = populateLane(axis, line, direction, settings, along, centerPosition, this.seed, true);
        else if (lane.radius !== along) resizeLanePopulation(lane,
          populateLane(axis, line, direction, settings, along, centerPosition, this.seed, true),
          axis === 0 ? focus.x : focus.z, (along + 0.5) * block, axis === 0 ? area.extents.x : area.extents.z,
          car => spawnRoadOpen(car, block, STOP_LINE));
        next.set(key, lane);
      }
    }
    releaseOutsideLanes(this.lanes, next); this.lanes = next;
    for (const lane of next.values()) for (const car of lane.cars) {
      if (!this.identities.ids.has(car)) this.identities.ids.set(car, ++this.identities.next);
    }
  }

  advance() {
    const start = performance.now(), { settings, step, focus, area } = this, block = settings.blockSize;
    focus.x += step * CAMERA_DRIFT.x * settings.cameraSpeed / 100;
    focus.z += step * CAMERA_DRIFT.z * settings.cameraSpeed / 100;
    if (originShift(focus.x, block) !== this.worldX || originShift(focus.z, block) !== this.worldZ) this.rebuild();
    for (const lane of this.lanes.values()) {
      const center = lane.axis === 0 ? focus.x : focus.z;
      const half = ((lane.axis === 0 ? area.x : area.z) + 0.5) * block;
      for (const car of lane.cars) {
        const multiplier = (car.taxi ? settings.taxiSpeed : settings.trafficSpeed) / 100;
        car.cruise = car.baseCruise * multiplier; car.acceleration = car.baseAcceleration * multiplier;
        if (car.position < center - half) { car.position += half * 2; resetSignal(car); relocateToRoad(car, block, STOP_LINE); }
        if (car.position > center + half) { car.position -= half * 2; resetSignal(car); relocateToRoad(car, block, STOP_LINE); }
      }
    }
    if (this.simulate) {
      const clockMultiplier = Math.min(1, settings.trafficSpeed / 100, settings.taxiSpeed / 100);
      this.lightTime += step * clockMultiplier;
      updateNetwork(this.lanes, step, this.lightTime, { blockSize: block, weaving: settings.weaving / 100, clockMultiplier, roadLayout: true });
    }
    this.time += step;
    return this.snapshot(performance.now() - start);
  }

  snapshot(simulationMs = 0) {
    const start = performance.now(), traffic = packTraffic(this.lanes, this.identities);
    return { ...traffic, time: this.time, lightTime: this.lightTime, focusX: this.focus.x, focusZ: this.focus.z,
      simulationMs, packMs: performance.now() - start };
  }
}
