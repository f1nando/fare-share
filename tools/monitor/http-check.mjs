// Timings are measured from the observer, including network/TLS and body download.
export async function measureHttpCheck(key, url, validate, { request = fetch, clock = () => performance.now() } = {}) {
  const started = clock();
  const path = url.pathname;
  let ttfbMs;
  try {
    const response = await request(url, { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
    ttfbMs = Math.round(clock() - started);
    if (response.headers.get('cf-mitigated') === 'challenge') {
      await response.body?.cancel();
      return { key, ok: null, detail: `${path}: Cloudflare requires a browser challenge; see origin checks` };
    }
    // Consume HTML too: total measures the full response, not just its headers.
    const text = await response.text();
    const totalMs = Math.round(clock() - started);
    const timing = `TTFB ${ttfbMs} ms; total ${totalMs} ms`;
    if (!response.ok || (validate && !validate(JSON.parse(text)))) {
      return { key, ok: false, detail: `${path} invalid response (${timing})` };
    }
    return { key, ok: true, detail: `${path} reachable and valid (${timing})` };
  } catch {
    const elapsedMs = Math.round(clock() - started);
    return { key, ok: false, detail: `${path} unavailable or invalid response (${ttfbMs === undefined ? '' : `TTFB ${ttfbMs} ms; `}elapsed ${elapsedMs} ms)` };
  }
}
