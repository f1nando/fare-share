// Keep resource diagnostics useful without retaining URL credentials or queries.
export function resourceLocation(value, base) {
  try {
    const url = new URL(String(value), base);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `${url.origin}${url.pathname}`.slice(0, 1_000);
  } catch { return ''; }
}

export function browserErrorDetails(event, browserWindow) {
  const target = event.target;
  const element = target && target !== browserWindow;
  const resource = element ? target.currentSrc || target.src || target.href || '' : '';
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
