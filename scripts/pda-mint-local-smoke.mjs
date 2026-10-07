// Only localhost transactions; devnet is read-only fixture input. Never accepts a remote write RPC.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { address, createKeyPairSignerFromBytes, getAddressEncoder, getTransactionEncoder,
  createTransactionMessage, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions, compileTransaction, pipe } from '@solana/kit';
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, getSyncNativeInstruction } from '@solana-program/token';
import { getTransferSolInstruction } from '@solana-program/system';
import { protocolAddresses } from '../server/setup.ts';
import { solanaRpcCall } from '../server/solanaRpc.ts';
import { sendInstructions } from '../server/transaction.ts';
import { buildMintQuoteMessage, parseBackendSigner } from '../server/signing.ts';
import { loadMintAssignments } from '../server/mintAssignments.ts';
import { buildMintMachine, derivePaidMintAsset, deriveTaxiAddresses, decodeConfiguration, decodeEventQueue,
  chooseEventPage, buildTransferCoreAssetInstruction, buildListMachineInstruction,
  buildCancelMachineListingInstruction, buildBuyMachineInstruction } from '../src/protocol/anchorClient.js';

const PROGRAM = address('FJgPHdMEFi8JQSeW7h9ogLCDvm2gixWkXG8g7tqn7aJr');
const CORE = address('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
const WSOL = address('So11111111111111111111111111111111111111112');
const TOKEN = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const LOCAL = 'http://127.0.0.1:8898';
const DEVNET = 'https://api.devnet.solana.com';
const [mode, directory] = process.argv.slice(2);
if (!['prepare', 'run'].includes(mode) || !directory) throw Error('Usage: node --import tsx scripts/pda-mint-local-smoke.mjs prepare|run <external-fixture-directory>');
const dir = resolve(directory);
if (dir === resolve(process.cwd()) || dir.startsWith(resolve(process.cwd()) + '\\') || dir.startsWith(resolve(process.cwd()) + '/')) throw Error('Fixtures and keys must be outside the repository');
const a = await protocolAddresses(PROGRAM);
const encoder = getAddressEncoder();
const account = async (key, url = LOCAL) => (await solanaRpcCall(url, 'getAccountInfo', [key, { encoding: 'base64', commitment: 'finalized' }])).value;
const bytes = value => Buffer.from(value.data[0], 'base64');
const loadKey = async name => createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(await readFile(resolve(dir, `${name}.json`), 'utf8'))));

if (mode === 'prepare') {
  assert.equal(await solanaRpcCall(DEVNET, 'getGenesisHash', []), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
  await mkdir(dir, { recursive: true });
  for (const name of ['owner', 'buyer']) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const secret = Buffer.concat([privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32), publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)]);
    await writeFile(resolve(dir, `${name}.json`), JSON.stringify([...secret]), { flag: 'wx' });
  }
  const owner = await loadKey('owner');
  const configuration = await account(a.config, DEVNET);
  assert.ok(configuration);
  const data = bytes(configuration);
  const original = decodeConfiguration(data);
  assert.deepEqual(original.mintedByClass, [0, 0, 0, 0]);
  // Local-only fixture overrides: quote signer, test payment mint, sale and pause.
  data.set(encoder.encode(owner.address), 72);
  data.set(encoder.encode(WSOL), 272);
  let offset = 432;
  for (let index = 0; index < 17; index++) offset += 4 + data.readUInt32LE(offset);
  offset += 32 + 8;
  data[offset] = 1;
  data.writeBigInt64LE(0n, offset + 1);
  configuration.data = [data.toString('base64'), 'base64'];
  const keys = [a.config, a.pool, a.traineePool, a.queue, a.traineeQueue, a.feeVault, original.collection, WSOL];
  for (const key of keys) {
    const value = key === a.config ? configuration : await account(key, DEVNET);
    assert.ok(value, `Missing devnet fixture ${key}`);
    // RPC u64::MAX rentEpoch cannot be represented exactly as a JS number.
    value.rentEpoch = 0;
    await writeFile(resolve(dir, `${key}.json`), JSON.stringify({ pubkey: key, account: value }));
  }
  await writeFile(resolve(dir, 'fixtures.json'), JSON.stringify({ program: PROGRAM, core: CORE, accounts: keys, collection: original.collection }, null, 2));
  console.log('LOCAL_FIXTURES_PREPARED; devnet unchanged');
} else {
  const genesis = await solanaRpcCall(LOCAL, 'getGenesisHash', []);
  assert.notEqual(genesis, 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
  assert.notEqual(genesis, '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');
  const owner = await loadKey('owner'), buyer = await loadKey('buyer');
  for (const signer of [owner, buyer]) {
    const signature = await solanaRpcCall(LOCAL, 'requestAirdrop', [signer.address, 10_000_000_000]);
    for (let attempt = 0; attempt < 60; attempt++) {
      const status = (await solanaRpcCall(LOCAL, 'getSignatureStatuses', [[signature]])).value[0];
      if (status?.confirmationStatus === 'finalized') break;
      if (attempt === 59) throw Error('Local airdrop timeout');
      await new Promise(r => setTimeout(r, 500));
    }
  }
  const config = decodeConfiguration(bytes(await account(a.config)));
  const [source] = await findAssociatedTokenPda({ owner: owner.address, mint: WSOL, tokenProgram: TOKEN });
  const [destination] = await findAssociatedTokenPda({ owner: config.teamAccount, mint: WSOL, tokenProgram: TOKEN });
  await sendInstructions(LOCAL, owner, [
    getCreateAssociatedTokenIdempotentInstruction({ payer: owner, owner: owner.address, mint: WSOL, tokenProgram: TOKEN, ata: source }),
    getCreateAssociatedTokenIdempotentInstruction({ payer: owner, owner: config.teamAccount, mint: WSOL, tokenProgram: TOKEN, ata: destination }),
    getTransferSolInstruction({ source: owner, destination: source, amount: 100_000_000n }),
    getSyncNativeInstruction({ account: source }),
  ]);
  const assignments = await loadMintAssignments('config/mint-assignments.devnet.json');
  assert.equal(Buffer.from(config.mintAssignmentRoot).toString('hex'), assignments.root.toString('hex'));
  const assignment = assignments.assignment(0);
  const asset = await derivePaidMintAsset(PROGRAM, owner.address, 0);
  const backend = parseBackendSigner(await readFile(resolve(dir, 'owner.json'), 'utf8'));
  const clock = bytes(await account('SysvarC1ock11111111111111111111111111111111')).readBigInt64LE(32);
  const fields = { owner: owner.address, asset, fareMint: WSOL, assignmentIndex: 0,
    classIndex: assignment.classIndex, variantIndex: assignment.variantIndex,
    amountFareRaw: 1_000_000n, priceUsdCents: 2500n, expiresAt: clock + 45n };
  const message = buildMintQuoteMessage(PROGRAM, config.deploymentId, fields);
  const quote = { ...fields, assignmentProof: assignment.proof, backendSigner: backend.publicKey,
    message: Buffer.from(message).toString('base64'), signature: Buffer.from(backend.sign(message)).toString('base64') };
  const queue = decodeEventQueue(bytes(await account(a.queue)));
  const built = await buildMintMachine({ programAddress: PROGRAM, owner: owner.address, configAddress: a.config,
    config, queue: a.queue, pageIndex: chooseEventPage(queue, 2), fareTokenProgram: TOKEN, teamFareAccountExists: true, quote });
  const blockhash = (await solanaRpcCall(LOCAL, 'getLatestBlockhash', [{ commitment: 'finalized' }])).value;
  const tx = compileTransaction(pipe(createTransactionMessage({ version: 0 }),
    m => setTransactionMessageFeePayer(owner.address, m), m => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    m => appendTransactionMessageInstructions(built.instructions, m)));
  assert.deepEqual(Object.keys(tx.signatures), [owner.address]);
  const beforePayment = bytes(await account(destination)).readBigUInt64LE(64);
  const mint = await sendInstructions(LOCAL, owner, built.instructions);
  console.log(`MINT_FINALIZED=${mint}`);
  const created = bytes(await account(asset));
  assert.equal(created[0], 1);
  assert.deepEqual(created.subarray(1, 33), Buffer.from(encoder.encode(owner.address)));
  assert.equal(bytes(await account(destination)).readBigUInt64LE(64) - beforePayment, fields.amountFareRaw);
  assert.deepEqual(decodeConfiguration(bytes(await account(a.config))).mintedByClass, [0, 1, 0, 0]);
  await assert.rejects(sendInstructions(LOCAL, owner, built.instructions));
  const d = await deriveTaxiAddresses(PROGRAM, asset);
  const base = { programAddress: PROGRAM, seller: owner.address, config: a.config, machine: d.machine,
    asset, listing: d.listing, collection: config.collection };
  const list = await sendInstructions(LOCAL, owner, [buildListMachineInstruction({ ...base, priceLamports: 1_000_000n })]);
  console.log(`LIST_FINALIZED=${list}`);
  const cancel = await sendInstructions(LOCAL, owner, [buildCancelMachineListingInstruction(base)]);
  console.log(`CANCEL_FINALIZED=${cancel}`);
  assert.equal(await account(d.listing), null);
  await sendInstructions(LOCAL, owner, [buildListMachineInstruction({ ...base, priceLamports: 1_000_000n })]);
  const buy = await sendInstructions(LOCAL, buyer, [buildBuyMachineInstruction({ ...base, buyer: buyer.address, priceLamports: 1_000_000n })]);
  console.log(`BUY_FINALIZED=${buy}`);
  assert.deepEqual(bytes(await account(asset)).subarray(1, 33), Buffer.from(encoder.encode(buyer.address)));
  const transfer = await sendInstructions(LOCAL, buyer, [buildTransferCoreAssetInstruction({ owner: buyer.address,
    asset, collection: config.collection, newOwner: owner.address })]);
  assert.deepEqual(bytes(await account(asset)).subarray(1, 33), Buffer.from(encoder.encode(owner.address)));
  const evidence = { network: 'localhost', fixtureSource: 'devnet', program: PROGRAM, asset,
    signerCount: Object.keys(tx.signatures).length, wireBytes: getTransactionEncoder().encode(tx).length,
    checks: ['mint', 'exact-payment', 'duplicate-rejected', 'list', 'cancel', 'buy', 'transfer'],
    signatures: { mint, list, cancel, buy, transfer } };
  await writeFile(resolve(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
