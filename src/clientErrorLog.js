import { BACKEND_URL } from './backendUrl.js';
import './siteToasts.js';
import { browserErrorDetails, resourceLocation } from './clientErrorDetails.js';
import { isWebGLUnavailable, createWebGLReporter } from './city/webglSupport.js';

const MAX_REPORTS_PER_PAGE = 20;
let reportCount = 0;
export const reportWebGLUnavailable = createWebGLReporter(reportClientError);

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
      ...(context.resource ? { resource: resourceLocation(context.resource, window.location.origin) } : {}),
      ...(context.resourceType ? { resourceType: String(context.resourceType).slice(0, 40) } : {}),
      ...(context.filename ? { filename: resourceLocation(context.filename, window.location.origin) } : {}),
      ...(Number.isInteger(context.line) ? { line: context.line } : {}),
      ...(Number.isInteger(context.column) ? { column: context.column } : {}),
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
    const error = values.find(value => value instanceof Error) || values.map(printable).join(' ');
    if (isWebGLUnavailable(error)) reportWebGLUnavailable('city-background');
    else reportClientError(error, { event: 'console-error' });
  };
  window.addEventListener('error', event => {
    const details = browserErrorDetails(event, window);
    reportClientError(details.error, details.context);
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

function printable(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}
