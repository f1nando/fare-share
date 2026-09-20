export const HORN_DURATION = 1.65;
const pulses = [0, 0.3, 0.6];

export function hornAnimation(age, variant = 0) {
  const result = { bounce: 0, waves: [], labels: [] };
  if (typeof age !== 'number' || age < 0 || age >= HORN_DURATION) return result;
  for (const [index, delay] of pulses.entries()) {
    const elapsed = age - delay;
    if (elapsed < 0) continue;
    const hop = elapsed / 0.28;
    if (hop < 1) result.bounce = Math.max(result.bounce, 0.14 * Math.sin(Math.PI * hop) ** 2);
    const wave = elapsed / 0.85;
    if (wave < 1) result.waves.push({ radius: 1 + 2.5 * wave, opacity: 0.65 * (1 - wave) });
    const progress = elapsed / 1.05;
    if (progress < 1) result.labels.push({
      word: (variant + index) % 2 ? 'BEEP!' : 'HONK!',
      x: (index % 2 ? 1 : -1) * (0.3 + 2 * progress),
      y: 1.5 + 2.7 * progress,
      size: 0.8 + 0.2 * Math.sin(Math.PI * progress),
      rotation: (index % 2 ? -1 : 1) * (0.12 + 0.2 * progress),
      opacity: Math.min(1, elapsed / 0.07) * (1 - progress) ** 0.7,
    });
  }
  return result;
}
