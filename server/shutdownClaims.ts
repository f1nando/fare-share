export const REWARD_ACCUMULATOR_SCALE = 1_000_000_000_000_000_000n;

export function calculateOutstandingMachineRewards(machine: {
  rewardActive: boolean;
  weight: number;
  checkpoints: bigint[];
  claimable: bigint[];
}, pool: { accumulators: bigint[] }) {
  const pending = machine.rewardActive
    ? machine.checkpoints.map((checkpoint, index) => (
      (pool.accumulators[index] - checkpoint) * BigInt(machine.weight) / REWARD_ACCUMULATOR_SCALE
    ))
    : machine.checkpoints.map(() => 0n);
  return machine.claimable.map((amount, index) => amount + pending[index]);
}

export function hasOutstandingMachineRewards(rewards: bigint[]) {
  return rewards.some(amount => amount > 0n);
}
