import { address, createKeyPairSignerFromBytes, type Address } from '@solana/kit';
import { getAddressLookupTableDecoder, getExtendLookupTableInstruction } from '@solana-program/address-lookup-table';
import { findAssociatedTokenPda } from '@solana-program/token';
// @ts-expect-error The browser protocol client is intentionally plain JavaScript.
import { base64Bytes, decodeConfiguration, deriveEventPage, ED25519_PROGRAM, INSTRUCTIONS_SYSVAR, MPL_CORE_PROGRAM, SYSTEM_PROGRAM } from '../src/protocol/anchorClient.js';
import { parseSecretBytes } from '../server/signing.js';
import { solanaRpcCall } from '../server/solanaRpc.js';
import { protocolAddresses } from '../server/setup.js';
import { sendInstructions } from '../server/transaction.js';

const EVENT_PAGE_COUNT = 80;
const EXTEND_CHUNK_SIZE = 20;

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const rpcUrl = required('SOLANA_RPC_URL');
const programId = address(required('TAXI_PROGRAM_ID'));
const lookupTable = address(required('VITE_TAXI_LOOKUP_TABLE'));
const authority = await createKeyPairSignerFromBytes(parseSecretBytes(
  required('ADMIN_KEYPAIR_SECRET_KEY'),
  'ADMIN_KEYPAIR_SECRET_KEY',
));
const addresses = await protocolAddresses(programId);
const [lookupAccount, configAccount] = await Promise.all([
  getAccount(lookupTable),
  getAccount(addresses.config),
]);
const decodedLookup = getAddressLookupTableDecoder().decode(base64Bytes(lookupAccount.data[0]));
const lookupAuthority = decodedLookup.authority.__option === 'Some' ? String(decodedLookup.authority.value) : null;
if (lookupAuthority !== String(authority.address)) {
  throw new Error(`Lookup table authority is ${lookupAuthority || 'none'}, expected ${authority.address}.`);
}

const config = decodeConfiguration(base64Bytes(configAccount.data[0]));
const mintAccount = await getAccount(config.fareMint);
const fareTokenProgram = address(mintAccount.owner);
const [teamFareAccount] = await findAssociatedTokenPda({
  owner: config.teamAccount,
  mint: config.fareMint,
  tokenProgram: fareTokenProgram,
});
const eventPages = await Promise.all(Array.from(
  { length: EVENT_PAGE_COUNT },
  (_, pageIndex) => deriveEventPage(programId, pageIndex),
));
const desiredAddresses = uniqueAddresses([
  programId,
  addresses.config,
  addresses.queue,
  ...eventPages,
  config.collection,
  config.fareMint,
  teamFareAccount,
  fareTokenProgram,
  ED25519_PROGRAM,
  INSTRUCTIONS_SYSVAR,
  MPL_CORE_PROGRAM,
  SYSTEM_PROGRAM,
]);
const existing = new Set(decodedLookup.addresses.map(String));
const missingAddresses = desiredAddresses.filter(value => !existing.has(String(value)));
if (decodedLookup.addresses.length + missingAddresses.length > 256) {
  throw new Error('Mint lookup addresses exceed the 256-address table limit.');
}

const signatures: string[] = [];
for (let offset = 0; offset < missingAddresses.length; offset += EXTEND_CHUNK_SIZE) {
  const chunk = missingAddresses.slice(offset, offset + EXTEND_CHUNK_SIZE);
  signatures.push(String(await sendInstructions(rpcUrl, authority, [getExtendLookupTableInstruction({
    address: lookupTable,
    authority,
    payer: authority,
    addresses: chunk,
  })])));
}

const finalizedLookup = getAddressLookupTableDecoder().decode(base64Bytes((await getAccount(lookupTable)).data[0]));
const finalized = new Set(finalizedLookup.addresses.map(String));
const absent = desiredAddresses.filter(value => !finalized.has(String(value)));
if (absent.length) throw new Error(`Lookup table is missing ${absent.length} mint address(es) after extension.`);

console.log(JSON.stringify({
  lookupTable: String(lookupTable),
  authority: String(authority.address),
  addressCount: finalizedLookup.addresses.length,
  addedAddressCount: missingAddresses.length,
  signatures,
}, null, 2));

async function getAccount(value: Address) {
  const response = await solanaRpcCall<{ value: { owner: string; data: [string, string] } | null }>(
    rpcUrl,
    'getAccountInfo',
    [value, { commitment: 'finalized', encoding: 'base64' }],
  );
  if (!response.value) throw new Error(`Account ${value} does not exist.`);
  return response.value;
}

function uniqueAddresses(values: Address[]) {
  return [...new Map(values.map(value => [String(value), value])).values()];
}
