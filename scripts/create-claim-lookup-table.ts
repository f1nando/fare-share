import { address, createKeyPairSignerFromBytes } from '@solana/kit';
import {
  getCreateLookupTableInstructionAsync,
  getExtendLookupTableInstruction,
} from '@solana-program/address-lookup-table';

import {
  base64Bytes,
  claimLookupTableAddresses,
  decodeConfiguration,
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
const recentSlot = await solanaRpcCall<bigint>(rpcUrl, 'getSlot', [{ commitment: 'finalized' }]);
const createInstruction = await getCreateLookupTableInstructionAsync({
  authority: authority.address,
  payer: authority,
  recentSlot,
});
const lookupTable = createInstruction.accounts[0].address;
const createSignature = await sendInstructions(rpcUrl, authority, [createInstruction]);

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
const extendInstruction = getExtendLookupTableInstruction({
  address: lookupTable,
  authority,
  payer: authority,
  addresses: lookupAddresses,
});
const extendSignature = await sendInstructions(rpcUrl, authority, [extendInstruction]);

console.log(JSON.stringify({
  lookupTable: String(lookupTable),
  addressCount: lookupAddresses.length,
  createSignature: String(createSignature),
  extendSignature: String(extendSignature),
}, null, 2));
