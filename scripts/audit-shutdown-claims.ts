import { address } from '@solana/kit';
import { pathToFileURL } from 'node:url';
import { protocolAddresses } from '../server/setup.js';
import { solanaRpcCall } from '../server/solanaRpc.js';
import { calculateOutstandingMachineRewards, hasOutstandingMachineRewards } from '../server/shutdownClaims.js';
// @ts-expect-error The browser protocol decoder is intentionally plain JavaScript.
import { decodeMachine, decodeRewardPool } from '../src/protocol/anchorClient.js';

interface ProgramAccountRow { pubkey: string; account: { data: [string, string] } }
interface DasAsset { burnt?: boolean; ownership?: { owner?: string } }

export async function auditShutdownClaims(input: {
  rpcUrl: string;
  dasUrl: string;
  programId: string;
  requireZero: boolean;
}) {
  const programId = address(input.programId);
  const addresses = await protocolAddresses(programId);
  const [poolResult, rows] = await Promise.all([
    solanaRpcCall<{ value: { data: [string, string] } | null }>(input.rpcUrl, 'getAccountInfo', [
      String(addresses.pool), { encoding: 'base64', commitment: 'finalized' },
    ]),
    solanaRpcCall<ProgramAccountRow[]>(input.rpcUrl, 'getProgramAccounts', [String(programId), {
      encoding: 'base64', commitment: 'finalized', filters: [{ dataSize: 189 }],
    }]),
  ]);
  if (!poolResult.value) throw new Error('Main reward pool is missing.');
  const pool = decodeRewardPool(Buffer.from(poolResult.value.data[0], 'base64'));
  const outstanding = rows.flatMap(row => {
    const machine = decodeMachine(Buffer.from(row.account.data[0], 'base64'));
    const rewards = calculateOutstandingMachineRewards(machine, pool);
    return hasOutstandingMachineRewards(rewards)
      ? [{ machine: row.pubkey, asset: String(machine.asset), rewards }]
      : [];
  });
  const assets = await loadAssets(input.dasUrl, outstanding.map(item => item.asset));
  const claims = outstanding.map((item, index) => ({
    ...item,
    owner: assets[index]?.ownership?.owner || 'UNKNOWN',
    burnt: assets[index]?.burnt === true,
  }));
  for (const claim of claims) {
    console.log(`OUTSTANDING_CLAIM=OWNER:${claim.owner},ASSET:${claim.asset},MACHINE:${claim.machine},BURNT:${claim.burnt},RAW:${claim.rewards.join(',')}`);
  }
  console.log(`OUTSTANDING_CLAIM_COUNT=${claims.length}`);
  if (input.requireZero && claims.length > 0) {
    throw new Error(`${claims.length} machine claim(s) must be finalized before vault rescue or ProgramData close.`);
  }
  return claims;
}

async function loadAssets(dasUrl: string, ids: string[]) {
  const assets: Array<DasAsset | null> = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    assets.push(...await solanaRpcCall<Array<DasAsset | null>>(dasUrl, 'getAssetBatch', [ids.slice(offset, offset + 100)]));
  }
  return assets;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await auditShutdownClaims({
    rpcUrl: required('SOLANA_RPC_URL'),
    dasUrl: process.env.SOLANA_DAS_URL?.trim() || required('VITE_SOLANA_DAS_URL'),
    programId: required('TAXI_PROGRAM_ID'),
    requireZero: process.argv.includes('--require-zero'),
  });
}
