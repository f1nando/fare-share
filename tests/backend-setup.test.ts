import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AccountRole, address, type KeyPairSigner } from '@solana/kit';
import {
  buildInitializeInstruction,
  buildSetMetadataUrisInstruction,
  buildSetTraineeMetadataUriInstruction,
  assertMetadataUris,
  protocolAddresses,
  type InitializeProtocolInput,
} from '../server/setup.js';

const PROGRAM_ID = address('GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4');
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
    mintPricesUsdCents: [2500n, 2500n, 2500n, 2500n],
    mintAssignmentRoot: new Uint8Array(12).fill(7),
    metadataUris: Array.from({ length: 16 }, (_, index) => `uri-${index}`),
    traineeMetadataUri: 'https://example.test/trainee.json',
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
    [2500n, 2500n, 2500n, 2500n],
  );
  offset += 8 * 4;
  assert.deepEqual(data.subarray(offset, offset + 12), Buffer.alloc(12, 7));
  offset += 12;
  assert.equal(offset, data.length);

  for (let classIndex = 0; classIndex < 4; classIndex += 1) {
    const start = classIndex * 4;
    const metadataInstruction = buildSetMetadataUrisInstruction(
      PROGRAM_ID,
      SYSTEM_ADDRESS,
      addresses.config,
      classIndex,
      input.metadataUris.slice(start, start + 4),
    );
    const metadataData = Buffer.from(metadataInstruction.data!);
    assert.deepEqual(
      metadataData.subarray(0, 8),
      createHash('sha256').update('global:set_metadata_uris').digest().subarray(0, 8),
    );
    assert.equal(metadataData[8], classIndex);
    let metadataOffset = 9;
    const values = Array.from({ length: 4 }, () => {
      const length = metadataData.readUInt32LE(metadataOffset);
      metadataOffset += 4;
      const value = metadataData.subarray(metadataOffset, metadataOffset + length).toString();
      metadataOffset += length;
      return value;
    });
    assert.deepEqual(values, input.metadataUris.slice(start, start + 4));
    assert.equal(metadataOffset, metadataData.length);
  }
  const traineeInstruction = buildSetTraineeMetadataUriInstruction(
    PROGRAM_ID,
    SYSTEM_ADDRESS,
    addresses.config,
    input.traineeMetadataUri,
  );
  assert.deepEqual(
    Buffer.from(traineeInstruction.data!.slice(0, 8)),
    createHash('sha256').update('global:set_trainee_metadata_uri').digest().subarray(0, 8),
  );
});

test('metadata setup rejects missing variants and invalid classes', async () => {
  const addresses = await protocolAddresses(PROGRAM_ID);
  assert.throws(
    () => buildSetMetadataUrisInstruction(PROGRAM_ID, SYSTEM_ADDRESS, addresses.config, 0, ['a', 'b', 'c']),
    /exactly four/,
  );
  assert.throws(
    () => buildSetMetadataUrisInstruction(PROGRAM_ID, SYSTEM_ADDRESS, addresses.config, 4, ['a', 'b', 'c', 'd']),
    /0 to 3/,
  );
  assert.throws(() => assertMetadataUris(Array.from({ length: 16 }, () => 'same')), /distinct/);
  assert.throws(
    () => assertMetadataUris(Array.from({ length: 16 }, (_, index) => index === 15 ? 'x'.repeat(201) : `uri-${index}`)),
    /200 UTF-8 bytes/,
  );
});

test('protocol PDA derivation is deterministic and separates all roots', async () => {
  const first = await protocolAddresses(PROGRAM_ID);
  const second = await protocolAddresses(PROGRAM_ID);
  assert.deepEqual(first, second);
  assert.equal(new Set(Object.values(first)).size, 6);
});
