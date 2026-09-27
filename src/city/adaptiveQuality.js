export const QUALITY_PROFILES = Object.freeze({
  max: Object.freeze({ name: 'max', pixelRatio: 1.6, shadowMapSize: 2048, shadows: true }),
  high: Object.freeze({ name: 'high', pixelRatio: 1.4, shadowMapSize: 1024, shadows: true }),
  medium: Object.freeze({ name: 'medium', pixelRatio: 1.2, shadowMapSize: 512, shadows: true }),
  low: Object.freeze({ name: 'low', pixelRatio: 1, shadowMapSize: 0, shadows: false }),
});

const SAMPLE_DURATION = 2500;
const RESAMPLE_DURATION = 4000;
const MIN_SAMPLES = 30;
const UPGRADE_WINDOWS = 2;
const PROFILE_RANK = { max: 0, high: 1, medium: 2, low: 3 };

export function framePercentile(values, percentile = 0.95) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)];
}

export function qualityForFrameTime(p95, current = QUALITY_PROFILES.high) {
  if (current === QUALITY_PROFILES.max) {
    if (p95 <= 22) return QUALITY_PROFILES.max;
    if (p95 <= 28) return QUALITY_PROFILES.high;
    if (p95 <= 36) return QUALITY_PROFILES.medium;
    return QUALITY_PROFILES.low;
  }
  if (current === QUALITY_PROFILES.high) {
    if (p95 <= 18) return QUALITY_PROFILES.max;
    if (p95 <= 28) return QUALITY_PROFILES.high;
    if (p95 <= 36) return QUALITY_PROFILES.medium;
    return QUALITY_PROFILES.low;
  }
  if (current === QUALITY_PROFILES.medium) {
    if (p95 <= 22) return QUALITY_PROFILES.high;
    if (p95 <= 36) return QUALITY_PROFILES.medium;
    return QUALITY_PROFILES.low;
  }
  return p95 <= 28 ? QUALITY_PROFILES.medium : QUALITY_PROFILES.low;
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
    this.upgradeWindows = 0;
    this.reset();
  }

  reset() {
    this.upgradeWindows = 0;
    this.resetWindow();
  }

  resetWindow() {
    this.started = null;
    this.frames = [];
  }

  record(timestamp, frameTime) {
    if (!(frameTime > 0) || !Number.isFinite(frameTime)) return this.profile;
    if (this.started === null) this.started = timestamp;
    this.frames.push(frameTime);
    const duration = this.initial ? this.sampleDuration : this.resampleDuration;
    if (timestamp - this.started < duration || this.frames.length < this.minSamples) return this.profile;

    const measured = qualityForFrameTime(framePercentile(this.frames), this.profile);
    const direction = PROFILE_RANK[measured.name] - PROFILE_RANK[this.profile.name];
    let apply = direction > 0;
    if (direction < 0) {
      this.upgradeWindows++;
      apply = this.initial || this.upgradeWindows >= UPGRADE_WINDOWS;
    } else if (!direction) {
      this.upgradeWindows = 0;
    }
    if (apply) {
      this.profile = measured;
      this.upgradeWindows = 0;
      this.onChange(measured);
    }
    this.initial = false;
    this.resetWindow();
    return this.profile;
  }
}
