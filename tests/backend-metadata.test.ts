import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildMetadataFiles, NFT_CLASSES } from '../scripts/build-nft-metadata.js';

const imageUris = Array.from({ length: 18 }, (_, index) => `https://example.test/image-${index}.png`);
const drivingSceneManifest = JSON.parse(readFileSync(
  new URL('../original-assets/driving-scenes/manifest.json', import.meta.url),
  'utf8',
)) as Array<{ name: string; file: string; lightsOn: boolean }>;

test('metadata generator creates collection, 16 ordered machine variants and trainee NFT', () => {
  const files = buildMetadataFiles(imageUris);
  assert.equal(files.length, 18);
  assert.equal(files[0].file, 'collection.json');
  assert.equal(files[0].data.image, imageUris[0]);
  const machines = files.slice(1, 17);
  assert.equal(new Set(machines.map(item => item.file)).size, 16);
  assert.deepEqual(
    machines.map(item => item.data.image),
    imageUris.slice(1, 17),
  );

  for (const [classIndex, definition] of NFT_CLASSES.entries()) {
    for (let variant = 0; variant < 4; variant += 1) {
      const metadata = machines[classIndex * 4 + variant].data;
      assert.ok('attributes' in metadata);
      assert.deepEqual(metadata.attributes, [
        { trait_type: 'Class', value: definition.className },
        { trait_type: 'Model', value: definition.models[variant] },
        { trait_type: 'Weight', value: definition.weight },
        { trait_type: 'Max Supply', value: definition.supply },
      ]);
    }
  }
  assert.equal(files[17].file, 'trainee.json');
  assert.equal(files[17].data.image, imageUris[17]);
  assert.equal(files[17].data.name, 'TAXI Trainee — Dacia Logan');
  assert.equal(files[17].data.attributes?.find(item => item.trait_type === 'Type')?.value, 'Trainee');
  assert.equal(files[17].data.attributes?.find(item => item.trait_type === 'Model')?.value, 'Dacia Logan');
  assert.equal(files[17].data.attributes?.find(item => item.trait_type === 'Transferable')?.value, 'No');
  assert.equal(files[17].data.attributes?.find(item => item.trait_type === 'Repairable')?.value, 'No');
});

test('metadata class order matches all 16 canonical driving-scene sources with lights off', () => {
  const byName = new Map(drivingSceneManifest.map(item => [item.name, item]));
  assert.equal(byName.size, 16);
  for (const definition of NFT_CLASSES) {
    for (const model of definition.models) {
      const source = byName.get(model);
      assert.ok(source, `${model} must exist in the driving-scene manifest`);
      assert.equal(source.lightsOn, false);
      assert.match(source.file, /\.webp$/);
    }
  }
});

test('metadata generator requires collection, 16 machine and trainee image URLs', () => {
  assert.throws(() => buildMetadataFiles(imageUris.slice(0, 17)), /18 comma-separated HTTPS URLs/);
  assert.throws(() => buildMetadataFiles([...imageUris.slice(0, 17), 'ar://not-an-image-url']), /18 comma-separated HTTPS URLs/);
});
