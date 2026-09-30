import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateRecoveryRewards } from '../src/recoveryClaim.js';
import { REWARD_ACCUMULATOR_SCALE } from '../server/shutdownClaims.js';

test('recovery claim includes finalized pending rewards and never invents an amount', () => {
  const machine = {
    rewardActive: true,
    weight: 3,
    checkpoints: [10n, 20n, 30n, 40n, 50n].map(value => value * REWARD_ACCUMULATOR_SCALE),
    claimable: [1n, 2n, 3n, 4n, 5n],
  };
  const pool = { accumulators: [12n, 20n, 31n, 45n, 50n].map(value => value * REWARD_ACCUMULATOR_SCALE) };
  assert.deepEqual(calculateRecoveryRewards(machine, pool), [7n, 2n, 6n, 19n, 5n]);
  assert.deepEqual(calculateRecoveryRewards({ ...machine, rewardActive: false }, pool), machine.claimable);
});
