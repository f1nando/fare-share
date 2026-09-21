import {
  address,
  createSolanaRpc,
  getProgramDerivedAddress,
  getUtf8Encoder,
} from '@solana/kit';
import { getWallets } from '@wallet-standard/app';

const env = import.meta.env ?? {};

export const PROGRAM_ID = address(
  env.VITE_TAXI_PROGRAM_ID || '7SpHocA8dThiUTfkv9iv63bhJnzWysk2bFgKbT4WKwnY',
);
export const RPC_URL = env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com';

const rpc = createSolanaRpc(RPC_URL);
const utf8 = getUtf8Encoder();

export async function protocolAddresses() {
  const [[config], [pool], [queue]] = await Promise.all([
    getProgramDerivedAddress({ programAddress: PROGRAM_ID, seeds: [utf8.encode('config')] }),
    getProgramDerivedAddress({ programAddress: PROGRAM_ID, seeds: [utf8.encode('pool'), utf8.encode('main')] }),
    getProgramDerivedAddress({ programAddress: PROGRAM_ID, seeds: [utf8.encode('queue'), utf8.encode('main')] }),
  ]);
  return { config, pool, queue };
}

export async function loadProtocolStatus() {
  const addresses = await protocolAddresses();
  const accounts = await rpc
    .getMultipleAccounts(Object.values(addresses), { commitment: 'finalized', encoding: 'base64' })
    .send();
  return {
    addresses,
    deployed: accounts.value.every(Boolean),
    network: RPC_URL.includes('devnet') ? 'devnet' : 'custom RPC',
  };
}

export async function connectWallet() {
  const wallets = getWallets().get();
  const phantom = wallets.find(wallet => wallet.name.toLowerCase().includes('phantom'));
  if (!phantom) throw new Error('Phantom не найден. Установите расширение или откройте сайт во встроенном браузере Phantom.');
  const connect = phantom.features['standard:connect'];
  if (!connect) throw new Error('Этот кошелёк не поддерживает Wallet Standard connect.');
  const result = await connect.connect();
  const account = result.accounts?.[0] || phantom.accounts?.[0];
  if (!account) throw new Error('Phantom не вернул активный аккаунт.');
  return { wallet: phantom, account };
}

export function shortAddress(value) {
  const text = String(value || '');
  return text.length > 10 ? `${text.slice(0, 4)}…${text.slice(-4)}` : text;
}
