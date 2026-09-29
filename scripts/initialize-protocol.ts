import { address, createKeyPairSignerFromBytes } from '@solana/kit';
import { initializeProtocol } from '../server/setup.js';
import { parseSecretBytes } from '../server/signing.js';
import { solanaRpcCall } from '../server/solanaRpc.js';
// @ts-expect-error The browser protocol client is intentionally plain JavaScript.
import { base64Bytes, decodeAddressLookupTable } from '../src/protocol/anchorClient.js';

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const tuple = <T>(values: T[], name: string): [T, T, T, T] => {
  if (values.length !== 4) throw new Error(`${name} must contain exactly four comma-separated values`);
  return values as [T, T, T, T];
};
const metadataUris = (values: string[], name: string) => {
  if (values.length !== 16 || values.some(value => !value)) {
    throw new Error(`${name} must contain exactly 16 comma-separated values in class/variant order`);
  }
  return values;
};

const deploymentHex = required('DEPLOYMENT_ID_HEX');
if (!/^[0-9a-fA-F]{64}$/.test(deploymentHex)) throw new Error('DEPLOYMENT_ID_HEX must contain 64 hex characters');
const admin = await createKeyPairSignerFromBytes(parseSecretBytes(required('ADMIN_KEYPAIR_SECRET_KEY'), 'ADMIN_KEYPAIR_SECRET_KEY'));
const lookupTableAddress = process.env.VITE_TAXI_LOOKUP_TABLE?.trim();
const lookupTables = lookupTableAddress ? await loadLookupTable(lookupTableAddress) : {};
const result = await initializeProtocol({
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  programId: address(process.env.TAXI_PROGRAM_ID || 'GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4'),
  admin,
  backendSignerSecret: required('BACKEND_SIGNER_SECRET_KEY'),
  teamAccount: address(required('TEAM_ACCOUNT')),
  jupiterProgram: address(process.env.JUPITER_PROGRAM_ID || 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'),
  deploymentId: Uint8Array.from(Buffer.from(deploymentHex, 'hex')),
  collectionName: process.env.COLLECTION_NAME || 'FARE Taxi Park',
  collectionUri: required('COLLECTION_URI'),
  stockMints: tuple(required('STOCK_MINTS').split(',').map(value => address(value.trim())), 'STOCK_MINTS'),
  mintPrices: tuple((process.env.MINT_PRICES_LAMPORTS || '0,0,0,0').split(',').map(value => BigInt(value.trim())), 'MINT_PRICES_LAMPORTS'),
  metadataUris: metadataUris(required('MACHINE_METADATA_URIS').split(',').map(value => value.trim()), 'MACHINE_METADATA_URIS'),
  lookupTables,
});

console.log(JSON.stringify({
  ...result,
  addresses: Object.fromEntries(Object.entries(result.addresses).map(([key, value]) => [key, String(value)])),
  collection: result.collection && String(result.collection),
  vaults: result.vaults.map(String),
}, null, 2));

async function loadLookupTable(rawAddress: string) {
  const table = address(rawAddress);
  const result = await solanaRpcCall<{ value: { data: [string, string] } | null }>(required('SOLANA_RPC_URL'), 'getAccountInfo', [table, { commitment: 'finalized', encoding: 'base64' }]);
  if (!result.value) throw new Error(`Initialize lookup table ${table} does not exist`);
  return { [table]: decodeAddressLookupTable(base64Bytes(result.value.data[0])) };
}
