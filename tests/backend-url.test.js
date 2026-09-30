import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBackendUrl } from '../src/backendUrl.js';

test('production backend URL never points a visitor to localhost', () => {
  assert.equal(resolveBackendUrl('http://localhost:8787', true), '');
  assert.equal(resolveBackendUrl('http://127.0.0.1:8787/', true), '');
  assert.equal(resolveBackendUrl('', true), '');
});

test('backend URL preserves explicit remote and local development targets', () => {
  assert.equal(resolveBackendUrl('https://api.example.test/', true), 'https://api.example.test');
  assert.equal(resolveBackendUrl('', false), 'http://localhost:8787');
  assert.equal(resolveBackendUrl('http://localhost:9000/', false), 'http://localhost:9000');
});
