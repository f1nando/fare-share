import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REWARD_ACCUMULATOR_SCALE,
  calculateOutstandingMachineRewards,
  hasOutstandingMachineRewards,
} from '../server/shutdownClaims.js';

test('shutdown claim calculation exposes every reward before close', () => {
  const machine = {
    rewardActive: true,
    weight: 2,
    checkpoints: [1n, 2n].map(value => value * REWARD_ACCUMULATOR_SCALE),
    claimable: [3n, 4n],
  };
  const rewards = calculateOutstandingMachineRewards(machine, {
    accumulators: [3n, 5n].map(value => value * REWARD_ACCUMULATOR_SCALE),
  });
  assert.deepEqual(rewards, [7n, 10n]);
  assert.equal(hasOutstandingMachineRewards(rewards), true);
  assert.equal(hasOutstandingMachineRewards([0n, 0n]), false);
});
