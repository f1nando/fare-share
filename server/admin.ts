import { createHash } from 'node:crypto';
import {
  AccountRole,
  address,
  getAddressEncoder,
  type Address,
  type Instruction,
} from '@solana/kit';

const addressEncoder = getAddressEncoder();

export type SimpleAdminCommand =
  | { name: 'start-sale' | 'pause' | 'unpause' }
  | { name: 'set-mint-prices'; prices: [bigint, bigint, bigint, bigint] }
  | { name: 'propose-admin' | 'set-team' | 'set-backend-signer' | 'set-jupiter'; value: Address }
  | { name: 'accept-admin' };

export function buildSimpleAdminInstruction(
  programId: Address,
  admin: Address,
  config: Address,
  command: SimpleAdminCommand,
): Instruction {
  const anchorName = commandName(command.name);
  let argument = new Uint8Array();
  if (command.name === 'set-mint-prices') argument = concat(...command.prices.map(u64));
  else if ('value' in command) argument = Uint8Array.from(addressEncoder.encode(command.value));
  return {
    programAddress: programId,
    accounts: [
      meta(admin, AccountRole.READONLY_SIGNER),
      meta(config, AccountRole.WRITABLE),
    ],
    data: concat(discriminator(anchorName), argument),
  };
}

export function buildRescueSolInstruction(
  programId: Address,
  admin: Address,
  config: Address,
  feeVault: Address,
  recipient: Address,
  amount: bigint,
): Instruction {
  if (amount <= 0n) throw new Error('Rescue amount must be positive');
  return {
    programAddress: programId,
    accounts: [
      meta(admin, AccountRole.READONLY_SIGNER),
      meta(config, AccountRole.READONLY),
      meta(feeVault, AccountRole.WRITABLE),
      meta(recipient, AccountRole.WRITABLE),
    ],
    data: concat(discriminator('rescue_sol'), u64(amount)),
  };
}

export function buildRescueTokenInstruction(input: {
  programId: Address;
  admin: Address;
  config: Address;
  mint: Address;
  vault: Address;
  destination: Address;
  tokenProgram: Address;
  amount: bigint;
}): Instruction {
  if (input.amount <= 0n) throw new Error('Rescue amount must be positive');
  return {
    programAddress: input.programId,
    accounts: [
      meta(input.admin, AccountRole.READONLY_SIGNER),
      meta(input.config, AccountRole.READONLY),
      meta(input.mint, AccountRole.READONLY),
      meta(input.vault, AccountRole.WRITABLE),
      meta(input.destination, AccountRole.WRITABLE),
      meta(input.tokenProgram, AccountRole.READONLY),
    ],
    data: concat(discriminator('rescue_token'), u64(input.amount)),
  };
}

function commandName(name: SimpleAdminCommand['name']) {
  return ({
    'start-sale': 'start_sale',
    pause: 'pause',
    unpause: 'unpause',
    'set-mint-prices': 'set_mint_prices',
    'propose-admin': 'propose_admin',
    'accept-admin': 'accept_admin',
    'set-team': 'set_team_account',
    'set-backend-signer': 'set_backend_signer',
    'set-jupiter': 'set_jupiter_program',
  } as const)[name];
}

function discriminator(name: string) {
  return Uint8Array.from(createHash('sha256').update(`global:${name}`).digest().subarray(0, 8));
}
function u64(value: bigint) {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new Error('Value does not fit u64');
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, value, true);
  return result;
}
function concat(...parts: readonly Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function meta(value: Address, role: AccountRole) { return { address: value, role }; }
