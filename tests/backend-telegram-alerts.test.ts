import assert from 'node:assert/strict';
import test from 'node:test';
import { alertShouldSend, privateChatId } from '../server/telegramAlerts.js';

test('Telegram administrator can only be claimed by a private chat', () => {
  assert.equal(privateChatId({ update_id: 1, message: { chat: { id: 123, type: 'private' } } }), '123');
  assert.equal(privateChatId({ update_id: 2, message: { chat: { id: -123, type: 'group' } } }), undefined);
  assert.equal(privateChatId({ update_id: 3 }), undefined);
});

test('Telegram alerts honor failure thresholds and the thirty minute cooldown', () => {
  const now = new Date('2026-09-30T12:00:00.000Z');
  assert.equal(alertShouldSend(2, 3, undefined, now), false);
  assert.equal(alertShouldSend(3, 3, undefined, now), true);
  assert.equal(alertShouldSend(4, 3, new Date('2026-09-30T11:31:00.000Z'), now), false);
  assert.equal(alertShouldSend(4, 3, new Date('2026-09-30T11:30:00.000Z'), now), true);
});
