import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { address } from '@solana/kit';

const ADDRESS_PATTERN = '[1-9A-HJ-NP-Za-km-z]+';

export function replaceProgramIdSources(anchorText: string, rustText: string, rawProgramId: string) {
  const programId = String(address(rawProgramId));
  const anchorPattern = new RegExp(`(taxi_park\\s*=\\s*")(${ADDRESS_PATTERN})(")`, 'g');
  const rustPattern = new RegExp(`(declare_id!\\(")(${ADDRESS_PATTERN})("\\);)`, 'g');
  const anchorMatches = [...anchorText.matchAll(anchorPattern)];
  const rustMatches = [...rustText.matchAll(rustPattern)];
  if (anchorMatches.length !== 1 || rustMatches.length !== 1) {
    throw new Error('Expected exactly one taxi_park Anchor entry and one Rust declare_id.');
  }
  if (anchorMatches[0][2] !== rustMatches[0][2]) {
    throw new Error('Existing Anchor and Rust Program IDs do not match.');
  }
  return {
    previousProgramId: anchorMatches[0][2],
    programId,
    anchorText: anchorText.replace(anchorPattern, (_match, prefix: string, _old: string, suffix: string) => `${prefix}${programId}${suffix}`),
    rustText: rustText.replace(rustPattern, (_match, prefix: string, _old: string, suffix: string) => `${prefix}${programId}${suffix}`),
  };
}

async function main() {
  const index = process.argv.indexOf('--program-id');
  const rawProgramId = index >= 0 ? process.argv[index + 1] : undefined;
  if (!rawProgramId) throw new Error('--program-id is required.');
  const anchorPath = resolve('Anchor.toml');
  const rustPath = resolve('programs/taxi_park/src/lib.rs');
  const result = replaceProgramIdSources(
    await readFile(anchorPath, 'utf8'),
    await readFile(rustPath, 'utf8'),
    rawProgramId,
  );
  await writeFile(anchorPath, result.anchorText, 'utf8');
  await writeFile(rustPath, result.rustText, 'utf8');
  console.log(`Program ID sources updated: ${result.previousProgramId} -> ${result.programId}`);
  console.log(`TAXI_PROGRAM_ID=${result.programId}`);
  console.log(`VITE_TAXI_PROGRAM_ID=${result.programId}`);
  console.log('Rebuild SBF and run protocol:preflight before any deployment.');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
