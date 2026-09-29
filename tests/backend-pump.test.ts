import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  generateKeyPairSigner,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { getCreateAssociatedTokenIdempotentInstruction } from '@solana-program/token';
import {
  PUMP_AMM_PROGRAM,
  PUMP_PROGRAM,
  TOKEN_PROGRAM,
  WSOL_MINT,
  buildPumpAmmFeeCollection,
  buildPumpBondingFeeCollection,
  buildPumpSharedAmmFeeTransfer,
  buildPumpSharedFeeDistribution,
  derivePumpFeeAddresses,
  derivePumpFeeSharingConfig,
} from '../server/pump.js';
import { absorbPumpWsolFeesInstruction } from '../server/worker.js';

const taxiProgram = address('9ZLAzKr2taQMXPZjkAFDNfWHrtrCTspR7sXV1E2F6eVv');
const creator = address('2GuMXi3T7smF1Gndvq3LS4vC54sN2r7BnbHFMc75RPBw');
const configAddress = address('J1ZKaM1We1aGnGyxnQzt5wqKAJjPeokca7tP2VSiMA7X');
const caller = address('11111111111111111111111111111111');

test('pump.fun fee instructions use the official programs, discriminators, and PDA recipient', async () => {
  const addresses = await derivePumpFeeAddresses(creator);
  const bonding = buildPumpBondingFeeCollection(creator, addresses);
  const amm = buildPumpAmmFeeCollection(creator, addresses);

  assert.equal(bonding.programAddress, PUMP_PROGRAM);
  assert.deepEqual([...(bonding.data || [])], [207, 17, 138, 242, 4, 34, 19, 56]);
  assert.equal(bonding.accounts?.length, 10);
  assert.equal(bonding.accounts?.[0].address, creator);
  assert.equal(bonding.accounts?.[0].role, AccountRole.WRITABLE);

  assert.equal(amm.programAddress, PUMP_AMM_PROGRAM);
  assert.deepEqual([...(amm.data || [])], [160, 57, 89, 42, 181, 139, 43, 66]);
  assert.equal(amm.accounts?.length, 8);
  assert.equal(amm.accounts?.[2].address, creator);
  assert.equal(amm.accounts?.[5].address, addresses.creatorWsolAta);
  assert.notEqual(addresses.bondingCreatorVault, addresses.ammCreatorVaultAuthority);
  assert.equal(await derivePumpFeeSharingConfig(address('5xF68yQmQ6p9uQitrf8shxGXqTt5CouXXi19cNHvpump')), '43uWECi43atPx7sb7dzwhKDg4pCC9mbGMVtnVkyWTkaR');
});

test('shared creator fee instructions use official V2 account order', async () => {
  const payer = await generateKeyPairSigner();
  const mint = address('4fg5Nh2wjVddSfDPW1AATQ9Tvmdc1Np1pBQQGL4Mpump');
  const sharingConfig = address('4uiVRDnSqh1jcByFcEit3FpTw8qFoCh8HiLxDotJi9Fx');
  const recipient = address('2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF');
  const bondingCurve = address('G4ZPPzWratZrtHVSRcf3iWYCFnQJxqHzzpMVcfEmdodV');
  const addresses = await derivePumpFeeAddresses(sharingConfig);
  const transfer = buildPumpSharedAmmFeeTransfer(payer.address, sharingConfig, addresses);
  const distribute = buildPumpSharedFeeDistribution({ payer: payer.address, mint, bondingCurve, sharingConfig, recipient, addresses });

  assert.deepEqual([...(transfer.data || [])], [1, 33, 78, 185, 33, 67, 44, 92]);
  assert.equal(transfer.accounts?.length, 12);
  assert.deepEqual([...(distribute.data || [])], [255, 203, 19, 79, 244, 68, 8, 159, 0]);
  assert.equal(distribute.accounts?.length, 13);
  assert.equal(distribute.accounts?.[0].role, AccountRole.WRITABLE_SIGNER);
  assert.equal(distribute.accounts?.[12].address, recipient);
  assert.equal(distribute.accounts?.[12].role, AccountRole.WRITABLE);
});

test('taxi program absorbs collected PumpSwap WSOL into its fee vault', () => {
  const feeVault = creator;
  const config = address('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
  const pumpWsolVault = address('So11111111111111111111111111111111111111112');
  const instruction = absorbPumpWsolFeesInstruction(
    taxiProgram,
    caller,
    {
      config,
      feeVault,
      pool: creator,
      traineePool: creator,
      queue: creator,
      traineeQueue: creator,
    },
    pumpWsolVault,
  );

  assert.equal(instruction.accounts?.length, 5);
  assert.equal(instruction.accounts?.[0].role, AccountRole.WRITABLE_SIGNER);
  assert.equal(instruction.accounts?.[2].address, feeVault);
  assert.equal(instruction.accounts?.[3].address, pumpWsolVault);
});

test('atomic PumpSwap collection and WSOL absorption fits one Solana transaction', async () => {
  const payer = await generateKeyPairSigner();
  const addresses = await derivePumpFeeAddresses(creator);
  const instructions = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer,
      ata: addresses.creatorWsolAta,
      owner: creator,
      mint: WSOL_MINT,
      tokenProgram: TOKEN_PROGRAM,
    }),
    buildPumpAmmFeeCollection(creator, addresses),
    absorbPumpWsolFeesInstruction(
      taxiProgram,
      payer.address,
      {
        config: configAddress,
        feeVault: creator,
        pool: creator,
        traineePool: creator,
        queue: creator,
        traineeQueue: creator,
      },
      addresses.creatorWsolAta,
    ),
  ];
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    transaction => setTransactionMessageFeePayer(payer.address, transaction),
    transaction => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: '11111111111111111111111111111111' as never,
      lastValidBlockHeight: 1n,
    }, transaction),
    transaction => appendTransactionMessageInstructions(instructions, transaction),
  );
  const bytes = getTransactionEncoder().encode(compileTransaction(message));
  assert.ok(bytes.length <= 1232, `pump fee transaction is ${bytes.length} bytes`);
});
