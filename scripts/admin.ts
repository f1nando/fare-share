import { address, createKeyPairSignerFromBytes } from '@solana/kit';
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction } from '@solana-program/token';
import {
  buildRescueSolInstruction,
  buildRescueTokenInstruction,
  buildSimpleAdminInstruction,
  type SimpleAdminCommand,
} from '../server/admin.js';
import { parseSecretBytes } from '../server/signing.js';
import { protocolAddresses } from '../server/setup.js';
import { sendInstructions } from '../server/transaction.js';
import { solanaRpcCall } from '../server/solanaRpc.js';

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const programId = address(process.env.TAXI_PROGRAM_ID || '9ZLAzKr2taQMXPZjkAFDNfWHrtrCTspR7sXV1E2F6eVv');
const admin = await createKeyPairSignerFromBytes(parseSecretBytes(required('ADMIN_KEYPAIR_SECRET_KEY'), 'ADMIN_KEYPAIR_SECRET_KEY'));
const addresses = await protocolAddresses(programId);
const [commandName, ...args] = process.argv.slice(2);
if (!commandName) usage();

let instructions;
if (commandName === 'rescue-sol') {
  exactArgs(args, 2);
  instructions = [buildRescueSolInstruction(
    programId, admin.address, addresses.config, addresses.feeVault, address(args[0]), positiveBigInt(args[1]),
  )];
} else if (commandName === 'rescue-token') {
  exactArgs(args, 3);
  const mint = address(args[0]);
  const recipient = address(args[1]);
  const amount = positiveBigInt(args[2]);
  const tokenProgram = await mintOwner(rpcUrl, mint);
  const [vault] = await findAssociatedTokenPda({ owner: addresses.config, mint, tokenProgram });
  const [destination] = await findAssociatedTokenPda({ owner: recipient, mint, tokenProgram });
  instructions = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: admin,
      ata: destination,
      owner: recipient,
      mint,
      tokenProgram,
    }),
    buildRescueTokenInstruction({
      programId,
      admin: admin.address,
      config: addresses.config,
      mint,
      vault,
      destination,
      tokenProgram,
      amount,
    }),
  ];
} else {
  const command = parseSimpleCommand(commandName, args);
  instructions = [buildSimpleAdminInstruction(programId, admin.address, addresses.config, command)];
}

const signature = await sendInstructions(rpcUrl, admin, instructions);
console.log(`${commandName} finalized: ${signature}`);

function parseSimpleCommand(name: string, values: string[]): SimpleAdminCommand {
  if (name === 'start-sale' || name === 'pause' || name === 'unpause' || name === 'accept-admin') {
    exactArgs(values, 0);
    return { name };
  }
  if (name === 'set-mint-prices') {
    exactArgs(values, 1);
    const prices = values[0].split(',').map(positiveBigInt);
    if (prices.length !== 4) throw new Error('set-mint-prices expects four comma-separated lamport values');
    return { name, prices: prices as [bigint, bigint, bigint, bigint] };
  }
  if (name === 'propose-admin' || name === 'set-team' || name === 'set-backend-signer' || name === 'set-jupiter') {
    exactArgs(values, 1);
    return { name, value: address(values[0]) };
  }
  usage();
}

function positiveBigInt(value: string) {
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new Error('Amount must be a positive integer');
  return parsed;
}

function exactArgs(values: string[], count: number) {
  if (values.length !== count) throw new Error(`Expected ${count} argument(s), received ${values.length}`);
}

function usage(): never {
  throw new Error([
    'Usage: npm run protocol:admin -- <command> [arguments]',
    'Commands: start-sale | pause | unpause | set-mint-prices <a,b,c,d>',
    'propose-admin <pubkey> | accept-admin | set-team <pubkey>',
    'set-backend-signer <pubkey> | set-jupiter <program>',
    'rescue-sol <recipient> <lamports> | rescue-token <mint> <recipient-wallet> <raw-amount>',
  ].join('\n'));
}

async function mintOwner(url: string, mint: ReturnType<typeof address>) {
  const result = await solanaRpcCall<{ value?: { owner?: string } | null }>(url, 'getAccountInfo', [
    mint,
    { commitment: 'finalized', encoding: 'base64' },
  ], { timeoutMs: 10_000 });
  if (!result.value?.owner) throw new Error(`Mint ${mint} does not exist`);
  return address(result.value.owner);
}
