import { COLOR_SCHEMES } from './colorSchemes.js';

export const SETTINGS_KEY = 'taxi-city.settings.v1';
export const DEFAULT_SETTINGS = Object.freeze({
  colorScheme: 'classic',
  density: 70,
  taxiShare: 7,
  trafficSpeed: 130,
  taxiSpeed: 120,
  weaving: 10,
  blockSize: 40,
  zoom: 80,
  cameraSpeed: 200,
  paused: false,
});

export const SETTING_GROUPS = [
  { title: 'Traffic', controls: [
    { key: 'density', label: 'Number of cars', min: 0, max: 200, step: 5, unit: '%' },
    { key: 'trafficSpeed', label: 'Traffic speed', min: 10, max: 250, step: 5, unit: '%' },
  ] },
  { title: 'Taxis', controls: [
    { key: 'taxiShare', label: 'Taxi share', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'taxiSpeed', label: 'Taxi speed', min: 10, max: 250, step: 5, unit: '%' },
    { key: 'weaving', label: 'Extra wild driving', min: 0, max: 200, step: 10, unit: '%' },
  ] },
  { title: 'City and camera', controls: [
    { key: 'blockSize', label: 'Block size', min: 24, max: 64, step: 2, unit: '' },
    { key: 'zoom', label: 'Zoom', min: 50, max: 200, step: 5, unit: '%' },
    { key: 'cameraSpeed', label: 'Camera movement', min: 0, max: 400, step: 10, unit: '%' },
  ] },
];

export function normalizeSettings(value) {
  const result = { ...DEFAULT_SETTINGS };
  if (!value || typeof value !== 'object') return result;
  for (const group of SETTING_GROUPS) {
    for (const { key, min, max, step } of group.controls) {
      if (typeof value[key] === 'number' && Number.isFinite(value[key])) {
        const clamped = Math.max(min, Math.min(max, value[key]));
        result[key] = min + Math.round((clamped - min) / step) * step;
      }
    }
  }
  if (typeof value.paused === 'boolean') result.paused = value.paused;
  if (Object.hasOwn(COLOR_SCHEMES, value.colorScheme)) result.colorScheme = value.colorScheme;
  return result;
}

export function loadSettings() {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY))); }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  catch { /* The controls still work if browser storage is unavailable. */ }
}
