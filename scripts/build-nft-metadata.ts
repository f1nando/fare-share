import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const NFT_CLASSES = [
  {
    className: 'Economy', slug: 'economy', weight: 1, supply: 833,
    models: ['Checker Marathon', 'London Taxi', 'Chevrolet Caprice', 'Toyota Sienna'],
  },
  {
    className: 'Comfort', slug: 'comfort', weight: 3, supply: 278,
    models: ['Toyota Prius', 'Ford Crown Victoria', 'Toyota Camry', 'Mercedes E211'],
  },
  {
    className: 'Business', slug: 'business', weight: 10, supply: 83,
    models: ['Tesla Model 3', 'Bentley Flying Spur', 'Mercedes G63', 'Rolls-Royce Cullinan'],
  },
  {
    className: 'Legend', slug: 'legend', weight: 30, supply: 28,
    models: ['BMW M3 E46', 'Lamborghini Huracán', 'Bugatti Chiron', 'Porsche 911'],
  },
] as const;

const modelSlug = (model: string) => model
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

export function buildMetadataFiles(imageUris: readonly string[], isMainnetTest = false) {
  if (imageUris.length !== 18 || imageUris.some(uri => !/^https:\/\//.test(uri))) {
    throw new Error('NFT_IMAGE_URIS must contain 18 comma-separated HTTPS URLs: collection, 16 class/variant images, then trainee');
  }
  const collectionName = isMainnetTest ? 'TAXI Taxi Park Mainnet Test' : 'TAXI Taxi Park';
  const symbol = isMainnetTest ? 'TAXITEST' : 'TAXI';
  const collectionDescription = isMainnetTest
    ? 'Disposable TAXI Taxi Park mainnet validation collection. Not the production collection. No fixed APY.'
    : 'The official TAXI Taxi Park collection on Solana. Rewards depend on actual protocol fees. No fixed APY.';
  let imageIndex = 1;
  return [
    {
      file: 'collection.json',
      data: { name: collectionName, symbol, description: collectionDescription, image: imageUris[0] },
    },
    ...NFT_CLASSES.flatMap(item => item.models.map((model, variant) => ({
      file: `${item.slug}-${variant}-${modelSlug(model)}.json`,
      data: {
        symbol,
        description: isMainnetTest
          ? `A ${model} ${item.className} taxi from the disposable TAXI Taxi Park mainnet validation collection. Not a production NFT. No fixed APY.`
          : `A ${model} ${item.className} taxi from TAXI Taxi Park. Rewards depend on actual protocol fees. No fixed APY.`,
        image: imageUris[imageIndex++],
        attributes: [
          { trait_type: 'Class', value: item.className },
          { trait_type: 'Model', value: model },
          { trait_type: 'Weight', value: item.weight },
          { trait_type: 'Max Supply', value: item.supply },
        ],
      },
    }))),
    {
      file: 'trainee.json',
      data: {
        name: 'TAXI Trainee — Dacia Logan',
        symbol,
        description: 'A temporary, non-transferable trainee taxi. It cannot be repaired and earns only during its activation period. No fixed APY.',
        image: imageUris[17],
        attributes: [
          { trait_type: 'Type', value: 'Trainee' },
          { trait_type: 'Model', value: 'Dacia Logan' },
          { trait_type: 'Weight', value: 1 },
          { trait_type: 'Transferable', value: 'No' },
          { trait_type: 'Repairable', value: 'No' },
        ],
      },
    },
  ];
}

export async function writeMetadataFiles(outputDirectory: string, files: ReturnType<typeof buildMetadataFiles>) {
  await mkdir(outputDirectory, { recursive: true });
  for (const item of files) {
    await writeFile(resolve(outputDirectory, item.file), `${JSON.stringify(item.data, null, 2)}\n`, 'utf8');
  }
}

async function main() {
  const outputDirectory = resolve(process.env.NFT_METADATA_OUTPUT_DIR || '.qa/nft-metadata');
  const imageUris = (process.env.NFT_IMAGE_URIS || '').split(',').map(value => value.trim());
  const files = buildMetadataFiles(imageUris, process.env.NFT_METADATA_MODE === 'mainnet-test');
  await writeMetadataFiles(outputDirectory, files);
  console.log(`Prepared ${files.length} metadata files in ${outputDirectory}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
