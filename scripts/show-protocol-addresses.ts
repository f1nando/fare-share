import { address } from '@solana/kit';
import { derivePumpFeeAddresses } from '../server/pump.js';
import { protocolAddresses } from '../server/setup.js';

const programId = address(process.env.TAXI_PROGRAM_ID || 'GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4');
const addresses = await protocolAddresses(programId);
const pump = await derivePumpFeeAddresses(addresses.feeVault);

console.log(JSON.stringify({
  programId: String(programId),
  ...Object.fromEntries(Object.entries(addresses).map(([key, value]) => [key, String(value)])),
  pumpCreator: String(addresses.feeVault),
  pumpBondingCreatorVault: String(pump.bondingCreatorVault),
  pumpAmmCreatorVaultAuthority: String(pump.ammCreatorVaultAuthority),
  pumpWsolDestination: String(pump.creatorWsolAta),
}, null, 2));
