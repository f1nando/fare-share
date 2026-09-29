import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMetadataFiles, NFT_CLASSES } from '../scripts/build-nft-metadata.js';

const imageUris = Array.from({ length: 17 }, (_, index) => `https://example.test/image-${index}.png`);

test('metadata generator creates collection plus 16 ordered machine variants', () => {
  const files = buildMetadataFiles(imageUris);
  assert.equal(files.length, 17);
  assert.equal(files[0].file, 'collection.json');
  assert.equal(files[0].data.image, imageUris[0]);
  const machines = files.slice(1);
  assert.equal(new Set(machines.map(item => item.file)).size, 16);
  assert.deepEqual(
    machines.map(item => item.data.image),
    imageUris.slice(1),
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
});

test('metadata generator requires all 16 final image URLs plus the collection image', () => {
  assert.throws(() => buildMetadataFiles(imageUris.slice(0, 16)), /17 comma-separated HTTPS URLs/);
  assert.throws(() => buildMetadataFiles([...imageUris.slice(0, 16), 'ar://not-an-image-url']), /17 comma-separated HTTPS URLs/);
});
