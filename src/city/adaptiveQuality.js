export const QUALITY_PROFILES = Object.freeze({
  high: Object.freeze({ name: 'high', pixelRatio: 1.6, shadowMapSize: 2048, shadows: true, densityScale: 1 }),
  medium: Object.freeze({ name: 'medium', pixelRatio: 1.25, shadowMapSize: 1024, shadows: true, densityScale: 0.75 }),
  low: Object.freeze({ name: 'low', pixelRatio: 1, shadowMapSize: 0, shadows: false, densityScale: 0.5 }),
});

const SAMPLE_DURATION = 2500;
const RESAMPLE_DURATION = 5000;
const MIN_SAMPLES = 30;
const PROFILE_RANK = { high: 0, medium: 1, low: 2 };

export function framePercentile(values, percentile = 0.95) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)];
}

export function qualityForFrameTime(p95) {
  if (p95 <= 20) return QUALITY_PROFILES.high;
  if (p95 <= 32) return QUALITY_PROFILES.medium;
  return QUALITY_PROFILES.low;
}

export function scaledDensity(density, profile) {
  if (!density) return 0;
  return Math.max(5, Math.min(200, Math.round(density * profile.densityScale / 5) * 5));
}

export class AdaptiveQuality {
  constructor(onChange, { sampleDuration = SAMPLE_DURATION, resampleDuration = RESAMPLE_DURATION,
    minSamples = MIN_SAMPLES } = {}) {
    this.onChange = onChange;
    this.sampleDuration = sampleDuration;
    this.resampleDuration = resampleDuration;
    this.minSamples = minSamples;
    this.profile = QUALITY_PROFILES.high;
    this.initial = true;
    this.reset();
  }

  reset() {
    this.started = null;
    this.frames = [];
  }

  record(timestamp, frameTime) {
    if (!(frameTime > 0) || !Number.isFinite(frameTime)) return this.profile;
    if (this.started === null) this.started = timestamp;
    this.frames.push(frameTime);
    const duration = this.initial ? this.sampleDuration : this.resampleDuration;
    if (timestamp - this.started < duration || this.frames.length < this.minSamples) return this.profile;

    const measured = qualityForFrameTime(framePercentile(this.frames));
    // The first window may select any profile. Later windows only downgrade;
    // reloading re-measures from high and avoids quality oscillation mid-session.
    if (this.initial || PROFILE_RANK[measured.name] > PROFILE_RANK[this.profile.name]) {
      if (measured !== this.profile) {
        this.profile = measured;
        this.onChange(measured);
      }
    }
    this.initial = false;
    this.reset();
    return this.profile;
  }
}
