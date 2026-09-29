import { address, createKeyPairSignerFromBytes } from '@solana/kit';
import { parseSecretBytes } from './signing.js';

export const OFFICIAL_XSTOCK_MINTS = [
  'XsAsZLF4MmsvS1sDxRMrUz7REjHfwbC9UAMXSRBqgEB',
  'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
  'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN',
  'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg',
] as const;

export interface PreflightResult {
  errors: string[];
  warnings: string[];
}

export function validateProgramIdSources(programId: string, anchorToml: string, rustSource: string): string[] {
  const errors: string[] = [];
  const anchorId = anchorToml.match(/taxi_park\s*=\s*"([1-9A-HJ-NP-Za-km-z]+)"/)?.[1];
  const rustId = rustSource.match(/declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\)/)?.[1];
  if (!anchorId) errors.push('Anchor.toml: programs.*.taxi_park was not found');
  else if (anchorId !== programId) errors.push('Anchor.toml: taxi_park does not match TAXI_PROGRAM_ID');
  if (!rustId) errors.push('programs/taxi_park/src/lib.rs: declare_id! was not found');
  else if (rustId !== programId) errors.push('declare_id!: address does not match TAXI_PROGRAM_ID');
  return errors;
}

export async function validateDeploymentEnvironment(env: NodeJS.ProcessEnv): Promise<PreflightResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const value = (name: string) => env[name]?.trim() || '';
  const required = (name: string) => {
    const result = value(name);
    if (!result) errors.push(`${name}: value is required`);
    return result;
  };
  const validAddress = (name: string, raw = required(name)) => {
    if (!raw) return '';
    try {
      address(raw);
      return raw;
    } catch {
      errors.push(`${name}: invalid Solana address`);
      return '';
    }
  };
  const validUrl = (name: string, protocols: string[], raw = required(name)) => {
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (!protocols.includes(parsed.protocol)) throw new Error('protocol');
      return raw;
    } catch {
      errors.push(`${name}: URL must use ${protocols.join(' or ')}`);
      return '';
    }
  };
  const tuple = (name: string) => {
    const raw = required(name);
    if (!raw) return [];
    const parts = raw.split(',').map(part => part.trim());
    if (parts.length !== 4 || parts.some(part => !part)) {
      errors.push(`${name}: exactly four comma-separated values are required`);
      return [];
    }
    return parts;
  };
  const requestLimit = (name: string, maximum: number) => {
    const raw = required(name);
    const parsed = Number(raw);
    if (raw && (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum)) {
      errors.push(`${name}: must be an integer from 1 to ${maximum}`);
    }
  };

  validUrl('MONGODB_URI', ['mongodb:', 'mongodb+srv:']);
  validUrl('SOLANA_RPC_URL', ['http:', 'https:']);
  validUrl('VITE_SOLANA_RPC_URL', ['http:', 'https:']);
  validUrl('VITE_SOLANA_DAS_URL', ['http:', 'https:']);
  validUrl('VITE_BACKEND_URL', ['http:', 'https:']);
  validUrl('ALLOWED_ORIGIN', ['http:', 'https:']);
  requestLimit('JUPITER_REQUESTS_PER_SECOND', 10);
  requestLimit('SOLANA_RPC_MAX_REQUESTS_PER_SECOND', 50);
  requestLimit('SOLANA_SEND_TRANSACTION_MAX_REQUESTS_PER_SECOND', 5);
  requestLimit('SOLANA_DAS_MAX_REQUESTS_PER_SECOND', 10);
  requestLimit('VITE_SOLANA_RPC_MAX_REQUESTS_PER_SECOND', 50);
  requestLimit('VITE_SOLANA_SEND_TRANSACTION_MAX_REQUESTS_PER_SECOND', 5);
  requestLimit('VITE_SOLANA_DAS_MAX_REQUESTS_PER_SECOND', 10);
  const frontendChain = required('VITE_SOLANA_CHAIN');
  if (frontendChain && frontendChain !== 'solana:devnet' && frontendChain !== 'solana:mainnet') {
    errors.push('VITE_SOLANA_CHAIN: only solana:devnet or solana:mainnet is allowed');
  }
  const testMintSetting = value('DEVNET_ALLOW_TEST_MINTS');
  if (testMintSetting && testMintSetting !== 'true' && testMintSetting !== 'false') {
    errors.push('DEVNET_ALLOW_TEST_MINTS: only true or false is allowed');
  }
  const allowDevnetTestMints = testMintSetting === 'true' && frontendChain === 'solana:devnet';
  if (testMintSetting === 'true' && frontendChain !== 'solana:devnet') {
    errors.push('DEVNET_ALLOW_TEST_MINTS: allowed only for solana:devnet');
  }

  const programId = validAddress('TAXI_PROGRAM_ID');
  const frontendProgramId = validAddress('VITE_TAXI_PROGRAM_ID');
  validAddress('TEAM_ACCOUNT');
  validAddress('JUPITER_PROGRAM_ID');
  const rawFareMint = value('FARE_MINT');
  const fareMint = rawFareMint ? validAddress('FARE_MINT', rawFareMint) : '';
  if (!rawFareMint) {
    warnings.push('FARE_MINT: will be bound with a one-time admin instruction after token creation');
  }
  if (programId && frontendProgramId && programId !== frontendProgramId) {
    errors.push('VITE_TAXI_PROGRAM_ID: must match TAXI_PROGRAM_ID');
  }

  const stockMints = tuple('STOCK_MINTS');
  stockMints.forEach((mint, index) => validAddress(`STOCK_MINTS[${index}]`, mint));
  if (stockMints.length === 4 && stockMints.some((mint, index) => mint !== OFFICIAL_XSTOCK_MINTS[index])) {
    if (allowDevnetTestMints) {
      warnings.push('STOCK_MINTS: test Devnet mints are used instead of official xStocks');
    } else {
      errors.push('STOCK_MINTS: expected UBERx,TSLAx,GOOGLx,AMZNx order with the fixed official mints');
    }
  }
  if (fareMint && new Set([fareMint, ...stockMints]).size !== stockMints.length + 1) {
    errors.push('FARE_MINT and STOCK_MINTS must use different addresses');
  }

  const prices = tuple('MINT_PRICES_LAMPORTS');
  for (const [index, price] of prices.entries()) {
    if (!/^\d+$/.test(price) || BigInt(price) <= 0n) {
      errors.push(`MINT_PRICES_LAMPORTS[${index}]: must be a positive integer amount of lamports`);
    }
  }

  const deploymentId = required('DEPLOYMENT_ID_HEX');
  if (deploymentId && (!/^[0-9a-fA-F]{64}$/.test(deploymentId) || /^0+$/.test(deploymentId))) {
    errors.push('DEPLOYMENT_ID_HEX: must contain 32 random non-zero bytes in hex');
  }

  const secretNames = ['ADMIN_KEYPAIR_SECRET_KEY', 'BACKEND_SIGNER_SECRET_KEY', 'WORKER_KEYPAIR_SECRET_KEY'] as const;
  const secrets: string[] = [];
  for (const name of secretNames) {
    const raw = required(name);
    if (!raw) continue;
    try {
      const bytes = parseSecretBytes(raw, name);
      await createKeyPairSignerFromBytes(bytes);
      secrets.push(Buffer.from(bytes).toString('hex'));
    } catch (error) {
      const message = (error as Error).message;
      errors.push(message.startsWith(`${name} `)
        ? message
        : `${name}: private and public keypair parts do not match`);
    }
  }
  if (secrets.length === secretNames.length && new Set(secrets).size !== secrets.length) {
    errors.push('ADMIN, BACKEND_SIGNER, and WORKER must use different keypairs');
  }
  const feeRecipientSecret = required('PUMP_FEE_RECIPIENT_SECRET_KEY');
  if (feeRecipientSecret) {
    try {
      const signer = await createKeyPairSignerFromBytes(parseSecretBytes(feeRecipientSecret, 'PUMP_FEE_RECIPIENT_SECRET_KEY'));
      if (frontendChain === 'solana:mainnet' && String(signer.address) !== '2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF') {
        errors.push('PUMP_FEE_RECIPIENT_SECRET_KEY: must match the fixed 2NUN… mainnet wallet');
      }
    } catch (error) {
      errors.push(String((error as Error).message));
    }
  }
  required('ADMIN_USERNAME');
  const adminPassword = required('ADMIN_PASSWORD_SCRYPT');
  if (adminPassword && !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/i.test(adminPassword)) {
    errors.push('ADMIN_PASSWORD_SCRYPT: use npm run admin:hash-password');
  }
  const adminSessionSecret = required('ADMIN_SESSION_SECRET');
  if (adminSessionSecret && adminSessionSecret.length < 32) {
    errors.push('ADMIN_SESSION_SECRET: must be a random secret at least 32 characters long');
  }

  const pepper = required('TRAINEE_WORD_PEPPER');
  if (pepper && (pepper === 'replace-with-a-long-random-secret' || pepper.length < 32)) {
    errors.push('TRAINEE_WORD_PEPPER: must be a random secret at least 32 characters long');
  }
  if (!value('JUPITER_API_KEY') && allowDevnetTestMints) {
    warnings.push('JUPITER_API_KEY: not set; the Devnet swap worker will be disabled');
  } else {
    required('JUPITER_API_KEY');
  }

  const collectionName = required('COLLECTION_NAME');
  if (collectionName.length > 64) errors.push('COLLECTION_NAME: maximum length is 64 characters');
  validateMetadataUri('COLLECTION_URI', required('COLLECTION_URI'), errors);
  const metadataUris = tuple('MACHINE_METADATA_URIS');
  metadataUris.forEach((uri, index) => validateMetadataUri(`MACHINE_METADATA_URIS[${index}]`, uri, errors));
  if (metadataUris.length === 4 && new Set(metadataUris).size !== 4) {
    warnings.push('MACHINE_METADATA_URIS: multiple classes use the same URI');
  }

  if (value('SOLANA_RPC_URL') !== value('VITE_SOLANA_RPC_URL')) {
    warnings.push('SOLANA_RPC_URL and VITE_SOLANA_RPC_URL differ; make sure they use the same network');
  }
  if (value('VITE_SOLANA_DAS_URL') && value('VITE_SOLANA_DAS_URL') === value('VITE_SOLANA_RPC_URL')) {
    warnings.push('VITE_SOLANA_DAS_URL matches the regular RPC; the endpoint must support getAssetsByOwner');
  }

  return { errors, warnings };
}

function validateMetadataUri(name: string, raw: string, errors: string[]) {
  if (!raw) return;
  if (raw.startsWith('ar://')) return;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') throw new Error('protocol');
  } catch {
    errors.push(`${name}: must use a permanent ar:// or https:// URI`);
  }
}
