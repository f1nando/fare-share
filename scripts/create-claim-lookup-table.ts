import { address, createKeyPairSignerFromBytes, type Address } from '@solana/kit';
import {
  getCreateLookupTableInstructionAsync,
  getExtendLookupTableInstruction,
} from '@solana-program/address-lookup-table';

import {
  base64Bytes,
  claimLookupTableAddresses,
  decodeConfiguration,
  decodeAddressLookupTable,
// @ts-expect-error The browser protocol client is intentionally plain JavaScript.
} from '../src/protocol/anchorClient.js';
import { parseSecretBytes } from '../server/signing.js';
import { protocolAddresses } from '../server/setup.js';
import { solanaRpcCall } from '../server/solanaRpc.js';
import { sendInstructions } from '../server/transaction.js';

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const rpcUrl = required('SOLANA_RPC_URL');
const programAddress = address(required('TAXI_PROGRAM_ID'));
const authority = await createKeyPairSignerFromBytes(parseSecretBytes(
  required('ADMIN_KEYPAIR_SECRET_KEY'),
  'ADMIN_KEYPAIR_SECRET_KEY',
));
const addresses = await protocolAddresses(programAddress);
const configuredLookupTable = process.env.VITE_TAXI_LOOKUP_TABLE?.trim();
let lookupTable: Address;
let createSignature: string | null = null;
let existingAddresses: Address[] = [];
if (configuredLookupTable) {
  lookupTable = address(configuredLookupTable);
  existingAddresses = decodeAddressLookupTable(await accountBytes(lookupTable));
} else {
  const finalizedSlot = await solanaRpcCall<number | bigint>(rpcUrl, 'getSlot', [{ commitment: 'finalized' }]);
  // Public RPC load balancers can route getSlot and simulation to nodes a few slots apart.
  const recentSlot = BigInt(finalizedSlot) - 32n;
  const createInstruction = await getCreateLookupTableInstructionAsync({
    authority: authority.address,
    payer: authority,
    recentSlot,
  });
  lookupTable = createInstruction.accounts[0].address;
  createSignature = String(await sendInstructions(rpcUrl, authority, [createInstruction]));
}

const configAccount = await solanaRpcCall<{
  value: { data: [string, string] } | null;
}>(rpcUrl, 'getAccountInfo', [addresses.config, { commitment: 'finalized', encoding: 'base64' }]);
if (!configAccount.value) throw new Error(`Configuration account ${addresses.config} does not exist.`);
const config = decodeConfiguration(base64Bytes(configAccount.value.data[0]));
const mints = [config.fareMint, ...config.stockMints];
const mintAccounts = await solanaRpcCall<{
  value: Array<{ owner: string } | null>;
}>(rpcUrl, 'getMultipleAccounts', [mints, { commitment: 'finalized', encoding: 'base64' }]);
if (mintAccounts.value.some(value => !value)) throw new Error('One or more reward mints do not exist.');
const tokenPrograms = mintAccounts.value.map(value => address(value!.owner));
const lookupAddresses = await claimLookupTableAddresses({
  programAddress,
  configAddress: addresses.config,
  pool: addresses.pool,
  mints,
  tokenPrograms,
});
const existing = new Set(existingAddresses.map(String));
const missingAddresses = (lookupAddresses as Address[]).filter((value: Address) => !existing.has(String(value)));
const extendSignature = missingAddresses.length > 0 ? String(await sendInstructions(rpcUrl, authority, [getExtendLookupTableInstruction({
  address: lookupTable,
  authority,
  payer: authority,
  addresses: missingAddresses,
})])) : null;

console.log(JSON.stringify({
  lookupTable: String(lookupTable),
  addressCount: existingAddresses.length + missingAddresses.length,
  addedAddressCount: missingAddresses.length,
  createSignature,
  extendSignature,
}, null, 2));

async function accountBytes(account: Address) {
  const response = await solanaRpcCall<{ value: { data: [string, string] } | null }>(rpcUrl, 'getAccountInfo', [account, { commitment: 'finalized', encoding: 'base64' }]);
  if (!response.value) throw new Error(`Lookup table ${account} does not exist`);
  return base64Bytes(response.value.data[0]);
}
