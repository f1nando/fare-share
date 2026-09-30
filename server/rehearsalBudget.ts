import { randomUUID } from 'node:crypto';
import type { Collection } from 'mongodb';
import type { RehearsalBudgetDocument, RehearsalBudgetReservation } from './database.js';
import { solanaRpcCall } from './solanaRpc.js';
import type { TransactionBudgetGuard } from './transaction.js';

export const REHEARSAL_ORDINARY_LIMIT_LAMPORTS = 700_000_000n;
export const REHEARSAL_HARD_LIMIT_LAMPORTS = 800_000_000n;

export class RehearsalBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RehearsalBudgetError';
  }
}

export function rehearsalBudgetAllows(
  spentLamports: bigint,
  reservedLamports: bigint,
  requestedLamports: bigint,
  actionClass: 'ordinary' | 'recovery',
  ordinaryLimitLamports = REHEARSAL_ORDINARY_LIMIT_LAMPORTS,
  hardLimitLamports = REHEARSAL_HARD_LIMIT_LAMPORTS,
) {
  const limit = actionClass === 'recovery' ? hardLimitLamports : ordinaryLimitLamports;
  return spentLamports + reservedLamports + requestedLamports <= limit;
}

export function reconciledRehearsalSpend(spentLamports: bigint, finalizedNetDebitLamports: bigint) {
  const next = spentLamports + finalizedNetDebitLamports;
  return next > 0n ? next : 0n;
}

export async function createRehearsalBudgetGuard(input: {
  rpcUrl: string;
  collection: Collection<RehearsalBudgetDocument>;
  ordinaryLimitLamports?: bigint;
  hardLimitLamports?: bigint;
  transactionReserveLamports?: bigint;
  initialSpentLamports?: bigint;
}): Promise<TransactionBudgetGuard> {
  const ordinaryLimit = input.ordinaryLimitLamports ?? REHEARSAL_ORDINARY_LIMIT_LAMPORTS;
  const hardLimit = input.hardLimitLamports ?? REHEARSAL_HARD_LIMIT_LAMPORTS;
  const transactionReserve = input.transactionReserveLamports ?? 10_000_000n;
  const initialSpent = input.initialSpentLamports ?? 0n;
  if (ordinaryLimit !== REHEARSAL_ORDINARY_LIMIT_LAMPORTS
    || hardLimit !== REHEARSAL_HARD_LIMIT_LAMPORTS
    || transactionReserve <= 0n
    || initialSpent < 0n
    || initialSpent > hardLimit) {
    throw new RehearsalBudgetError('Invalid rehearsal budget limits.');
  }
  const now = new Date();
  await input.collection.updateOne({ key: 'disposable-rehearsal' }, { $setOnInsert: {
    key: 'disposable-rehearsal',
    ordinaryLimitLamports: Number(ordinaryLimit),
    hardLimitLamports: Number(hardLimit),
    spentLamports: Number(initialSpent),
    reservedLamports: 0,
    reservations: {},
    entries: [],
    createdAt: now,
    updatedAt: now,
  } }, { upsert: true });
  const configured = await input.collection.findOne({ key: 'disposable-rehearsal' });
  if (!configured
    || BigInt(configured.ordinaryLimitLamports) !== ordinaryLimit
    || BigInt(configured.hardLimitLamports) !== hardLimit) {
    throw new RehearsalBudgetError('Stored rehearsal budget limits do not match configuration.');
  }

  const guard: TransactionBudgetGuard = {
    async reserve({ actionClass, fundingWallet, additionalDebitLamports = 0n }) {
      const maximumDebit = transactionReserve + additionalDebitLamports;
      const limit = actionClass === 'recovery' ? hardLimit : ordinaryLimit;
      const reservationId = randomUUID().replaceAll('-', '');
      const createdAt = new Date();
      const reservation: RehearsalBudgetReservation = {
        actionClass,
        fundingWallet: String(fundingWallet),
        maximumDebitLamports: maximumDebit.toString(),
        createdAt,
      };
      const path = `reservations.${reservationId}`;
      const result = await input.collection.findOneAndUpdate({
        key: 'disposable-rehearsal',
        $expr: { $lte: [
          { $add: ['$spentLamports', '$reservedLamports', Number(maximumDebit)] },
          Number(limit),
        ] },
      }, {
        $inc: { reservedLamports: Number(maximumDebit) },
        $set: { [path]: reservation, updatedAt: createdAt } as never,
      }, { returnDocument: 'after' });
      if (!result) throw new RehearsalBudgetError(`Rehearsal ${actionClass} budget limit would be exceeded.`);
      return reservationId;
    },

    async signed(reservationId, signature) {
      await input.collection.updateOne(
        { key: 'disposable-rehearsal', [`reservations.${reservationId}`]: { $exists: true } },
        { $set: { [`reservations.${reservationId}.signature`]: signature, updatedAt: new Date() } } as never,
      );
    },

    async finalized(reservationId, signature) {
      const document = await input.collection.findOne({ key: 'disposable-rehearsal' });
      const reservation = document?.reservations?.[reservationId];
      if (!reservation) return;
      const netDebit = await finalizedFundingWalletDebit(input.rpcUrl, signature, reservation.fundingWallet);
      if (netDebit === undefined) return;
      const maximumDebit = BigInt(reservation.maximumDebitLamports);
      const finalizedAt = new Date();
      await input.collection.updateOne(
        { key: 'disposable-rehearsal', [`reservations.${reservationId}.signature`]: signature },
        [
          { $set: {
            spentLamports: { $max: [0, { $add: ['$spentLamports', Number(netDebit)] }] },
            reservedLamports: { $max: [0, { $subtract: ['$reservedLamports', Number(maximumDebit)] }] },
            entries: { $concatArrays: ['$entries', [{ ...reservation, reservationId, signature, netDebitLamports: netDebit.toString(), finalizedAt }]] },
            updatedAt: finalizedAt,
          } },
          { $unset: `reservations.${reservationId}` },
        ] as never,
      );
    },

    async release(reservationId) {
      const document = await input.collection.findOne({ key: 'disposable-rehearsal' });
      const reservation = document?.reservations?.[reservationId];
      if (!reservation) return;
      const maximumDebit = BigInt(reservation.maximumDebitLamports);
      await input.collection.updateOne(
        { key: 'disposable-rehearsal', [`reservations.${reservationId}`]: { $exists: true } },
        [
          { $set: {
            reservedLamports: { $max: [0, { $subtract: ['$reservedLamports', Number(maximumDebit)] }] },
            updatedAt: new Date(),
          } },
          { $unset: `reservations.${reservationId}` },
        ] as never,
      );
    },
  };
  const pending = (await input.collection.findOne({ key: 'disposable-rehearsal' }))?.reservations || {};
  for (const [reservationId, reservation] of Object.entries(pending)) {
    if (reservation.signature) {
      await guard.finalized(reservationId, reservation.signature).catch(() => undefined);
    } else if (Date.now() - reservation.createdAt.getTime() > 10 * 60_000) {
      await guard.release(reservationId);
    }
  }
  return guard;
}

async function finalizedFundingWalletDebit(rpcUrl: string, signature: string, fundingWallet: string) {
  const transaction = await solanaRpcCall<{
    meta?: { err: unknown; preBalances: number[]; postBalances: number[] } | null;
    transaction?: { message?: { accountKeys?: Array<string | { pubkey: string }> } };
  } | null>(rpcUrl, 'getTransaction', [signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' }]);
  if (!transaction?.meta) return undefined;
  const keys = transaction.transaction?.message?.accountKeys || [];
  const index = keys.findIndex(key => (typeof key === 'string' ? key : key.pubkey) === fundingWallet);
  if (index < 0) throw new RehearsalBudgetError('Finalized transaction does not contain the reserved funding wallet.');
  return BigInt(transaction.meta.preBalances[index]) - BigInt(transaction.meta.postBalances[index]);
}
