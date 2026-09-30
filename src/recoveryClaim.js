import { address } from '@solana/kit';
import { base64Bytes, decodeMachine } from './protocol/anchorClient.js';
import { createRateLimitedSolanaRpc } from './protocol/requestLimits.js';
import { PROGRAM_ID, RPC_URL, loadProtocolStatus } from './protocol/solana.js';
import { calculateOutstandingMachineRewards } from '../server/shutdownClaims.js';

export const RECOVERY_PROGRAM_ID = 'GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4';
export const RECOVERY_OWNER = 'CBJQC1CGS4WQeogopZipSFj2RCW1DJYqGdsMerjHmswW';
export const RECOVERY_MACHINE = '2KAMpP9SWTXEJfWE5vyKfY2iEzDJdQwUnFNKHLUB11r4';
export const RECOVERY_ASSET = 'CpkY8xZ1hsgC77f8Z4GmncWN4vJRQL5bUQzfp1JFh3ZK';
const rpc = createRateLimitedSolanaRpc(RPC_URL);

export const calculateRecoveryRewards = calculateOutstandingMachineRewards;

export async function loadRecoveryClaimState() {
  if (String(PROGRAM_ID) !== RECOVERY_PROGRAM_ID) {
    throw new Error('This recovery page was built for a different Program ID. Do not sign anything.');
  }
  const status = await loadProtocolStatus();
  if (!status.deployed) throw new Error('The recovery program is unavailable.');
  const response = await rpc.getAccountInfo(address(RECOVERY_MACHINE), {
    commitment: 'finalized',
    encoding: 'base64',
  }).send();
  if (!response.value) throw new Error('The recovery machine account no longer exists.');
  const decoded = decodeMachine(base64Bytes(response.value.data[0]));
  if (String(decoded.asset) !== RECOVERY_ASSET || decoded.closed) {
    throw new Error('The recovery machine identity does not match the frozen shutdown record.');
  }
  return {
    status,
    machine: {
      ...decoded,
      machineAddress: address(RECOVERY_MACHINE),
      asset: address(RECOVERY_ASSET),
      rewards: calculateRecoveryRewards(decoded, status.pool),
    },
  };
}
