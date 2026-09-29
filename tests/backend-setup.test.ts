import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AccountRole, address, type KeyPairSigner } from '@solana/kit';
import { buildInitializeInstruction, protocolAddresses, type InitializeProtocolInput } from '../server/setup.js';

const PROGRAM_ID = address('9ZLAzKr2taQMXPZjkAFDNfWHrtrCTspR7sXV1E2F6eVv');
const SYSTEM_ADDRESS = address('11111111111111111111111111111111');
const SIGNER_SECRET = JSON.stringify([
  ...Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex'),
  ...Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex'),
]);

test('initialize instruction matches Anchor account and field order', async () => {
  const addresses = await protocolAddresses(PROGRAM_ID);
  const input: InitializeProtocolInput = {
    rpcUrl: 'http://127.0.0.1:8899',
    programId: PROGRAM_ID,
    admin: { address: SYSTEM_ADDRESS } as KeyPairSigner,
    backendSignerSecret: SIGNER_SECRET,
    teamAccount: SYSTEM_ADDRESS,
    jupiterProgram: PROGRAM_ID,
    deploymentId: Uint8Array.from({ length: 32 }, (_, index) => index),
    collectionName: 'Taxi Park',
    collectionUri: 'https://example.test/collection.json',
    stockMints: [SYSTEM_ADDRESS, SYSTEM_ADDRESS, SYSTEM_ADDRESS, SYSTEM_ADDRESS],
    mintPrices: [49n, 129n, 399n, 1099n],
    metadataUris: ['economy', 'comfort', 'business', 'legend'],
  };
  const collection = address('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
  const instruction = buildInitializeInstruction(input, addresses, collection);

  assert.equal(instruction.accounts?.length, 10);
  assert.equal(instruction.accounts?.[0].role, AccountRole.WRITABLE_SIGNER);
  assert.equal(instruction.accounts?.[7].address, collection);
  assert.equal(instruction.accounts?.[7].role, AccountRole.WRITABLE_SIGNER);
  assert.deepEqual(
    Buffer.from(instruction.data!.slice(0, 8)),
    createHash('sha256').update('global:initialize').digest().subarray(0, 8),
  );

  const data = Buffer.from(instruction.data!);
  let offset = 8 + (32 * 4);
  const readString = () => {
    const length = data.readUInt32LE(offset);
    offset += 4;
    const value = data.subarray(offset, offset + length).toString();
    offset += length;
    return value;
  };
  assert.equal(readString(), 'Taxi Park');
  assert.equal(readString(), 'https://example.test/collection.json');
  offset += 32 * 4;
  assert.deepEqual(
    [0, 1, 2, 3].map(index => data.readBigUInt64LE(offset + (index * 8))),
    [49n, 129n, 399n, 1099n],
  );
  offset += 8 * 4;
  assert.deepEqual([readString(), readString(), readString(), readString()], input.metadataUris);
  assert.equal(offset, data.length);
});

test('protocol PDA derivation is deterministic and separates all roots', async () => {
  const first = await protocolAddresses(PROGRAM_ID);
  const second = await protocolAddresses(PROGRAM_ID);
  assert.deepEqual(first, second);
  assert.equal(new Set(Object.values(first)).size, 6);
});
