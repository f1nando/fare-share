import { address } from '@solana/kit';
import { OFFICIAL_XSTOCK_MINTS, REHEARSAL_DATABASE, REHEARSAL_SHARED_ROLE_ADDRESS } from './preflight.js';

export const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export type RehearsalValidationMode = 'preparation' | 'complete';

export interface RehearsalManifestValidationResult {
  errors: string[];
  warnings: string[];
  deploymentAuthorized: boolean;
}

type JsonRecord = Record<string, unknown>;

export function validateRehearsalManifest(
  input: unknown,
  requestedMode: RehearsalValidationMode,
): RehearsalManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const root = record(input, 'manifest', errors);
  const manifestMode = text(root.validationMode, 'validationMode', errors, requestedMode === 'preparation');
  if (manifestMode && manifestMode !== requestedMode) {
    errors.push(`validationMode: manifest is ${manifestMode}, but validator was run in ${requestedMode} mode`);
  }
  if (manifestMode && manifestMode !== 'preparation' && manifestMode !== 'complete') {
    errors.push('validationMode: must be preparation or complete');
  }

  const allowIncomplete = requestedMode === 'preparation';
  const releaseSha = text(root.releaseSha, 'releaseSha', errors, allowIncomplete);
  validateHex(releaseSha, 'releaseSha', 40, errors, allowIncomplete);

  const sbf = record(root.sbf, 'sbf', errors);
  validateHex(text(sbf.sha256, 'sbf.sha256', errors, allowIncomplete), 'sbf.sha256', 64, errors, allowIncomplete);
  positiveInteger(sbf.sizeBytes, 'sbf.sizeBytes', errors, allowIncomplete);

  const cluster = record(root.cluster, 'cluster', errors);
  exact(cluster.chain, 'cluster.chain', 'solana:mainnet', errors);
  exact(cluster.genesisHash, 'cluster.genesisHash', MAINNET_GENESIS_HASH, errors);

  exact(root.database, 'database', REHEARSAL_DATABASE, errors);
  exact(root.workerInitiallyEnabled, 'workerInitiallyEnabled', false, errors);
  const prices = array(root.mintPricesUsdCents, 'mintPricesUsdCents', errors);
  if (prices.length !== 4 || prices.some(price => price !== 2500)) {
    errors.push('mintPricesUsdCents: must contain exactly four $25 prices (2500 cents)');
  }

  const addresses = record(root.addresses, 'addresses', errors);
  const disposableAddressNames = ['programId', 'programData', 'buffer', 'collection', 'fareMint', 'replacementFareMint'] as const;
  for (const name of disposableAddressNames) {
    validateAddress(addresses[name], `addresses.${name}`, errors, allowIncomplete);
  }
  const sharedAddressNames = [
    'sharedRole', 'feePayer', 'upgradeAuthority', 'admin', 'backendSigner', 'worker',
    'team', 'pumpCreatorFeeRecipient', 'recoveryRecipient',
  ] as const;
  for (const name of sharedAddressNames) {
    exact(addresses[name], `addresses.${name}`, REHEARSAL_SHARED_ROLE_ADDRESS, errors);
  }
  exact(addresses.jupiterProgramId, 'addresses.jupiterProgramId', 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', errors);
  const stockMints = array(addresses.stockMints, 'addresses.stockMints', errors);
  if (stockMints.length !== OFFICIAL_XSTOCK_MINTS.length
    || stockMints.some((mint, index) => mint !== OFFICIAL_XSTOCK_MINTS[index])) {
    errors.push('addresses.stockMints: must contain the four official xStocks mints in UBERx,TSLAx,GOOGLx,AMZNx order');
  }

  validateHex(text(root.assignmentRootHex, 'assignmentRootHex', errors, allowIncomplete), 'assignmentRootHex', 24, errors, allowIncomplete, true);

  const metadata = record(root.metadata, 'metadata', errors);
  validateUri(metadata.collectionUri, 'metadata.collectionUri', errors, allowIncomplete);
  const machineUris = array(metadata.machineUris, 'metadata.machineUris', errors);
  if (!allowIncomplete || machineUris.length > 0) {
    if (machineUris.length !== 16) errors.push('metadata.machineUris: exactly 16 URIs are required');
    machineUris.forEach((uri, index) => validateUri(uri, `metadata.machineUris[${index}]`, errors, allowIncomplete));
    const completeUris = machineUris.filter(uri => typeof uri === 'string' && !placeholder(uri));
    if (completeUris.length === 16 && new Set(completeUris).size !== 16) errors.push('metadata.machineUris: URIs must be distinct');
  }
  validateUri(metadata.traineeUri, 'metadata.traineeUri', errors, allowIncomplete);

  const limits = record(root.limits, 'limits', errors);
  exact(limits.automaticStopSol, 'limits.automaticStopSol', 0.7, errors);
  exact(limits.irreversibleMaximumSol, 'limits.irreversibleMaximumSol', 0.8, errors);
  const rent = text(limits.recoverableRentLamports, 'limits.recoverableRentLamports', errors, allowIncomplete);
  if (!incomplete(rent, allowIncomplete) && (!/^\d+$/.test(rent) || BigInt(rent) <= 0n)) {
    errors.push('limits.recoverableRentLamports: must be a positive lamport string');
  }

  if (requestedMode === 'complete') {
    findPlaceholders(input, 'manifest', errors);
  } else {
    warnings.push('Preparation mode is incomplete and cannot authorize deployment.');
  }

  return {
    errors,
    warnings,
    deploymentAuthorized: requestedMode === 'complete' && errors.length === 0,
  };
}

function record(value: unknown, name: string, errors: string[]): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${name}: object is required`);
    return {};
  }
  return value as JsonRecord;
}

function array(value: unknown, name: string, errors: string[]): unknown[] {
  if (!Array.isArray(value)) {
    errors.push(`${name}: array is required`);
    return [];
  }
  return value;
}

function text(value: unknown, name: string, errors: string[], allowIncomplete = false): string {
  if (typeof value !== 'string' || (!value.trim() && !allowIncomplete)) {
    errors.push(`${name}: string is required`);
    return '';
  }
  return typeof value === 'string' ? value.trim() : '';
}

function exact(value: unknown, name: string, expected: unknown, errors: string[]) {
  if (value !== expected) errors.push(`${name}: must equal ${String(expected)}`);
}

function placeholder(value: unknown): boolean {
  return typeof value === 'string' && (/^<[^>]+>$/.test(value.trim()) || /^REPLACE_[A-Z0-9_]+$/.test(value.trim()));
}

function incomplete(value: unknown, allowIncomplete: boolean): boolean {
  return allowIncomplete && (value === '' || value === 0 || value === '0' || placeholder(value));
}

function validateHex(value: string, name: string, length: number, errors: string[], allowIncomplete: boolean, nonZero = false) {
  if (incomplete(value, allowIncomplete)) return;
  if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(value) || (nonZero && /^0+$/.test(value))) {
    errors.push(`${name}: must be ${length} hexadecimal characters${nonZero ? ' and non-zero' : ''}`);
  }
}

function positiveInteger(value: unknown, name: string, errors: string[], allowIncomplete: boolean) {
  if (incomplete(value, allowIncomplete)) return;
  if (!Number.isSafeInteger(value) || Number(value) <= 0) errors.push(`${name}: must be a positive integer`);
}

function validateAddress(value: unknown, name: string, errors: string[], allowIncomplete: boolean) {
  if (incomplete(value, allowIncomplete)) return;
  if (typeof value !== 'string') {
    errors.push(`${name}: Solana address is required`);
    return;
  }
  try {
    address(value);
  } catch {
    errors.push(`${name}: invalid Solana address`);
  }
}

function validateUri(value: unknown, name: string, errors: string[], allowIncomplete: boolean) {
  if (incomplete(value, allowIncomplete)) return;
  if (typeof value !== 'string') {
    errors.push(`${name}: URI is required`);
    return;
  }
  if (value.startsWith('ar://')) return;
  try {
    if (new URL(value).protocol !== 'https:') throw new Error('protocol');
  } catch {
    errors.push(`${name}: must use a permanent ar:// or https:// URI`);
  }
}

function findPlaceholders(value: unknown, path: string, errors: string[]) {
  if (placeholder(value) || value === '') {
    errors.push(`${path}: complete mode rejects placeholders or empty values`);
    return;
  }
  if (Array.isArray(value)) value.forEach((item, index) => findPlaceholders(item, `${path}[${index}]`, errors));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) findPlaceholders(item, `${path}.${key}`, errors);
  }
}
