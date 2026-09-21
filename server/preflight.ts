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

export async function validateDeploymentEnvironment(env: NodeJS.ProcessEnv): Promise<PreflightResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const value = (name: string) => env[name]?.trim() || '';
  const required = (name: string) => {
    const result = value(name);
    if (!result) errors.push(`${name}: значение обязательно`);
    return result;
  };
  const validAddress = (name: string, raw = required(name)) => {
    if (!raw) return '';
    try {
      address(raw);
      return raw;
    } catch {
      errors.push(`${name}: некорректный Solana-адрес`);
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
      errors.push(`${name}: нужен URL с протоколом ${protocols.join(' или ')}`);
      return '';
    }
  };
  const tuple = (name: string) => {
    const raw = required(name);
    if (!raw) return [];
    const parts = raw.split(',').map(part => part.trim());
    if (parts.length !== 4 || parts.some(part => !part)) {
      errors.push(`${name}: нужно ровно четыре значения через запятую`);
      return [];
    }
    return parts;
  };

  validUrl('MONGODB_URI', ['mongodb:', 'mongodb+srv:']);
  validUrl('SOLANA_RPC_URL', ['http:', 'https:']);
  validUrl('VITE_SOLANA_RPC_URL', ['http:', 'https:']);
  validUrl('VITE_SOLANA_DAS_URL', ['http:', 'https:']);
  validUrl('VITE_BACKEND_URL', ['http:', 'https:']);
  validUrl('ALLOWED_ORIGIN', ['http:', 'https:']);
  const frontendChain = required('VITE_SOLANA_CHAIN');
  if (frontendChain && frontendChain !== 'solana:devnet' && frontendChain !== 'solana:mainnet') {
    errors.push('VITE_SOLANA_CHAIN: допустимы только solana:devnet или solana:mainnet');
  }

  const programId = validAddress('TAXI_PROGRAM_ID');
  const frontendProgramId = validAddress('VITE_TAXI_PROGRAM_ID');
  validAddress('TEAM_ACCOUNT');
  validAddress('JUPITER_PROGRAM_ID');
  const fareMint = validAddress('FARE_MINT');
  if (programId && frontendProgramId && programId !== frontendProgramId) {
    errors.push('VITE_TAXI_PROGRAM_ID: должен совпадать с TAXI_PROGRAM_ID');
  }

  const stockMints = tuple('STOCK_MINTS');
  stockMints.forEach((mint, index) => validAddress(`STOCK_MINTS[${index}]`, mint));
  if (stockMints.length === 4 && stockMints.some((mint, index) => mint !== OFFICIAL_XSTOCK_MINTS[index])) {
    errors.push('STOCK_MINTS: ожидается порядок UBERx,TSLAx,GOOGLx,AMZNx с зафиксированными официальными mint');
  }
  if (fareMint && new Set([fareMint, ...stockMints]).size !== stockMints.length + 1) {
    errors.push('FARE_MINT и STOCK_MINTS должны быть разными адресами');
  }

  const prices = tuple('MINT_PRICES_LAMPORTS');
  for (const [index, price] of prices.entries()) {
    if (!/^\d+$/.test(price) || BigInt(price) <= 0n) {
      errors.push(`MINT_PRICES_LAMPORTS[${index}]: нужна положительная целая сумма lamports`);
    }
  }

  const deploymentId = required('DEPLOYMENT_ID_HEX');
  if (deploymentId && (!/^[0-9a-fA-F]{64}$/.test(deploymentId) || /^0+$/.test(deploymentId))) {
    errors.push('DEPLOYMENT_ID_HEX: нужны 32 случайных ненулевых байта в hex');
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
        : `${name}: приватная и публичная части keypair не совпадают`);
    }
  }
  if (secrets.length === secretNames.length && new Set(secrets).size !== secrets.length) {
    errors.push('ADMIN, BACKEND_SIGNER и WORKER должны использовать разные keypair');
  }

  const pepper = required('TRAINEE_WORD_PEPPER');
  if (pepper && (pepper === 'replace-with-a-long-random-secret' || pepper.length < 32)) {
    errors.push('TRAINEE_WORD_PEPPER: нужен случайный секрет длиной не менее 32 символов');
  }
  required('JUPITER_API_KEY');

  const collectionName = required('COLLECTION_NAME');
  if (collectionName.length > 64) errors.push('COLLECTION_NAME: максимум 64 символа');
  validateMetadataUri('COLLECTION_URI', required('COLLECTION_URI'), errors);
  const metadataUris = tuple('MACHINE_METADATA_URIS');
  metadataUris.forEach((uri, index) => validateMetadataUri(`MACHINE_METADATA_URIS[${index}]`, uri, errors));
  if (metadataUris.length === 4 && new Set(metadataUris).size !== 4) {
    warnings.push('MACHINE_METADATA_URIS: несколько классов используют одинаковый URI');
  }

  if (value('SOLANA_RPC_URL') !== value('VITE_SOLANA_RPC_URL')) {
    warnings.push('SOLANA_RPC_URL и VITE_SOLANA_RPC_URL различаются; убедитесь, что это одна сеть');
  }
  if (value('VITE_SOLANA_DAS_URL') && value('VITE_SOLANA_DAS_URL') === value('VITE_SOLANA_RPC_URL')) {
    warnings.push('VITE_SOLANA_DAS_URL совпадает с обычным RPC; endpoint обязан поддерживать getAssetsByOwner');
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
    errors.push(`${name}: нужен постоянный ar:// или https:// URI`);
  }
}
