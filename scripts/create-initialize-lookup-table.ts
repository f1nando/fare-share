import { address, createKeyPairSignerFromBytes, type Address } from '@solana/kit';
import { getCreateLookupTableInstructionAsync, getExtendLookupTableInstruction } from '@solana-program/address-lookup-table';
import { parseSecretBytes } from '../server/signing.js';
import { protocolAddresses } from '../server/setup.js';
import { solanaRpcCall } from '../server/solanaRpc.js';
import { sendInstructions } from '../server/transaction.js';
// @ts-expect-error The browser protocol client is intentionally plain JavaScript.
import { base64Bytes, decodeAddressLookupTable } from '../src/protocol/anchorClient.js';

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const rpcUrl = required('SOLANA_RPC_URL');
const programId = address(required('TAXI_PROGRAM_ID'));
const authority = await createKeyPairSignerFromBytes(parseSecretBytes(required('ADMIN_KEYPAIR_SECRET_KEY'), 'ADMIN_KEYPAIR_SECRET_KEY'));
const addresses = await protocolAddresses(programId);
const configuredLookupTable = process.env.VITE_TAXI_LOOKUP_TABLE?.trim();
let lookupTable: Address;
let createSignature: string | null = null;
if (configuredLookupTable) {
  lookupTable = address(configuredLookupTable);
} else {
  const finalizedSlot = await solanaRpcCall<number | bigint>(rpcUrl, 'getSlot', [{ commitment: 'finalized' }]);
  // Public RPC load balancers can route getSlot and simulation to nodes a few slots apart.
  const recentSlot = BigInt(finalizedSlot) - 32n;
  const createInstruction = await getCreateLookupTableInstructionAsync({ authority: authority.address, payer: authority, recentSlot });
  lookupTable = createInstruction.accounts[0].address;
  createSignature = String(await sendInstructions(rpcUrl, authority, [createInstruction]));
}
const lookupAddresses = [
  programId,
  addresses.config,
  addresses.pool,
  addresses.traineePool,
  addresses.queue,
  addresses.traineeQueue,
  addresses.feeVault,
  address('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'),
  address('11111111111111111111111111111111'),
];
const existing = new Set((await waitForLookupTable(lookupTable)).map(String));
const missingAddresses = lookupAddresses.filter(value => !existing.has(String(value)));
const extendSignature = missingAddresses.length > 0 ? String(await sendInstructions(rpcUrl, authority, [getExtendLookupTableInstruction({
  address: lookupTable,
  authority,
  payer: authority,
  addresses: missingAddresses,
})])) : null;
console.log(JSON.stringify({ lookupTable: String(lookupTable), addressCount: existing.size + missingAddresses.length, addedAddressCount: missingAddresses.length, createSignature, extendSignature }, null, 2));

async function waitForLookupTable(table: Address) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const response = await solanaRpcCall<{ value: { data: [string, string] } | null }>(rpcUrl, 'getAccountInfo', [table, { commitment: 'finalized', encoding: 'base64' }]);
    if (response.value) return decodeAddressLookupTable(base64Bytes(response.value.data[0]));
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(`Lookup table ${table} was not visible at finalized commitment after creation.`);
}
