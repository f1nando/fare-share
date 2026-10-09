import assert from 'node:assert/strict';
import test from 'node:test';
import { privateChatId, snapshotChecks, transition } from './checks.mjs';
import { measureHttpCheck } from './http-check.mjs';

test('only private chats can claim the administrator', () => {
  assert.equal(privateChatId({ message: { chat: { type: 'private', id: 123 } } }), '123');
  assert.equal(privateChatId({ message: { chat: { type: 'group', id: -123 } } }), undefined);
});
test('threshold, cooldown, and recovery only after an actually delivered alert', () => {
  const check = { key: 'api', ok: false, detail: 'unavailable' };
  let state;
  for (let i = 1; i <= 3; i++) {
    const result = transition(state, check, i * 1000);
    assert.equal(Boolean(result.message), i === 3);
    state = result.state;
  }
  assert.equal(transition(state, { ...check, ok: true }, 4_000).message, undefined);
  state = { ...state, notified: true, lastSentAt: 3_000 };
  assert.equal(transition(state, check, 4_000).message, undefined);
  assert.match(transition(state, check, 1_803_000).message, /^🔴 ALERT/);
  const recovered = transition(state, { ...check, ok: true }, 5_000);
  assert.match(recovered.message, /^🟢 RECOVERED/);
  assert.equal(transition(recovered.state, { ...check, ok: true }, 6_000).message, undefined);
});
test('disabled worker is healthy, enabled stopped/stale worker and low SOL are not', () => {
  const snapshot = { database: true, backendActive: true, rpc: true, balanceLamports: '100000001', minimumLamports: '100000000', diskUsedPercent: 30, recentServerErrors: 0, recentClientErrors: 0, workerActive: false, worker: { enabled: false } };
  assert.equal(snapshotChecks(snapshot).every(c => c.ok), true);
  snapshot.worker.enabled = true;
  assert.equal(snapshotChecks(snapshot).find(c => c.key === 'worker').ok, false);
  snapshot.balanceLamports = '1';
  assert.equal(snapshotChecks(snapshot).find(c => c.key === 'payer-sol').ok, false);
  snapshot.database = false;
  snapshot.worker.enabled = false;
  assert.equal(snapshotChecks(snapshot).find(c => c.key === 'worker').ok, false);
});
test('browser errors do not mark server errors unhealthy; missing counts are unknown', () => {
  const snapshot = { recentServerErrors: 0, recentClientErrors: 20, clientErrorResources: [{ location: 'cdn.test/a.css', count: 20 }] };
  const checks = snapshotChecks(snapshot);
  assert.equal(checks.find(c => c.key === 'server-errors').ok, true);
  const browser = checks.find(c => c.key === 'client-errors');
  assert.equal(browser.ok, false);
  assert.match(browser.detail, /Browser errors.*cdn.test\/a.css \(20\)/);
  assert.equal(snapshotChecks({}).find(c => c.key === 'server-errors').ok, null);
});
test('Cloudflare challenge is unknown, not an outage or recovery', () => {
  const previous = { key: 'website', failures: 3, notified: true, lastSentAt: 1000 };
  const result = transition(previous, { key: 'website', ok: null, detail: 'Browser challenge' }, 2000);
  assert.equal(result.message, undefined);
  assert.equal(result.state.notified, true);
  assert.equal(result.state.failures, 3);
});
test('HTTP timings include headers and full HTML body download', async () => {
  let now = 0;
  const result = await measureHttpCheck('website', new URL('https://example.test/'), undefined, {
    clock: () => now,
    request: async () => {
      now = 25;
      return { ok: true, headers: new Headers(), text: async () => { now = 80; return '<html></html>'; } };
    },
  });
  assert.equal(result.ok, true);
  assert.match(result.detail, /TTFB 25 ms; total 80 ms/);
});
test('API response validation and network failures preserve timing', async () => {
  let now = 0;
  const result = await measureHttpCheck('api', new URL('https://example.test/api/health'), body => body.ok === true, {
    clock: () => now,
    request: async () => { now = 10; return { ok: true, headers: new Headers(), text: async () => { now = 15; return '{"ok":false}'; } }; },
  });
  assert.equal(result.ok, false);
  assert.match(result.detail, /TTFB 10 ms; total 15 ms/);
  now = 0;
  const failure = await measureHttpCheck('api', new URL('https://example.test/api/health'), undefined, {
    clock: () => now, request: async () => { now = 8000; throw new Error('Network error'); },
  });
  assert.equal(failure.ok, false);
  assert.match(failure.detail, /elapsed 8000 ms/);
});
