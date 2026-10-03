const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

const addresses = {
  deployer: 'F3jKZokibZiN5SJM5JM4T3a99HVb4zueDTGPR5hbn8tR',
  worker: 'J38s2zZLszLssXu6CAencaqwrZ6wvE3hmoc4jWy2piJu',
  program: 'H7X7Ky8q6mvEdeDLikx6fPGAyjjHywR74W53DyXZJrsY',
  programData: '3dUwFwcqrq15iqQJdW5hsAs4HRtpEu4YrysvA9iV8DSH',
  feeVault: 'H6sdzCz9gvXD8szwAjPDGK6AXGKT4zNBRwNWTNcr4Dyi',
  tokenVaults: [
    '5xzU85NQMzGTurJ1t7Pbd1FAssxSLbyUF2HtbsRwrzZb',
    '3y9YnVpaq5tDxDLJMJ6ScUKEacqqmtZsfhoqrgn7tJAk',
    '4UrtzFMLTv9qMGaqwsVy9hf4fAwFD3hTo97kEdQq4VJk',
    '4DRtXvhX8uZ5wzkCAFJ1G7QsKoMrFAZchJ2EkjYr9MtP',
    '3VUV7W4sTU5bmy57kbRgrJLmfZeFZzWZeCi5CktRpBr6',
    '4bom344dzMoHoRfJAd2mcixgGtZ65o14RYmyJCMBcMSm',
  ],
};

async function rpc(method, params) {
  const response = await rateLimitedRpcFetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'devnet-recovery-audit', method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Solana RPC failed with HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`Solana RPC ${body.error.code}: ${body.error.message}`);
  if (body.result === undefined) throw new Error(`Solana RPC returned no result for ${method}`);
  return body.result;
}

const ordered = [
  addresses.deployer,
  addresses.worker,
  addresses.program,
  addresses.programData,
  addresses.feeVault,
  ...addresses.tokenVaults,
];
const result = await rpc('getMultipleAccounts', [ordered, { encoding: 'base64', commitment: 'finalized' }]);
if (result.value.length !== ordered.length || result.value.some(account => !account)) {
  throw new Error('One or more required Devnet accounts are missing');
}
const [deployer, worker, program, programData, feeVault, ...tokenVaults] = result.value;
const rentFloor = await rpc('getMinimumBalanceForRentExemption', [Buffer.from(feeVault.data[0], 'base64').length, { commitment: 'finalized' }]);
const feeVaultRecoverable = Math.max(0, feeVault.lamports - rentFloor);
const tokenAmounts = tokenVaults.map(account => {
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 72) throw new Error('Invalid SPL token vault data');
  return data.readBigUInt64LE(64);
});
// Loader v3 closes and drains ProgramData, but intentionally leaves the small
// executable Program account behind as an unrecoverable tombstone.
const programRecoverable = programData.lamports;

console.log(`DEPLOYER_SOL=${sol(deployer.lamports)}`);
console.log(`WORKER_RECOVERABLE_SOL=${sol(worker.lamports)}`);
console.log(`PROGRAM_RECOVERABLE_SOL=${sol(programRecoverable)}`);
console.log(`PROGRAM_TOMBSTONE_SOL=${sol(program.lamports)}`);
console.log(`FEE_VAULT_RECOVERABLE_SOL=${sol(feeVaultRecoverable)}`);
console.log(`TOKEN_VAULT_RAW_AMOUNTS=${tokenAmounts.join(',')}`);
console.log(`IMMEDIATELY_RECOVERABLE_SOL=${sol(worker.lamports + programRecoverable + feeVaultRecoverable)}`);

if (process.argv.includes('--require-empty-vaults')) {
  if (feeVaultRecoverable > 0) {
    throw new Error('Fee vault contains recoverable SOL; pause and run rescue-sol before closing the program');
  }
  if (tokenAmounts.some(amount => amount > 0n)) {
    throw new Error('A token vault is not empty; pause and run rescue-token before closing the program');
  }
  console.log('VAULT_CLOSE_PRECONDITION=PASS');
}

function sol(lamports) {
  return (lamports / 1_000_000_000).toFixed(9);
}
import { rateLimitedRpcFetch } from './request-limits.mjs';
