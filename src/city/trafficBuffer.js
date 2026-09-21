import { CAR_STRIDE } from './trafficFrames.js';

export class TrafficBuffer {
  constructor(step = 1 / 30) {
    this.step = step;
    this.capacity = Math.ceil(1 / step) + 1;
    // Start promptly, then keep filling the larger reserve during playback.
    this.preload = 0.3;
    this.reset();
  }
  reset() {
    this.frames = []; this.time = 0; this.desiredTime = 0; this.rate = 1;
    this.ready = false; this.underruns = 0; this.starved = false;
  }
  push(frame) {
    if (this.frames.length >= this.capacity || frame.time <= (this.frames.at(-1)?.time ?? -1)) return false;
    frame.index = new Map();
    for (let i = 0; i < frame.data.length; i += CAR_STRIDE) frame.index.set(frame.data[i], i);
    this.frames.push(frame);
    if (!this.ready && this.frames.at(-1).time - this.frames[0].time >= this.preload - 1e-8) this.ready = true;
    return true;
  }
  advance(delta, moving) {
    if (!this.frames.length) return null;
    const latest = this.frames.at(-1).time;
    if (moving && this.ready) {
      const elapsed = Math.max(0, delta);
      delta = Math.min(elapsed, 0.06);
      // Retain a bounded time debt after a long visible frame, without jumping
      // the camera across the whole delay. Hidden time is excluded by the caller.
      this.desiredTime = Math.min(this.desiredTime + elapsed, this.time + 0.5);
      const reserve = latest - this.time;
      const targetRate = reserve < 0.12 ? Math.max(0, reserve / 0.12)
        : reserve > this.preload ? Math.min(1.08, 1 + (this.desiredTime - this.time) * 0.4) : 1;
      this.rate += (targetRate - this.rate) * (1 - Math.exp(-delta * 12));
      const next = this.time + delta * this.rate;
      const starved = next > latest + 1e-8;
      if (starved && !this.starved) this.underruns++;
      this.starved = starved;
      this.time = Math.min(next, latest, this.desiredTime);
    }
    while (this.frames.length > 2 && this.frames[1].time <= this.time) this.frames.shift();
    const lower = this.frames[0], upper = this.frames[1] ?? lower;
    const alpha = upper.time === lower.time ? 0 : Math.max(0, Math.min(1, (this.time - lower.time) / (upper.time - lower.time)));
    return { lower, upper, alpha, focusX: lower.focusX + (upper.focusX - lower.focusX) * alpha,
      focusZ: lower.focusZ + (upper.focusZ - lower.focusZ) * alpha,
      lightTime: lower.lightTime + (upper.lightTime - lower.lightTime) * alpha };
  }
  get reserveMs() { return Math.max(0, (this.frames.at(-1)?.time ?? 0) - this.time) * 1000; }
}
