const APP_BASE = import.meta.env.BASE_URL === '/' ? '' : import.meta.env.BASE_URL.replace(/\/$/, '');
const REHEARSAL_PREFIX = '/rehearsal';

export function isRehearsalPath(pathname = window.location.pathname) {
  return pathname === REHEARSAL_PREFIX || pathname.startsWith(`${REHEARSAL_PREFIX}/`);
}

export function stripAppPrefix(pathname) {
  if (!isRehearsalPath(pathname)) return pathname;
  return pathname.slice(REHEARSAL_PREFIX.length) || '/';
}

export function appPath(path) {
  return APP_BASE ? `${APP_BASE}${path}` : path;
}

export function appAssetPath(path) {
  if (!path.startsWith('/') || !APP_BASE || path === APP_BASE || path.startsWith(`${APP_BASE}/`)) return path;
  return `${APP_BASE}${path}`;
}
