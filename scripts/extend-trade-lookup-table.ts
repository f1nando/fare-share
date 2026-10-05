import { address, createKeyPairSignerFromBytes } from '@solana/kit';
import { getExtendLookupTableInstruction } from '@solana-program/address-lookup-table';
// @ts-expect-error The browser protocol client is intentionally plain JavaScript.
import { base64Bytes, decodeAddressLookupTable } from '../src/protocol/anchorClient.js';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  derivePumpBondingCurve,
  derivePumpFeeSharingConfig,
  PUMP_AMM_PROGRAM,
  PUMP_FEE_PROGRAM,
  PUMP_PROGRAM,
  TOKEN_PROGRAM,
  WSOL_MINT,
} from '../server/pump.js';
import { parseSecretBytes } from '../server/signing.js';
import { solanaRpcCall } from '../server/solanaRpc.js';
import { sendInstructions } from '../server/transaction.js';

const JUPITER_PROGRAM = address('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const COMPUTE_BUDGET_PROGRAM = address('ComputeBudget111111111111111111111111111111');
const TOKEN_2022_PROGRAM = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const mintArgument = process.argv[2]?.trim();
if (!mintArgument) throw new Error('Usage: npm run protocol:extend-trade-lookup -- <current-token-mint>');

const rpcUrl = required('SOLANA_RPC_URL');
const lookupTable = address(required('VITE_TAXI_LOOKUP_TABLE'));
const mint = address(mintArgument);
const authority = await createKeyPairSignerFromBytes(parseSecretBytes(
  required('ADMIN_KEYPAIR_SECRET_KEY'),
  'ADMIN_KEYPAIR_SECRET_KEY',
));
const lookupAccount = await solanaRpcCall<{ value: { data: [string, string] } | null }>(
  rpcUrl,
  'getAccountInfo',
  [lookupTable, { commitment: 'finalized', encoding: 'base64' }],
);
if (!lookupAccount.value) throw new Error(`Lookup table ${lookupTable} does not exist.`);

const existingAddresses = decodeAddressLookupTable(base64Bytes(lookupAccount.value.data[0]));
const desiredAddresses = [
  COMPUTE_BUDGET_PROGRAM,
  JUPITER_PROGRAM,
  PUMP_PROGRAM,
  PUMP_AMM_PROGRAM,
  PUMP_FEE_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  WSOL_MINT,
  mint,
  await derivePumpBondingCurve(mint),
  await derivePumpFeeSharingConfig(mint),
];
const existing = new Set(existingAddresses.map(String));
const missingAddresses = desiredAddresses.filter(value => !existing.has(String(value)));
const extendSignature = missingAddresses.length > 0
  ? String(await sendInstructions(rpcUrl, authority, [getExtendLookupTableInstruction({
      address: lookupTable,
      authority,
      payer: authority,
      addresses: missingAddresses,
    })]))
  : null;

console.log(JSON.stringify({
  lookupTable: String(lookupTable),
  mint: String(mint),
  addressCount: existingAddresses.length + missingAddresses.length,
  addedAddresses: missingAddresses.map(String),
  extendSignature,
}, null, 2));
