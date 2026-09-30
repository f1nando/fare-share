import assert from 'node:assert/strict';
import test from 'node:test';
import type { ErrorLogDocument } from '../server/database.js';
import { recordError } from '../server/errorLog.js';

test('error log keeps useful diagnostics and strips secrets and query strings', async () => {
  let saved: ErrorLogDocument | undefined;
  const collection = {
    async insertOne(document: ErrorLogDocument) { saved = document; return { acknowledged: true }; },
  };
  const error = new Error('RPC failed at https://rpc.invalid/?api-key=private-value');
  const errorId = await recordError(collection as never, {
    source: 'server',
    error,
    status: 500,
    method: 'post',
    path: '/api/test?password=hidden',
    context: { operation: 'deposit', authorization: 'Bearer secret-value' },
  });
  assert.equal(saved?.errorId, errorId);
  assert.equal(saved?.path, '/api/test');
  assert.equal(saved?.method, 'POST');
  assert.equal(saved?.status, 500);
  assert.match(saved?.message || '', /api-key=\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(saved), /private-value|hidden|secret-value/);
  assert.ok(saved?.expiresAt.getTime() > saved!.createdAt.getTime());
});

test('client error context accepts only bounded scalar values', async () => {
  let saved: ErrorLogDocument | undefined;
  const collection = { async insertOne(document: ErrorLogDocument) { saved = document; return { acknowledged: true }; } };
  await recordError(collection as never, {
    source: 'client',
    message: 'Rendering failed',
    path: '/garage/',
    context: { event: 'window-error', nested: { secret: true }, count: 2 },
  });
  assert.deepEqual(saved?.context, { event: 'window-error', count: 2 });
});
