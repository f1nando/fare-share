const REHEARSAL_PREFIX = '/rehearsal';

export function isRehearsalPath(pathname = window.location.pathname) {
  return pathname === REHEARSAL_PREFIX || pathname.startsWith(`${REHEARSAL_PREFIX}/`);
}

export function stripAppPrefix(pathname) {
  if (!isRehearsalPath(pathname)) return pathname;
  return pathname.slice(REHEARSAL_PREFIX.length) || '/';
}

export function appPath(path) {
  return isRehearsalPath() ? `${REHEARSAL_PREFIX}${path}` : path;
}
