import { address, getProgramDerivedAddress, getUtf8Encoder } from '@solana/kit';

import {
  base64Bytes,
  claimLookupTableAddresses,
  decodeConfiguration,
} from '../src/protocol/anchorClient.js';

const rpcUrl = process.env.SOLANA_RPC_URL || process.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const programAddress = address(
  process.env.TAXI_PROGRAM_ID
  || process.env.VITE_TAXI_PROGRAM_ID
  || '8Z9Mru23DFLJGFsDH7tPAfD289JSC4SABt81rqhrYwxD',
);
const utf8 = getUtf8Encoder();
const [[configAddress], [pool]] = await Promise.all([
  getProgramDerivedAddress({ programAddress, seeds: [utf8.encode('config')] }),
  getProgramDerivedAddress({ programAddress, seeds: [utf8.encode('pool'), utf8.encode('main')] }),
]);

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'claim-lookup-addresses', method, params }),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

const configAccount = await rpc('getAccountInfo', [String(configAddress), {
  commitment: 'finalized',
  encoding: 'base64',
}]);
if (!configAccount.value) throw new Error(`Configuration account ${configAddress} does not exist.`);
const encodedConfig = Array.isArray(configAccount.value.data)
  ? configAccount.value.data[0]
  : configAccount.value.data;
const config = decodeConfiguration(base64Bytes(encodedConfig));
const mints = [config.fareMint, ...config.stockMints];
const mintAccounts = await rpc('getMultipleAccounts', [mints.map(String), {
  commitment: 'finalized',
  encoding: 'base64',
}]);
if (mintAccounts.value.some(value => !value)) throw new Error('One or more configured reward mints do not exist.');
const tokenPrograms = mintAccounts.value.map(value => address(value.owner));
const addresses = await claimLookupTableAddresses({
  programAddress,
  configAddress,
  pool,
  mints,
  tokenPrograms,
});

console.log(addresses.map(String).join(','));
