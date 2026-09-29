import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const outputDirectory = resolve(process.env.NFT_METADATA_OUTPUT_DIR || '.qa/nft-metadata');
const imageUris = (process.env.NFT_IMAGE_URIS || '').split(',').map(value => value.trim());
const isMainnetTest = process.env.NFT_METADATA_MODE === 'mainnet-test';
const collectionName = isMainnetTest ? 'FARE Taxi Park Mainnet Test' : 'FARE Taxi Park';
const symbol = isMainnetTest ? 'FARETEST' : 'FARE';

if (imageUris.length !== 5 || imageUris.some(uri => !/^https:\/\//.test(uri))) {
  throw new Error('NFT_IMAGE_URIS must contain five comma-separated HTTPS URLs: collection,economy,comfort,business,legend');
}

const classes = [
  { file: 'economy.json', name: `FARE${isMainnetTest ? ' Test' : ''} Economy`, className: 'Economy', weight: 1, supply: 1000, image: imageUris[1] },
  { file: 'comfort.json', name: `FARE${isMainnetTest ? ' Test' : ''} Comfort`, className: 'Comfort', weight: 3, supply: 300, image: imageUris[2] },
  { file: 'business.json', name: `FARE${isMainnetTest ? ' Test' : ''} Business`, className: 'Business', weight: 10, supply: 100, image: imageUris[3] },
  { file: 'legend.json', name: `FARE${isMainnetTest ? ' Test' : ''} Legend`, className: 'Legend', weight: 30, supply: 25, image: imageUris[4] },
];

const collectionDescription = isMainnetTest
  ? 'Disposable FARE Taxi Park mainnet validation collection. Not the production collection. No fixed APY.'
  : 'The official FARE Taxi Park collection on Solana. Rewards depend on actual protocol fees. No fixed APY.';

const files = [
  {
    file: 'collection.json',
    data: {
      name: collectionName,
      symbol,
      description: collectionDescription,
      image: imageUris[0],
    },
  },
  ...classes.map(item => ({
    file: item.file,
    data: {
      name: item.name,
      symbol,
      description: isMainnetTest
        ? `${/^[AEIOU]/.test(item.className) ? 'An' : 'A'} ${item.className} taxi from the disposable FARE Taxi Park mainnet validation collection. Not a production NFT. No fixed APY.`
        : `A ${item.className} taxi from FARE Taxi Park. Rewards depend on actual protocol fees. No fixed APY.`,
      image: item.image,
      attributes: [
        { trait_type: 'Class', value: item.className },
        { trait_type: 'Weight', value: item.weight },
        { trait_type: 'Max Supply', value: item.supply },
      ],
    },
  })),
];

await mkdir(outputDirectory, { recursive: true });
for (const item of files) {
  await writeFile(resolve(outputDirectory, item.file), `${JSON.stringify(item.data, null, 2)}\n`, 'utf8');
}

console.log(`Prepared ${files.length} metadata files in ${outputDirectory}`);
