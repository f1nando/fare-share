const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

const addresses = {
  deployer: '2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF',
  worker: 'B9THxQChCdu4hZtKcJf4HRS2Ji2KLBNVt8M7H4jncWy8',
  program: 'FHc9uKp4gwmPi4GpaNScjBMpcdH1WEEBRwfNJgjaHALf',
  programData: '2NeWZA8cWEwrDcQ39f3rYFd9AmnVMWkenh9ahzhvy5ZJ',
  feeVault: 'BwFmLQp5Wpn6SoFVFMend3KfQh2p1NomRm1YJ6n6WdZK',
  tokenVaults: [
    '3nGcCDWtnivvAXJv58keQZtgHgJraZ9ZeR5ZjdKuj3cs',
    '9jXxpk9VyeCFNtCUt9tuamYs7eP18N5TQkHVjxTo4PZ5',
    '2RVCPyho4FcjzV338ccrAY1z1wnmv4wzJLcnioH3FGbU',
    'GWJgEn9zk7Cwp5rqrv5nhmh1TF4VFdiQzA4P5p9ocEHo',
    '5PiSMKFcR2stpKgnHTWhkRMm7wa1sYNaf1jB8fa7D6td',
    'EJrSENUNrs7GaPnj51rbVtJbXbfNBWERjUFiWK6ehsnm',
  ],
};

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
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
