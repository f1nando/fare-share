import assert from 'node:assert/strict';
import test from 'node:test';
import { privateChatId, snapshotChecks, transition } from './checks.mjs';

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
  assert.match(transition(state, check, 1_803_000).message, /^ALERT/);
  const recovered = transition(state, { ...check, ok: true }, 5_000);
  assert.match(recovered.message, /^RECOVERED/);
  assert.equal(transition(recovered.state, { ...check, ok: true }, 6_000).message, undefined);
});
test('disabled worker is healthy, enabled stopped/stale worker and low SOL are not', () => {
  const snapshot = { database: true, backendActive: true, rpc: true, balanceLamports: '100000001', minimumLamports: '100000000', diskUsedPercent: 30, recentErrors: 0, workerActive: false, worker: { enabled: false } };
  assert.equal(snapshotChecks(snapshot).every(c => c.ok), true);
  snapshot.worker.enabled = true;
  assert.equal(snapshotChecks(snapshot).find(c => c.key === 'worker').ok, false);
  snapshot.balanceLamports = '1';
  assert.equal(snapshotChecks(snapshot).find(c => c.key === 'payer-sol').ok, false);
  snapshot.database = false;
  snapshot.worker.enabled = false;
  assert.equal(snapshotChecks(snapshot).find(c => c.key === 'worker').ok, false);
});
