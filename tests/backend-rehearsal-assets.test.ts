import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareRehearsalAssets, rehearsalAssetSources } from '../scripts/prepare-rehearsal-assets.js';

test('rehearsal asset staging has the exact Collection, 16 machines, Trainee and FARETEST order', async () => {
  const sources = rehearsalAssetSources();
  assert.equal(sources.length, 19);
  assert.deepEqual(sources.filter(item => item.index !== null).map(item => item.index), Array.from({ length: 18 }, (_, index) => index));
  assert.equal(new Set(sources.map(item => item.output)).size, 19);
  assert.equal(sources.at(-1)?.name, 'FARETEST');

  const output = await mkdtemp(join(tmpdir(), 'taxi-rehearsal-assets-'));
  const manifest = await prepareRehearsalAssets(output);
  assert.equal(manifest.assets.length, 19);
  assert.equal(manifest.nftImageOrder.length, 18);
  const saved = JSON.parse(await readFile(join(output, 'assets-manifest.json'), 'utf8'));
  assert.deepEqual(saved.nftImageOrder, manifest.nftImageOrder);
  assert.ok(manifest.assets.every(item => /^[0-9a-f]{64}$/.test(item.sha256)));
});
