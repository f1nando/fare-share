import { createHash } from 'node:crypto';
import { access, constants, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { address } from '@solana/kit';
import { validateRehearsalManifest } from '../server/rehearsalManifest.js';

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const LOADER_V3 = 'BPFLoaderUpgradeab1e11111111111111111111111';
const MAX_CLOSE_FEE_LAMPORTS = 1_000_000n;
const ACK_SERVICES = 'I CONFIRM ALL TRANSACTION-SENDING SERVICES ARE STOPPED';
const ACK_PAUSED = 'I CONFIRM THE PROTOCOL IS PAUSED ON CHAIN';

export interface CommandResult { code: number; stdout: string; stderr: string }
export type CommandRunner = (command: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<CommandResult>;

interface RecoveryOptions {
  manifest: string;
  manifestSha256: string;
  rpcUrl: string;
  programId: string;
  programData: string;
  authority: string;
  feePayer: string;
  buffer: string;
  recipient: string;
  worker: string;
  backend: string;
  authorityKeypair: string;
  feePayerKeypair: string;
  bufferKeypair: string;
  workerKeypair: string;
  backendKeypair: string;
  servicesStopped: string;
  protocolPaused: string;
  maxFeeLamports: bigint;
  execute: boolean;
  confirm?: string;
  solanaBin: string;
}

export async function runRecovery(options: RecoveryOptions, run: CommandRunner = runCommand) {
  rejectUnsafeValues(options);
  const bytes = await readFile(options.manifest);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== options.manifestSha256.toLowerCase()) throw new Error(`Frozen manifest SHA-256 mismatch: got ${digest}`);
  const manifest = JSON.parse(bytes.toString('utf8')) as Record<string, any>;
  const validation = validateRehearsalManifest(manifest, 'complete');
  if (!validation.deploymentAuthorized) throw new Error(`Complete rehearsal manifest is invalid: ${validation.errors.join('; ')}`);
  const expected = manifest.addresses as Record<string, string>;
  exact('mainnet genesis', manifest.cluster.genesisHash, MAINNET_GENESIS);
  exact('Program ID', options.programId, expected.programId);
  exact('ProgramData', options.programData, expected.programData);
  exact('authority', options.authority, expected.upgradeAuthority);
  exact('fee payer', options.feePayer, expected.feePayer);
  exact('buffer', options.buffer, expected.buffer);
  exact('recovery recipient', options.recipient, expected.recoveryRecipient);
  exact('worker', options.worker, expected.worker);
  exact('backend', options.backend, expected.backendSigner);
  const expectedRent = BigInt(String(manifest.limits.recoverableRentLamports));
  for (const path of [options.authorityKeypair, options.feePayerKeypair, options.bufferKeypair, options.workerKeypair, options.backendKeypair]) {
    await access(path, constants.R_OK);
  }

  const common = ['--url', options.rpcUrl, '--commitment', 'finalized'];
  await successful(run, options.solanaBin, ['genesis-hash', '--url', options.rpcUrl], MAINNET_GENESIS);
  await signer(run, options, options.authorityKeypair, options.authority);
  await signer(run, options, options.feePayerKeypair, options.feePayer);
  await signer(run, options, options.bufferKeypair, options.buffer);
  await signer(run, options, options.workerKeypair, options.worker);
  await signer(run, options, options.backendKeypair, options.backend);
  const beforeBalance = parseLamports((await successful(run, options.solanaBin, ['balance', options.recipient, '--lamports', ...common])).stdout);

  const auditEnv = {
    ...process.env,
    SOLANA_RPC_URL: options.rpcUrl,
    RECOVERY_PROGRAM_ID: options.programId,
    RECOVERY_PROGRAMDATA_ADDRESS: options.programData,
    RECOVERY_AUTHORITY_ADDRESS: options.authority,
    RECOVERY_FEE_PAYER_ADDRESS: options.feePayer,
    RECOVERY_RECIPIENT_ADDRESS: options.recipient,
    RECOVERY_BUFFER_ADDRESS: options.buffer,
    RECOVERY_WORKER_ADDRESS: options.worker,
    RECOVERY_BACKEND_ADDRESS: options.backend,
    RECOVERY_AUTHORITY_KEYPAIR_PATH: options.authorityKeypair,
    RECOVERY_FEE_PAYER_KEYPAIR_PATH: options.feePayerKeypair,
    RECOVERY_BUFFER_KEYPAIR_PATH: options.bufferKeypair,
    RECOVERY_WORKER_KEYPAIR_PATH: options.workerKeypair,
    RECOVERY_BACKEND_KEYPAIR_PATH: options.backendKeypair,
  };
  const auditArgs = ['--import', 'tsx', 'scripts/audit-mainnet-recovery.ts', '--require-paused', '--require-empty-vaults'];

  if (!options.execute) {
    const audit = await successful(run, process.execPath, auditArgs, 'MAINNET_RECOVERY_DRY_RUN=PASS', auditEnv);
    exactAudit(audit.stdout, options, expectedRent);
    console.log('MAINNET_PROGRAMDATA_CLOSE_DRY_RUN=PASS');
    console.log(`EXECUTE_CONFIRMATION=${confirmation(options, expectedRent)}`);
    return;
  }

  exact('services-stopped acknowledgement', options.servicesStopped, ACK_SERVICES);
  exact('paused acknowledgement', options.protocolPaused, ACK_PAUSED);
  exact('execute confirmation', options.confirm, confirmation(options, expectedRent));

  // This strengthened audit is deliberately the final command before the irreversible close.
  const audit = await successful(run, process.execPath, auditArgs, 'MAINNET_RECOVERY_DRY_RUN=PASS', auditEnv);
  exactAudit(audit.stdout, options, expectedRent);
  const close = await successful(run, options.solanaBin, [
    'program', 'close', options.programId,
    '--recipient', options.recipient,
    '--authority', options.authorityKeypair,
    '--fee-payer', options.feePayerKeypair,
    '--bypass-warning',
    ...common,
  ]);

  const missingProgramData = await run(options.solanaBin, ['account', options.programData, '--output', 'json', ...common]);
  if (missingProgramData.code === 0 || !/not found|does not exist|could not find/i.test(`${missingProgramData.stdout}\n${missingProgramData.stderr}`)) {
    throw new Error('Finalized ProgramData disappearance was not proven');
  }
  const tombstoneOutput = JSON.parse((await successful(run, options.solanaBin, ['account', options.programId, '--output', 'json', ...common])).stdout);
  const tombstone = tombstoneOutput.account ?? tombstoneOutput;
  if (tombstone.owner !== LOADER_V3 || tombstone.executable !== false || BigInt(tombstone.lamports) <= 0n) {
    throw new Error('Program tombstone did not persist as a non-executable loader-v3 account');
  }
  await successful(run, options.solanaBin, ['program', 'show', options.programId, ...common], `Program ${options.programId} has been closed`);
  const afterBalance = parseLamports((await successful(run, options.solanaBin, ['balance', options.recipient, '--lamports', ...common])).stdout);
  const delta = afterBalance - beforeBalance;
  if (delta > expectedRent || delta < expectedRent - options.maxFeeLamports) {
    throw new Error(`Recipient delta ${delta} is outside [${expectedRent - options.maxFeeLamports}, ${expectedRent}] lamports`);
  }
  console.log(`CLOSE_OUTPUT=${close.stdout.trim()}`);
  console.log(`RECIPIENT_DELTA_LAMPORTS=${delta}`);
  console.log('MAINNET_PROGRAMDATA_CLOSE=FINALIZED_VERIFIED');
}

function exactAudit(stdout: string, options: RecoveryOptions, expectedRent: bigint) {
  const fields = new Map(stdout.split(/\r?\n/).filter(line => line.includes('=')).map(line => {
    const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
  }));
  exact('audit Program ID', fields.get('PROGRAM_ID'), options.programId);
  exact('audit ProgramData', fields.get('PROGRAMDATA_ADDRESS'), options.programData);
  exact('audit authority', fields.get('UPGRADE_AUTHORITY'), options.authority);
  exact('audit recipient', fields.get('RECIPIENT'), options.recipient);
  exact('audit recoverable rent', decimalSolToLamports(fields.get('PROGRAMDATA_RECOVERABLE_SOL')), expectedRent);
  exact('audit result', fields.get('MAINNET_RECOVERY_DRY_RUN'), 'PASS');
}

function confirmation(options: RecoveryOptions, rent: bigint) {
  return `CLOSE MAINNET PROGRAM ${options.programId} PROGRAMDATA ${options.programData} TO ${options.recipient} RETURN ${rent} LAMPORTS FOREVER`;
}

function rejectUnsafeValues(options: RecoveryOptions) {
  for (const [name, value] of Object.entries(options)) {
    if (typeof value === 'string' && /(^|\s)--final(?:\s|$)/.test(value)) throw new Error(`--final is prohibited (${name})`);
  }
  for (const value of [options.programId, options.programData, options.authority, options.feePayer, options.buffer, options.recipient, options.worker, options.backend]) address(value);
  if (options.maxFeeLamports < 0n || options.maxFeeLamports > MAX_CLOSE_FEE_LAMPORTS) {
    throw new Error(`--max-fee-lamports must be between 0 and ${MAX_CLOSE_FEE_LAMPORTS}`);
  }
}

async function signer(run: CommandRunner, options: RecoveryOptions, path: string, expected: string) {
  await successful(run, options.solanaBin, ['address', '-k', path], expected);
}

async function successful(run: CommandRunner, command: string, args: string[], includes?: string, env?: NodeJS.ProcessEnv) {
  const result = await run(command, args, env);
  if (result.code !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr.trim()}`);
  if (includes && !result.stdout.includes(includes) && !result.stderr.includes(includes)) throw new Error(`Command output did not contain: ${includes}`);
  return result;
}

function parseLamports(output: string) {
  const match = output.trim().match(/^(\d+)/);
  if (!match) throw new Error(`Invalid lamport balance: ${output.trim()}`);
  return BigInt(match[1]);
}

function decimalSolToLamports(value?: string) {
  if (!value || !/^\d+\.\d{9}$/.test(value)) throw new Error(`Invalid audit SOL amount: ${value}`);
  const [whole, fraction] = value.split('.');
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction);
}

function exact(label: string, actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${String(expected)}, got ${String(actual)}`);
}

function runCommand(command: string, args: string[], env = process.env): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function parseArgs(argv: string[]): RecoveryOptions {
  if (argv.includes('--final')) throw new Error('--final is prohibited');
  const execute = argv.includes('--execute');
  const allowedFlags = new Set(['--execute']);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (allowedFlags.has(key)) continue;
    if (!key.startsWith('--') || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`Unknown or valueless argument: ${key}`);
    values.set(key, argv[++index]);
  }
  const get = (name: string) => { const value = values.get(`--${name}`)?.trim(); if (!value) throw new Error(`--${name} is required explicitly`); return value; };
  const optional = (name: string) => values.get(`--${name}`)?.trim();
  const known = new Set(['manifest','manifest-sha256','rpc-url','program-id','programdata','authority','fee-payer','buffer','recipient','worker','backend','authority-keypair','fee-payer-keypair','buffer-keypair','worker-keypair','backend-keypair','services-stopped','protocol-paused','max-fee-lamports','confirm','solana-bin'].map(value => `--${value}`));
  for (const key of values.keys()) if (!known.has(key)) throw new Error(`Unknown argument: ${key}`);
  return {
    manifest: get('manifest'), manifestSha256: get('manifest-sha256'), rpcUrl: get('rpc-url'),
    programId: get('program-id'), programData: get('programdata'), authority: get('authority'), feePayer: get('fee-payer'),
    buffer: get('buffer'), recipient: get('recipient'), worker: get('worker'), backend: get('backend'),
    authorityKeypair: get('authority-keypair'), feePayerKeypair: get('fee-payer-keypair'), bufferKeypair: get('buffer-keypair'),
    workerKeypair: get('worker-keypair'), backendKeypair: get('backend-keypair'), servicesStopped: get('services-stopped'),
    protocolPaused: get('protocol-paused'), maxFeeLamports: BigInt(get('max-fee-lamports')), execute, confirm: optional('confirm'),
    solanaBin: optional('solana-bin') || 'solana',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runRecovery(parseArgs(process.argv.slice(2)));
