import { BACKEND_URL } from './backendUrl.js';

const MAX_REPORTS_PER_PAGE = 20;
let reportCount = 0;

export function reportClientError(error, context = {}) {
  if (reportCount >= MAX_REPORTS_PER_PAGE) return;
  reportCount += 1;
  const details = normalizeError(error);
  const body = JSON.stringify({
    ...details,
    path: window.location.pathname,
    context: {
      event: String(context.event || 'handled').slice(0, 80),
      ...(context.component ? { component: String(context.component).slice(0, 120) } : {}),
      ...(context.resource ? { resource: safePath(context.resource) } : {}),
    },
  });
  void fetch(`${BACKEND_URL}/api/errors`, {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body,
  }).catch(() => undefined);
}

export function apiErrorMessage(payload, fallback) {
  const message = payload?.error || fallback;
  return payload?.errorId ? `${message} Error ID: ${payload.errorId}` : message;
}

if (typeof window !== 'undefined' && !window.__fareErrorLoggingInstalled) {
  window.__fareErrorLoggingInstalled = true;
  const originalConsoleError = console.error.bind(console);
  console.error = (...values) => {
    originalConsoleError(...values);
    reportClientError(values.find(value => value instanceof Error) || values.map(printable).join(' '), { event: 'console-error' });
  };
  window.addEventListener('error', event => {
    const target = event.target;
    const resource = target && target !== window && 'src' in target ? target.src : '';
    reportClientError(event.error || event.message || 'Resource failed to load', {
      event: resource ? 'resource-error' : 'window-error',
      resource,
    });
  }, true);
  window.addEventListener('unhandledrejection', event => {
    reportClientError(event.reason || 'Unhandled promise rejection', { event: 'unhandled-rejection' });
  });
}

function normalizeError(value) {
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: String(value.message || 'Unknown client error').slice(0, 2_000),
      stack: String(value.stack || '').slice(0, 12_000),
    };
  }
  return { name: 'Error', message: String(value || 'Unknown client error').slice(0, 2_000) };
}

function safePath(value) {
  try { return new URL(String(value), window.location.origin).pathname.slice(0, 1_000); }
  catch { return ''; }
}

function printable(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}
