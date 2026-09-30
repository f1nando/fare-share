import { readFile, writeFile } from 'node:fs/promises';
import { address, createKeyPairSignerFromBytes, generateKeyPairSigner } from '@solana/kit';
import { findAssociatedTokenPda } from '@solana-program/token';

import {
  base64Bytes,
  buildClaimAllInstructions,
  buildMintMachine,
  buildRepairAllInstructions,
  chooseEventPage,
  decodeAddressLookupTable,
  decodeConfiguration,
  decodeEventQueue,
  decodeMachine,
// @ts-expect-error The browser protocol client is intentionally plain JavaScript.
} from '../src/protocol/anchorClient.js';
import { parseSecretBytes } from '../server/signing.js';
import { protocolAddresses } from '../server/setup.js';
import { solanaRpcCall } from '../server/solanaRpc.js';
import { sendInstructions } from '../server/transaction.js';

const STATE_PATH = '.env.devnet.claim-many-state.json';
type MachineView = { activeUntil: bigint; fareBase: bigint };
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const rpcUrl = required('SOLANA_RPC_URL');
const programAddress = address(required('TAXI_PROGRAM_ID'));
const lookupTable = address(required('VITE_TAXI_LOOKUP_TABLE'));
const owner = await createKeyPairSignerFromBytes(parseSecretBytes(
  required('ADMIN_KEYPAIR_SECRET_KEY'),
  'ADMIN_KEYPAIR_SECRET_KEY',
));
const addresses = await protocolAddresses(programAddress);
const mode = process.argv[2];

if (mode === 'mint') await mintFleet();
else if (mode === 'claim') await claimFleet();
else if (mode === 'claim-atomicity') await verifyClaimAtomicity();
else if (mode === 'repair') await repairFleet();
else throw new Error('Usage: devnet-claim-many-smoke.ts mint|claim|claim-atomicity|repair');

async function mintFleet() {
  const config = decodeConfiguration(await accountBytes(addresses.config));
  const fareMintAccount = (await getMultipleAccounts([config.fareMint]))[0];
  const fareTokenProgram = address(fareMintAccount!.owner);
  const backendUrl = required('VITE_BACKEND_URL').replace(/\/$/, '');
  const machines = [];
  for (let index = 0; index < 10; index += 1) {
    const queue = decodeEventQueue(await accountBytes(addresses.queue));
    const pageIndex = chooseEventPage(queue, 2);
    const assetSigner = await generateKeyPairSigner();
    const quoteResponse = await fetch(`${backendUrl}/api/mint/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: String(owner.address), asset: String(assetSigner.address) }),
    });
    const quote = await quoteResponse.json();
    if (!quoteResponse.ok) throw new Error(quote.error || 'Mint quote request failed.');
    const built = await buildMintMachine({
      programAddress,
      owner: owner.address,
      configAddress: addresses.config,
      config,
      queue: addresses.queue,
      pageIndex,
      fareTokenProgram,
      assetSigner,
      quote,
    });
    const signature = await sendInstructions(rpcUrl, owner, built.instructions, [built.assetSigner]);
    machines.push({ asset: String(built.assetSigner.address), machineAddress: String(built.machine) });
    console.log(`Mint ${index + 1}/10 finalized: ${signature}`);
  }
  await writeFile(STATE_PATH, JSON.stringify({ owner: String(owner.address), machines }, null, 2));
  console.log(`Saved ${machines.length} machines to ${STATE_PATH}`);
}

async function claimFleet() {
  const state = await loadFleet();
  const config = decodeConfiguration(await accountBytes(addresses.config));
  const mints = [config.fareMint, ...config.stockMints];
  const mintAccounts = await getMultipleAccounts(mints);
  const tokenPrograms = mintAccounts.map(account => address(account!.owner));
  const destinations = await Promise.all(mints.map((mint, index) => (
    findAssociatedTokenPda({ owner: owner.address, mint, tokenProgram: tokenPrograms[index] })
      .then(([destination]) => destination)
  )));
  const before = await tokenBalances(destinations);
  const destinationAccounts = await getMultipleAccounts(destinations, true);
  const instructions = await buildClaimAllInstructions({
    programAddress,
    owner: owner.address,
    configAddress: addresses.config,
    pool: addresses.pool,
    mints,
    tokenPrograms,
    destinationAccountsExist: destinationAccounts.map(Boolean),
    machines: state.machines.map(machine => ({
      machineAddress: address(machine.machineAddress),
      asset: address(machine.asset),
      rewards: Array(5).fill(1n),
    })),
  });
  const lookupAddresses = decodeAddressLookupTable(await accountBytes(lookupTable));
  const signature = await sendInstructions(rpcUrl, owner, instructions, [], {
    [lookupTable]: lookupAddresses,
  });
  const after = await tokenBalances(destinations);
  if (after.some((amount, index) => amount <= before[index])) {
    throw new Error(`Claim did not increase every reward balance: before=${before}, after=${after}`);
  }
  console.log(JSON.stringify({ signature, machineCount: state.machines.length, before, after }, (_, value) => (
    typeof value === 'bigint' ? value.toString() : value
  ), 2));
}

async function repairFleet() {
  const state = await loadFleet();
  const config = decodeConfiguration(await accountBytes(addresses.config));
  const fareMintAccount = (await getMultipleAccounts([config.fareMint]))[0]!;
  const fareTokenProgram = address(fareMintAccount.owner);
  const [ownerFareAccount] = await findAssociatedTokenPda({
    owner: owner.address,
    mint: config.fareMint,
    tokenProgram: fareTokenProgram,
  });
  const beforeBalance = (await tokenBalances([ownerFareAccount]))[0];
  const beforeMachineBytes = await Promise.all(state.machines.map(machine => (
    accountBytes(address(machine.machineAddress))
  )));
  const beforeMachines = beforeMachineBytes.map(bytes => decodeMachine(bytes) as MachineView);
  const costs = beforeMachines.map(machine => (machine.fareBase + 3n) / 4n);
  const signatures = [];
  for (let offset = 0; offset < state.machines.length; offset += 8) {
    const batch = state.machines.slice(offset, offset + 8);
    const queue = decodeEventQueue(await accountBytes(addresses.queue));
    const pageIndex = chooseEventPage(queue, batch.length);
    const instructions = await buildRepairAllInstructions({
      programAddress,
      owner: owner.address,
      configAddress: addresses.config,
      config,
      pool: addresses.pool,
      queue: addresses.queue,
      fareTokenProgram,
      pageIndex,
      machines: batch.map((machine, index) => ({
        machineAddress: address(machine.machineAddress),
        asset: address(machine.asset),
        repairCost: costs[offset + index],
      })),
    });
    signatures.push(await sendInstructions(rpcUrl, owner, instructions));
  }
  const afterBalance = (await tokenBalances([ownerFareAccount]))[0];
  const afterMachineBytes = await Promise.all(state.machines.map(machine => (
    accountBytes(address(machine.machineAddress))
  )));
  const afterMachines = afterMachineBytes.map(bytes => decodeMachine(bytes) as MachineView);
  if (afterMachines.some((machine, index) => machine.activeUntil <= beforeMachines[index].activeUntil)) {
    throw new Error('Repair did not extend every machine durability.');
  }
  const totalCost = costs.reduce((sum, cost) => sum + cost, 0n);
  if (beforeBalance - afterBalance !== totalCost) {
    throw new Error(`Repair burned ${beforeBalance - afterBalance}, expected ${totalCost}.`);
  }
  console.log(JSON.stringify({ signatures, batches: [8, 2], totalCost, beforeBalance, afterBalance }, (_, value) => (
    typeof value === 'bigint' ? value.toString() : value
  ), 2));
}

async function verifyClaimAtomicity() {
  const state = await loadFleet();
  const config = decodeConfiguration(await accountBytes(addresses.config));
  const mints = [config.fareMint, ...config.stockMints];
  const mintAccounts = await getMultipleAccounts(mints);
  const tokenPrograms = mintAccounts.map(account => address(account!.owner));
  const destinations = await Promise.all(mints.map((mint, index) => (
    findAssociatedTokenPda({ owner: owner.address, mint, tokenProgram: tokenPrograms[index] })
      .then(([destination]) => destination)
  )));
  const beforeBalances = await tokenBalances(destinations);
  const beforeMachines = await Promise.all(state.machines.map(machine => accountBytes(address(machine.machineAddress))));
  const invalidMachines = state.machines.map((machine, index) => ({
    machineAddress: address(machine.machineAddress),
    asset: address(index === state.machines.length - 1 ? state.machines[0].asset : machine.asset),
    rewards: Array(5).fill(1n),
  }));
  const instructions = await buildClaimAllInstructions({
    programAddress,
    owner: owner.address,
    configAddress: addresses.config,
    pool: addresses.pool,
    mints,
    tokenPrograms,
    destinationAccountsExist: Array(5).fill(true),
    machines: invalidMachines,
  });
  const lookupAddresses = decodeAddressLookupTable(await accountBytes(lookupTable));
  let rejected = false;
  try {
    await sendInstructions(rpcUrl, owner, instructions, [], { [lookupTable]: lookupAddresses });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('Invalid ten-machine claim unexpectedly succeeded.');
  const afterBalances = await tokenBalances(destinations);
  const afterMachines = await Promise.all(state.machines.map(machine => accountBytes(address(machine.machineAddress))));
  const unchangedMachines = beforeMachines.every((bytes, index) => Buffer.from(bytes).equals(Buffer.from(afterMachines[index])));
  const unchangedBalances = beforeBalances.every((amount, index) => amount === afterBalances[index]);
  if (!unchangedMachines || !unchangedBalances) throw new Error('Rejected claim changed onchain state.');
  console.log(JSON.stringify({ rejected: true, machineCount: 10, unchangedMachines, unchangedBalances }));
}

async function loadFleet() {
  const state = JSON.parse(await readFile(STATE_PATH, 'utf8')) as {
    owner: string;
    machines: Array<{ asset: string; machineAddress: string }>;
  };
  if (state.owner !== String(owner.address) || state.machines.length !== 10) {
    throw new Error('Smoke state must contain ten machines owned by the configured admin.');
  }
  return state;
}

async function accountBytes(account: ReturnType<typeof address>): Promise<Uint8Array> {
  const result = await solanaRpcCall<{ value: { data: [string, string] } | null }>(rpcUrl, 'getAccountInfo', [
    account,
    { commitment: 'finalized', encoding: 'base64' },
  ]);
  if (!result.value) throw new Error(`Required account ${account} does not exist.`);
  return base64Bytes(result.value.data[0]) as Uint8Array;
}

async function getMultipleAccounts(
  accounts: Array<ReturnType<typeof address>>,
  allowMissing = false,
): Promise<Array<{ owner: string } | null>> {
  const result = await solanaRpcCall<{ value: Array<{ owner: string } | null> }>(rpcUrl, 'getMultipleAccounts', [
    accounts,
    { commitment: 'finalized', encoding: 'base64' },
  ]);
  if (!allowMissing && result.value.some(value => !value)) throw new Error('One or more required accounts are missing.');
  return result.value;
}

async function tokenBalances(accounts: Array<ReturnType<typeof address>>): Promise<bigint[]> {
  return Promise.all(accounts.map(async account => {
    try {
      const result = await solanaRpcCall<{ value: { amount: string } }>(rpcUrl, 'getTokenAccountBalance', [
        account,
        { commitment: 'finalized' },
      ]);
      return BigInt(result.value.amount);
    } catch {
      return 0n;
    }
  }));
}
