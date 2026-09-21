import { TrafficBuffer } from './trafficBuffer.js';

export class TrafficWorkerClient {
  constructor(config, onFailure, createWorker = () => new Worker(new URL('./traffic.worker.js', import.meta.url), { type: 'module' })) {
    this.worker = createWorker(); this.onFailure = onFailure; this.epoch = 0; this.disposed = false;
    this.buffer = new TrafficBuffer(1 / config.simulationHz);
    this.worker.onmessage = event => this.receive(event.data);
    this.worker.onerror = event => { event.preventDefault?.(); this.fail(event.message || 'Worker error'); };
    this.worker.onmessageerror = () => this.fail('Worker message error');
    try { this.restart(config); }
    catch (error) { this.dispose(); throw error; }
  }
  restart(config) {
    this.epoch++; this.buffer.reset(); this.busy = true;
    this.metrics = { workerSimulationMs: 0, workerPackMs: 0, workerReceiveMs: 0, workerSteps: 0 };
    clearTimeout(this.startupTimer);
    this.startupTimer = setTimeout(() => this.fail('Worker startup timeout'), 5000);
    this.worker.postMessage({ type: 'init', epoch: this.epoch, config });
  }
  configure(config) { this.worker.postMessage({ type: 'configure', epoch: this.epoch, config }); }
  receive(message) {
    if (this.disposed || message.epoch !== this.epoch) return;
    const start = performance.now();
    if (message.type === 'error') { this.fail(message.message); return; }
    if (message.type === 'frame') {
      clearTimeout(this.startupTimer);
      this.buffer.push(message.frame);
      this.metrics.workerSimulationMs += message.frame.simulationMs;
      this.metrics.workerPackMs += message.frame.packMs;
      this.metrics.workerSteps += Number(message.frame.time > 0);
    }
    if (message.type === 'done') { this.busy = false; this.fill(); }
    this.metrics.workerReceiveMs += performance.now() - start;
  }
  fill() {
    const count = this.buffer.capacity - this.buffer.frames.length;
    if (!this.disposed && !this.busy && count >= 2) {
      this.busy = true;
      this.worker.postMessage({ type: 'produce', epoch: this.epoch, count });
    }
  }
  advance(delta, moving) {
    const frame = this.buffer.advance(delta, moving); this.fill(); return frame;
  }
  takeMetrics() {
    const metrics = { ...this.metrics, bufferMs: this.buffer.reserveMs, bufferUnderruns: this.buffer.underruns,
      playbackRate: this.buffer.rate, workerStatus: this.buffer.ready ? 'running' : 'starting' };
    this.metrics = { workerSimulationMs: 0, workerPackMs: 0, workerReceiveMs: 0, workerSteps: 0 };
    return metrics;
  }
  fail(message) { if (!this.disposed) { this.dispose(); this.onFailure(message); } }
  dispose() { this.disposed = true; clearTimeout(this.startupTimer); this.worker.terminate(); this.buffer.reset(); }
}
