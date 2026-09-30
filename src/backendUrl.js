export function resolveBackendUrl(configuredUrl, production) {
  const configured = String(configuredUrl || '').replace(/\/$/, '');
  const pointsToLocalhost = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::|$)/i.test(configured);
  if (production && pointsToLocalhost) return '';
  if (configured) return configured;
  return production ? '' : 'http://localhost:8787';
}

const env = import.meta.env ?? {};

export const BACKEND_URL = resolveBackendUrl(env.VITE_BACKEND_URL, Boolean(env.PROD));
