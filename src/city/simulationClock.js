export class SimulationClock {
  constructor(step = 1 / 60) { this.step = step; this.remainder = 0; }
  reset() { this.remainder = 0; }
  advance(delta, update) {
    // Same 60 ms recovery bound as the original animation loop. Four fixed
    // steps cover it without an unbounded backlog after a suspended page.
    this.remainder += Math.max(0, Math.min(delta, 0.06));
    let steps = 0;
    while (this.remainder + 1e-10 >= this.step && steps < 4) {
      update(this.step);
      this.remainder = Math.max(0, this.remainder - this.step);
      steps++;
    }
    return { steps, alpha: this.remainder / this.step };
  }
}
