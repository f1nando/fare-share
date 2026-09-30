import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NFT_CLASSES } from './build-nft-metadata.js';

export interface RehearsalAssetSource {
  index: number | null;
  kind: 'collection' | 'machine' | 'trainee' | 'token';
  name: string;
  source: string;
  output: string;
  mime: string;
}

export function rehearsalAssetSources(root = process.cwd()): RehearsalAssetSource[] {
  let index = 1;
  const machines = NFT_CLASSES.flatMap(definition => definition.models.map(model => {
    const slug = modelSlug(model);
    return {
      index: index++,
      kind: 'machine' as const,
      name: model,
      source: resolve(root, 'original-assets', 'driving-scenes', `${slug}.webp`),
      output: `${String(index - 1).padStart(2, '0')}-${definition.slug}-${slug}.webp`,
      mime: 'image/webp',
    };
  }));
  return [
    { index: 0, kind: 'collection', name: 'Fare Share Taxi Rehearsal', source: resolve(root, 'public', 'brand', 'fare-driver.png'), output: '00-collection.png', mime: 'image/png' },
    ...machines,
    { index: 17, kind: 'trainee', name: 'Dacia Logan', source: resolve(root, 'public', 'nft', 'trainee-driving.webp'), output: '17-trainee-dacia-logan.webp', mime: 'image/webp' },
    { index: null, kind: 'token', name: 'FARETEST', source: resolve(root, 'public', 'rehearsal', 'faretest.svg'), output: 'faretest.svg', mime: 'image/svg+xml' },
  ];
}

export async function prepareRehearsalAssets(outputDirectory: string, root = process.cwd()) {
  await mkdir(outputDirectory, { recursive: true });
  const entries = [];
  for (const source of rehearsalAssetSources(root)) {
    const bytes = await readFile(source.source);
    validateMime(bytes, source.mime, source.source);
    await copyFile(source.source, resolve(outputDirectory, source.output));
    entries.push({
      index: source.index,
      kind: source.kind,
      name: source.name,
      file: source.output,
      mime: source.mime,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  const manifest = {
    purpose: 'disposable-mainnet-rehearsal',
    nftImageOrder: entries.filter(item => item.index !== null).map(item => item.file),
    assets: entries,
  };
  await writeFile(resolve(outputDirectory, 'assets-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function validateMime(bytes: Buffer, mime: string, source: string) {
  const valid = mime === 'image/png'
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === 'image/webp'
      ? bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
      : mime === 'image/svg+xml'
        ? /<svg[\s>]/i.test(bytes.toString('utf8', 0, Math.min(bytes.length, 1_024)))
        : false;
  if (!valid) throw new Error(`${basename(source)} does not match ${mime}`);
}

function modelSlug(model: string) {
  return model.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main() {
  const output = resolve(process.env.REHEARSAL_ASSET_OUTPUT_DIR || '.qa/rehearsal-assets');
  const manifest = await prepareRehearsalAssets(output);
  console.log(`Prepared ${manifest.assets.length} rehearsal assets in ${output}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
