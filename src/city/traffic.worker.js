import { TrafficSimulation } from './trafficSimulation.js';

let simulation, epoch, pending = 0, timer;
const send = frame => self.postMessage({ type: 'frame', epoch, frame }, [frame.data.buffer]);
const fail = error => { pending = 0; self.postMessage({ type: 'error', epoch, message: error.message }); };
function produce() {
  try {
    send(simulation.advance());
    if (--pending > 0) timer = setTimeout(produce, 0);
    else self.postMessage({ type: 'done', epoch });
  } catch (error) { fail(error); }
}
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      clearTimeout(timer); pending = 0; epoch = data.epoch;
      simulation = new TrafficSimulation(data.config); send(simulation.snapshot());
      self.postMessage({ type: 'done', epoch });
    } else if (data.epoch === epoch) {
      if (data.type === 'configure') simulation.configure(data.config);
      if (data.type === 'produce' && !pending) {
        pending = Math.max(1, Math.min(12, data.count));
        // Yield between complete physics steps; never publish half-updated traffic.
        timer = setTimeout(produce, 0);
      }
    }
  } catch (error) { fail(error); }
};
