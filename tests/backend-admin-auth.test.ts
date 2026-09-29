import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminAuth, makePasswordHash, verifyPassword } from '../server/adminAuth.js';

test('admin password uses salted scrypt and rejects incorrect input', () => {
  const hash = makePasswordHash('correct horse battery staple', Buffer.alloc(16, 7));
  assert.match(hash, /^scrypt\$/);
  assert.equal(verifyPassword('correct horse battery staple', hash), true);
  assert.equal(verifyPassword('incorrect password', hash), false);
  assert.doesNotMatch(hash, /correct horse/);
});

test('admin login returns a session and clears failed attempts', async () => {
  const records = new Map<string, { key: string; attempts: number; expiresAt: Date }>();
  const limits = {
    findOne: async ({ key }: { key: string }) => records.get(key) || null,
    updateOne: async ({ key }: { key: string }, update: { $inc: { attempts: number }; $set: { expiresAt: Date } }) => {
      const current = records.get(key);
      records.set(key, { key, attempts: (current?.attempts || 0) + update.$inc.attempts, expiresAt: update.$set.expiresAt });
    },
    deleteOne: async ({ key }: { key: string }) => { records.delete(key); },
  };
  const auth = createAdminAuth({
    username: 'admin',
    passwordScrypt: makePasswordHash('correct horse battery staple', Buffer.alloc(16, 8)),
    sessionSecret: 'x'.repeat(32),
    secureCookies: false,
  }, limits as never);
  await assert.rejects(auth.login('admin', 'wrong', '127.0.0.1'), /Invalid credentials/);
  const session = await auth.login('admin', 'correct horse battery staple', '127.0.0.1');
  assert.ok(session.token);
  assert.ok(session.csrf);
  assert.equal(records.size, 0);
});
