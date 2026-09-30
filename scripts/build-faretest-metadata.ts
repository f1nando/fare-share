import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function buildFaretestMetadata(image: string) {
  if (!/^https:\/\//.test(image)) throw new Error('FARETEST_IMAGE_URI must be an HTTPS URL.');
  return {
    name: 'Fare Share Rehearsal',
    symbol: 'FARETEST',
    description: 'Disposable Fare Share token for the public Solana Mainnet rehearsal. Not the production FARE token.',
    image,
  };
}

async function main() {
  const output = resolve(process.env.FARETEST_METADATA_OUTPUT || '.qa/faretest-metadata.json');
  const metadata = buildFaretestMetadata(process.env.FARETEST_IMAGE_URI?.trim() || '');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  console.log(`Prepared FARETEST metadata at ${output}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
