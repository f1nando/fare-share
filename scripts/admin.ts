import { address, createKeyPairSignerFromBytes, type KeyPairSigner } from '@solana/kit';
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction } from '@solana-program/token';
import {
  buildRescueSolInstruction,
  buildRescueTokenInstruction,
  buildSetFareMintInstruction,
  buildSimpleAdminInstruction,
  type SimpleAdminCommand,
} from '../server/admin.js';
import { parseSecretBytes } from '../server/signing.js';
import { protocolAddresses } from '../server/setup.js';
import { sendInstructions } from '../server/transaction.js';
import { solanaRpcCall } from '../server/solanaRpc.js';
import { derivePumpBondingCurve, derivePumpFeeSharingConfig } from '../server/pump.js';

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const programId = address(process.env.TAXI_PROGRAM_ID || 'GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4');
const admin = await createKeyPairSignerFromBytes(parseSecretBytes(required('ADMIN_KEYPAIR_SECRET_KEY'), 'ADMIN_KEYPAIR_SECRET_KEY'));
const addresses = await protocolAddresses(programId);
const [commandName, ...args] = process.argv.slice(2);
if (!commandName) usage();

let instructions;
let additionalSigners: KeyPairSigner[] = [];
if (commandName === 'set-fare-mint') {
  exactArgs(args, 1);
  const fareMint = address(args[0]);
  const tokenProgram = await mintOwner(rpcUrl, fareMint);
  const feeRecipient = await createKeyPairSignerFromBytes(parseSecretBytes(
    required('PUMP_FEE_RECIPIENT_SECRET_KEY'), 'PUMP_FEE_RECIPIENT_SECRET_KEY',
  ));
  const bondingCurve = await derivePumpBondingCurve(fareMint);
  const feeSharingConfig = await derivePumpFeeSharingConfig(fareMint);
  const [fareVault] = await findAssociatedTokenPda({ owner: addresses.config, mint: fareMint, tokenProgram });
  instructions = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: admin,
      ata: fareVault,
      owner: addresses.config,
      mint: fareMint,
      tokenProgram,
    }),
    buildSetFareMintInstruction({
      programId,
      admin: admin.address,
      feeRecipient: feeRecipient.address,
      config: addresses.config,
      fareMint,
      fareVault,
      bondingCurve,
      feeSharingConfig,
      tokenProgram,
    }),
  ];
  if (String(feeRecipient.address) !== String(admin.address)) additionalSigners = [feeRecipient];
} else if (commandName === 'rescue-sol') {
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

const signature = await sendInstructions(rpcUrl, admin, instructions, additionalSigners);
console.log(`${commandName} finalized: ${signature}`);

function parseSimpleCommand(name: string, values: string[]): SimpleAdminCommand {
  if (name === 'start-sale' || name === 'pause' || name === 'unpause' || name === 'accept-admin') {
    exactArgs(values, 0);
    return { name };
  }
  if (name === 'set-mint-prices') {
    exactArgs(values, 1);
    const prices = values[0].split(',').map(positiveBigInt);
    if (prices.length !== 4) throw new Error('set-mint-prices expects four comma-separated USD cent values');
    if (!prices.every(price => price === 2_500n)) throw new Error('Every mint price must equal 2500 USD cents ($25)');
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
    'set-fare-mint <mint> (replaceable before start-sale; atomically creates the protocol FARE vault)',
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
