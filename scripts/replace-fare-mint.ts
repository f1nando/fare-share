import { createFeeAdminService } from '../server/feeAdmin.js';
import { loadServerConfig } from '../server/config.js';
import { connectDatabase } from '../server/database.js';

const [mint, ticker] = process.argv.slice(2);
if (!mint || !ticker) throw new Error('Usage: npm run protocol:replace-fare -- <CA> <TICKER>');
if (!process.argv.includes('--confirm-cash-out')) {
  throw new Error('Pass --confirm-cash-out after verifying the replacement CA and accepting deletion of all current FARE obligations.');
}
const config = loadServerConfig();
if (!config.protocolAdminSecret || !config.pumpFeeRecipientSecret) throw new Error('Admin signer configuration is incomplete.');
const database = await connectDatabase(config.mongoUri, config.mongoDatabase);
try {
  const service = await createFeeAdminService({
    rpcUrl: config.solanaRpcUrl,
    programId: config.programId,
    adminSecret: config.protocolAdminSecret,
    feeRecipientSecret: config.pumpFeeRecipientSecret,
    cluster: config.solanaCluster,
    minimumWalletLamports: config.adminMinimumWalletLamports,
    workerIntervalMs: config.workerIntervalMs,
    jupiterApiKey: config.jupiterApiKey,
    swapSlippageBps: config.swapSlippageBps,
    jupiterMaxAccounts: config.jupiterMaxAccounts,
    jupiterExcludeDexes: config.jupiterExcludeDexes,
  }, database.adminFeeActions, database.adminFeeOperations, database.tokenConfig, database.workerStatus);
  const inspected = await service.inspectMint(mint);
  console.log(`Verified replacement ${inspected.mint}; starting resumable cash-out replacement.`);
  console.log(JSON.stringify(await service.replaceMint(mint, ticker), null, 2));
} finally {
  await database.client.close();
}
