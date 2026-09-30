import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { MAINNET_GENESIS_HASH, validateRehearsalManifest } from '../server/rehearsalManifest.js';

const UPGRADEABLE_LOADER = address('BPFLoaderUpgradeab1e11111111111111111111111');
const PROGRAMDATA_METADATA_BYTES = 45;

export interface DeployOptions {
  manifestPath: string;
  programSo: string;
  programKeypair: string;
  upgradeAuthorityKeypair: string;
  feePayerKeypair: string;
  recipientKeypair: string;
  bufferKeypair: string;
  bufferAddress: string;
  backupMarker: string;
  rpcUrl: string;
}

export interface CommandResult { status: number; stdout: string; stderr: string }
export type CommandRunner = (command: string, args: string[]) => CommandResult;

interface CompleteManifest {
  releaseSha: string;
  sbf: { sha256: string; sizeBytes: number };
  addresses: {
    programId: string;
    programData: string;
    buffer: string;
    feePayer: string;
    upgradeAuthority: string;
    recoveryRecipient: string;
  };
  limits: {
    recoverableRentLamports: string;
    uploadBufferRentLamports: string;
    programTombstoneLamports: string;
    estimatedPeakFundingLamports: string;
    spentNonRecoverableLamports?: string;
  };
}

export interface DeployPreflight {
  manifest: CompleteManifest;
  bufferAddress: string;
  bufferRentLamports: bigint;
  programDataRentLamports: bigint;
  confirmation: string;
}

export const systemRunner: CommandRunner = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

export async function runDisposablePreflight(options: DeployOptions, run: CommandRunner = systemRunner): Promise<DeployPreflight> {
  for (const [name, path] of Object.entries({
    'SBF binary': options.programSo,
    'program keypair': options.programKeypair,
    'upgrade authority keypair': options.upgradeAuthorityKeypair,
    'fee payer keypair': options.feePayerKeypair,
    'recipient keypair': options.recipientKeypair,
    'persistent buffer keypair': options.bufferKeypair,
    'key backup marker': options.backupMarker,
  })) requireFile(name, path);

  const parsed = JSON.parse(await readFile(options.manifestPath, 'utf8')) as unknown;
  const validation = validateRehearsalManifest(parsed, 'complete');
  if (!validation.deploymentAuthorized) throw new Error(`Complete rehearsal manifest rejected:\n${validation.errors.join('\n')}`);
  const manifest = parsed as CompleteManifest;
  if (options.bufferAddress !== manifest.addresses.buffer) {
    throw new Error(`Buffer mismatch: manifest ${manifest.addresses.buffer}, option ${options.bufferAddress}`);
  }

  const expectedKeys: Array<[string, string, string]> = [
    ['program', options.programKeypair, manifest.addresses.programId],
    ['upgrade authority', options.upgradeAuthorityKeypair, manifest.addresses.upgradeAuthority],
    ['fee payer', options.feePayerKeypair, manifest.addresses.feePayer],
    ['recipient', options.recipientKeypair, manifest.addresses.recoveryRecipient],
    ['persistent buffer', options.bufferKeypair, manifest.addresses.buffer],
  ];
  for (const [name, path, expected] of expectedKeys) {
    const actual = checked(run, 'solana-keygen', ['pubkey', path], `${name} public key`).trim();
    if (actual !== expected) throw new Error(`${name} key mismatch: expected ${expected}, got ${actual}`);
  }

  const marker = JSON.parse(await readFile(options.backupMarker, 'utf8')) as Record<string, unknown>;
  const markerExpected = {
    programId: manifest.addresses.programId,
    upgradeAuthority: manifest.addresses.upgradeAuthority,
    buffer: manifest.addresses.buffer,
  };
  for (const [name, expected] of Object.entries(markerExpected)) {
    if (marker[name] !== expected) throw new Error(`Backup marker ${name} mismatch`);
  }
  if (marker.backupVerified !== true || typeof marker.verifiedAt !== 'string' || !marker.verifiedAt) {
    throw new Error('Backup marker must contain backupVerified=true and a non-empty verifiedAt value');
  }

  const genesis = checked(run, 'solana', ['genesis-hash', '--url', options.rpcUrl], 'mainnet genesis').trim();
  if (genesis !== MAINNET_GENESIS_HASH) throw new Error(`RPC is not mainnet-beta: ${genesis}`);

  const encoder = getAddressEncoder();
  const [derivedProgramData] = await getProgramDerivedAddress({
    programAddress: UPGRADEABLE_LOADER,
    seeds: [encoder.encode(address(manifest.addresses.programId))],
  });
  if (String(derivedProgramData) !== manifest.addresses.programData) {
    throw new Error(`ProgramData mismatch: derived ${derivedProgramData}, manifest has ${manifest.addresses.programData}`);
  }

  const binary = readFileSync(options.programSo);
  const size = statSync(options.programSo).size;
  const hash = createHash('sha256').update(binary).digest('hex');
  if (size !== manifest.sbf.sizeBytes) throw new Error(`SBF size mismatch: expected ${manifest.sbf.sizeBytes}, got ${size}`);
  if (hash !== manifest.sbf.sha256) throw new Error(`SBF SHA-256 mismatch: expected ${manifest.sbf.sha256}, got ${hash}`);

  const bufferRent = rent(run, size + PROGRAMDATA_METADATA_BYTES, options.rpcUrl);
  const programDataRent = rent(run, size + PROGRAMDATA_METADATA_BYTES, options.rpcUrl);
  const expectedProgramDataRent = BigInt(manifest.limits.recoverableRentLamports);
  const expectedBufferRent = BigInt(manifest.limits.uploadBufferRentLamports);
  if (programDataRent !== expectedProgramDataRent) {
    throw new Error(`ProgramData rent mismatch: manifest ${expectedProgramDataRent}, current ${programDataRent}`);
  }
  if (bufferRent !== expectedBufferRent) {
    throw new Error(`Buffer rent mismatch: manifest ${expectedBufferRent}, current ${bufferRent}`);
  }
  const spentNonRecoverable = BigInt(manifest.limits.spentNonRecoverableLamports || '0');
  if (spentNonRecoverable < 0n || spentNonRecoverable > 800_000_000n) {
    throw new Error('Finalized non-recoverable rehearsal spend must stay within the 0.8 SOL absolute cap');
  }
  const remainingFundingReserve = 900_000_000n - spentNonRecoverable;
  const expectedPeak = bufferRent + programDataRent
    + BigInt(manifest.limits.programTombstoneLamports) + remainingFundingReserve;
  if (BigInt(manifest.limits.estimatedPeakFundingLamports) !== expectedPeak) {
    throw new Error(`Peak funding mismatch: expected ${expectedPeak}`);
  }
  const existingProgram = run('solana', ['program', 'show', manifest.addresses.programId, '--url', options.rpcUrl]);
  if (existingProgram.status === 0) throw new Error(`Program ${manifest.addresses.programId} already exists; refusing an upgrade`);
  const existingBuffer = run('solana', ['program', 'show', options.bufferAddress, '--url', options.rpcUrl]);
  let fundedBufferRent = 0n;
  if (existingBuffer.status === 0) {
    if (!existingBuffer.stdout.includes(`Authority: ${manifest.addresses.upgradeAuthority}`)) {
      throw new Error('Existing persistent buffer authority mismatch');
    }
    const balance = checked(run, 'solana', ['balance', options.bufferAddress, '--lamports', '--url', options.rpcUrl], 'persistent buffer balance');
    fundedBufferRent = BigInt(balance.trim().match(/^([0-9]+)/)?.[1] || '0');
    if (fundedBufferRent !== bufferRent) throw new Error(`Existing persistent buffer balance ${fundedBufferRent} does not equal expected rent ${bufferRent}`);
  }
  const payerBalanceOutput = checked(run, 'solana', ['balance', manifest.addresses.feePayer, '--lamports', '--url', options.rpcUrl], 'fee payer balance');
  const payerBalance = BigInt(payerBalanceOutput.trim().match(/^([0-9]+)/)?.[1] || '0');
  const requiredLiquidBalance = expectedPeak - fundedBufferRent;
  if (payerBalance < requiredLiquidBalance) throw new Error(`Fee payer balance ${payerBalance} is below required liquid balance ${requiredLiquidBalance}`);

  return {
    manifest,
    bufferAddress: options.bufferAddress,
    bufferRentLamports: bufferRent,
    programDataRentLamports: programDataRent,
    confirmation: `DEPLOY-DISPOSABLE-MAINNET:${manifest.releaseSha}:${manifest.addresses.programId}`,
  };
}

export async function executeDisposableDeploy(
  options: DeployOptions,
  confirmation: string,
  run: CommandRunner = systemRunner,
): Promise<void> {
  const preflight = await runDisposablePreflight(options, run);
  if (confirmation !== preflight.confirmation) throw new Error(`Exact confirmation required: ${preflight.confirmation}`);
  if (process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) {
    throw new Error('Deployment execution is disabled in test environments');
  }

  checked(run, 'solana', [
    'program', 'deploy', options.programSo,
    '--url', options.rpcUrl,
    '--program-id', options.programKeypair,
    '--keypair', options.feePayerKeypair,
    '--fee-payer', options.feePayerKeypair,
    '--upgrade-authority', options.upgradeAuthorityKeypair,
    '--buffer', options.bufferKeypair,
    '--max-len', String(preflight.manifest.sbf.sizeBytes),
    '--commitment', 'finalized', '--use-rpc',
  ], 'disposable deployment');

  const shown = checked(run, 'solana', [
    'program', 'show', preflight.manifest.addresses.programId,
    '--url', options.rpcUrl, '--keypair', options.feePayerKeypair, '--commitment', 'finalized',
  ], 'deployed program verification');
  if (!shown.includes(`ProgramData Address: ${preflight.manifest.addresses.programData}`)) throw new Error('Deployed ProgramData mismatch');
  if (!shown.includes(`Authority: ${preflight.manifest.addresses.upgradeAuthority}`)) throw new Error('Deployed upgrade authority mismatch');

  const directory = await mkdtemp(join(tmpdir(), 'disposable-rehearsal-'));
  const dump = join(directory, 'program.so');
  try {
    checked(run, 'solana', ['program', 'dump', preflight.manifest.addresses.programId, dump, '--url', options.rpcUrl], 'deployed SBF dump');
    const bytes = readFileSync(dump);
    if (bytes.length !== preflight.manifest.sbf.sizeBytes
      || createHash('sha256').update(bytes).digest('hex') !== preflight.manifest.sbf.sha256) {
      throw new Error('Deployed SBF does not match the frozen manifest');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  const buffer = run('solana', ['program', 'show', options.bufferAddress, '--url', options.rpcUrl]);
  if (buffer.status === 0) {
    checked(run, 'solana', [
      'program', 'close', options.bufferAddress, '--url', options.rpcUrl,
      '--keypair', options.feePayerKeypair, '--authority', options.upgradeAuthorityKeypair,
      '--recipient', preflight.manifest.addresses.recoveryRecipient, '--commitment', 'finalized',
    ], 'persistent buffer recovery');
  }
}

function requireFile(name: string, path: string) {
  if (!path || !existsSync(path) || !statSync(path).isFile()) throw new Error(`Missing ${name}: ${path || '<not provided>'}`);
}

function checked(run: CommandRunner, command: string, args: string[], operation: string): string {
  const result = run(command, args);
  if (result.status !== 0) throw new Error(`${operation} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  return result.stdout;
}

function rent(run: CommandRunner, bytes: number, rpcUrl: string): bigint {
  const output = checked(run, 'solana', ['rent', String(bytes), '--lamports', '--url', rpcUrl], `rent calculation for ${bytes} bytes`);
  const match = output.match(/([0-9]+)\s+lamports/i) ?? output.trim().match(/^([0-9]+)$/);
  if (!match) throw new Error(`Could not parse rent output: ${output.trim()}`);
  return BigInt(match[1]);
}

function parseArgs(args: string[]): { mode: 'preflight' | 'execute'; options: DeployOptions; confirmation?: string } {
  if (args.includes('--final')) throw new Error('--final is prohibited');
  const mode = args[0];
  if (mode !== 'preflight' && mode !== 'execute') throw new Error('First argument must be preflight or execute');
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid or incomplete argument: ${key ?? '<missing>'}`);
    values.set(key, value);
  }
  const required = (name: string) => {
    const value = values.get(name);
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const options: DeployOptions = {
    manifestPath: required('--manifest'), programSo: required('--program-so'),
    programKeypair: required('--program-keypair'), upgradeAuthorityKeypair: required('--upgrade-authority-keypair'),
    feePayerKeypair: required('--fee-payer-keypair'), recipientKeypair: required('--recipient-keypair'),
    bufferKeypair: required('--buffer-keypair'), bufferAddress: required('--buffer-address'),
    backupMarker: required('--backup-marker'), rpcUrl: required('--rpc-url'),
  };
  return { mode, options, confirmation: values.get('--confirm') };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.mode === 'execute') {
    await executeDisposableDeploy(parsed.options, parsed.confirmation ?? '');
    console.log('DISPOSABLE_REHEARSAL_DEPLOY=PASS');
    return;
  }
  if (parsed.confirmation) throw new Error('--confirm is only valid in execute mode');
  const result = await runDisposablePreflight(parsed.options);
  console.log('DISPOSABLE_REHEARSAL_PREFLIGHT=PASS');
  console.log(`PROGRAM_ID=${result.manifest.addresses.programId}`);
  console.log(`PROGRAMDATA_ADDRESS=${result.manifest.addresses.programData}`);
  console.log(`BUFFER_ADDRESS=${result.bufferAddress}`);
  console.log(`BUFFER_RENT_LAMPORTS=${result.bufferRentLamports}`);
  console.log(`PROGRAMDATA_RENT_LAMPORTS=${result.programDataRentLamports}`);
  console.log(`EXECUTE_CONFIRMATION=${result.confirmation}`);
}

if (process.argv[1] && pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
