// Keep resource diagnostics useful without retaining URL credentials or queries.
function resourceString(value) {
  if (typeof value === 'string') return value;
  // SVGImageElement.href is SVGAnimatedString, not an ordinary string.
  if (value && typeof value.baseVal === 'string') return value.baseVal;
  return '';
}

export function resourceLocation(value, base) {
  try {
    const text = resourceString(value);
    if (!text) return '';
    const url = new URL(text, base);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `${url.origin}${url.pathname}`.slice(0, 1_000);
  } catch { return ''; }
}

export function browserErrorDetails(event, browserWindow) {
  const target = event.target;
  const element = target && target !== browserWindow;
  const resource = element ? [target.currentSrc, target.src, target.href,
    target.getAttribute?.('href'), target.getAttribute?.('src'),
    target.getAttributeNS?.('http://www.w3.org/1999/xlink', 'href'),
  ].map(resourceString).find(Boolean) || '' : '';
  const filename = event.filename || '';
  return {
    error: event.error || event.message || (resource ? 'Resource failed to load' : 'Browser error without details'),
    context: {
      event: element ? 'resource-error' : 'window-error',
      ...(resource ? { resource } : {}),
      ...(element && target.tagName ? { resourceType: String(target.tagName).toLowerCase() } : {}),
      ...(filename ? { filename } : {}),
      ...(Number.isInteger(event.lineno) ? { line: event.lineno } : {}),
      ...(Number.isInteger(event.colno) ? { column: event.colno } : {}),
    },
  };
}

export function createErrorReportGate(limit = 20) {
  const reported = new Set();
  return payload => {
    const key = JSON.stringify([payload.path, payload.name, payload.message, payload.stack || '', payload.context]);
    if (reported.has(key) || reported.size >= limit) return false;
    reported.add(key);
    return true;
  };
}
