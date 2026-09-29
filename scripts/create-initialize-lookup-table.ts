import { address, createKeyPairSignerFromBytes } from '@solana/kit';
import { getCreateLookupTableInstructionAsync, getExtendLookupTableInstruction } from '@solana-program/address-lookup-table';
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
const programId = address(required('TAXI_PROGRAM_ID'));
const authority = await createKeyPairSignerFromBytes(parseSecretBytes(required('ADMIN_KEYPAIR_SECRET_KEY'), 'ADMIN_KEYPAIR_SECRET_KEY'));
const addresses = await protocolAddresses(programId);
const recentSlot = await solanaRpcCall<bigint>(rpcUrl, 'getSlot', [{ commitment: 'finalized' }]);
const createInstruction = await getCreateLookupTableInstructionAsync({ authority: authority.address, payer: authority, recentSlot });
const lookupTable = createInstruction.accounts[0].address;
const createSignature = await sendInstructions(rpcUrl, authority, [createInstruction]);
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
const extendSignature = await sendInstructions(rpcUrl, authority, [getExtendLookupTableInstruction({
  address: lookupTable,
  authority,
  payer: authority,
  addresses: lookupAddresses,
})]);
console.log(JSON.stringify({ lookupTable: String(lookupTable), addressCount: lookupAddresses.length, createSignature: String(createSignature), extendSignature: String(extendSignature) }, null, 2));
