import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type Address,
  type Instruction,
} from '@solana/kit';
import { findAssociatedTokenPda } from '@solana-program/token';

export const PUMP_PROGRAM = address('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMP_AMM_PROGRAM = address('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
export const PUMP_FEE_PROGRAM = address('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
export const WSOL_MINT = address('So11111111111111111111111111111111111111112');
export const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
const PUMP_COLLECT_CREATOR_FEE_V2 = Uint8Array.from([207, 17, 138, 242, 4, 34, 19, 56]);
const PUMP_AMM_COLLECT_COIN_CREATOR_FEE = Uint8Array.from([160, 57, 89, 42, 181, 139, 43, 66]);
const utf8 = getUtf8Encoder();
const addressEncoder = getAddressEncoder();

export interface PumpFeeAddresses {
  creatorWsolAta: Address;
  bondingCreatorVault: Address;
  bondingCreatorVaultWsolAta: Address;
  bondingEventAuthority: Address;
  ammCreatorVaultAuthority: Address;
  ammCreatorVaultWsolAta: Address;
  ammEventAuthority: Address;
}

export async function derivePumpBondingCurve(mint: Address): Promise<Address> {
  return pda(PUMP_PROGRAM, 'bonding-curve', mint);
}

export async function derivePumpFeeSharingConfig(mint: Address): Promise<Address> {
  return pda(PUMP_FEE_PROGRAM, 'sharing-config', mint);
}

export async function derivePumpFeeAddresses(creator: Address): Promise<PumpFeeAddresses> {
  const [
    creatorWsolAta,
    bondingCreatorVault,
    bondingEventAuthority,
    ammCreatorVaultAuthority,
    ammEventAuthority,
  ] = await Promise.all([
    findAssociatedTokenPda({ owner: creator, mint: WSOL_MINT, tokenProgram: TOKEN_PROGRAM }).then(([value]) => value),
    pda(PUMP_PROGRAM, 'creator-vault', creator),
    pda(PUMP_PROGRAM, '__event_authority'),
    pda(PUMP_AMM_PROGRAM, 'creator_vault', creator),
    pda(PUMP_AMM_PROGRAM, '__event_authority'),
  ]);
  const [bondingCreatorVaultWsolAta, ammCreatorVaultWsolAta] = await Promise.all([
    findAssociatedTokenPda({ owner: bondingCreatorVault, mint: WSOL_MINT, tokenProgram: TOKEN_PROGRAM }).then(([value]) => value),
    findAssociatedTokenPda({ owner: ammCreatorVaultAuthority, mint: WSOL_MINT, tokenProgram: TOKEN_PROGRAM }).then(([value]) => value),
  ]);
  return {
    creatorWsolAta,
    bondingCreatorVault,
    bondingCreatorVaultWsolAta,
    bondingEventAuthority,
    ammCreatorVaultAuthority,
    ammCreatorVaultWsolAta,
    ammEventAuthority,
  };
}

export function buildPumpBondingFeeCollection(
  creator: Address,
  addresses: PumpFeeAddresses,
): Instruction {
  return {
    programAddress: PUMP_PROGRAM,
    accounts: [
      meta(creator, AccountRole.WRITABLE),
      meta(addresses.creatorWsolAta, AccountRole.WRITABLE),
      meta(addresses.bondingCreatorVault, AccountRole.WRITABLE),
      meta(addresses.bondingCreatorVaultWsolAta, AccountRole.WRITABLE),
      meta(WSOL_MINT, AccountRole.READONLY),
      meta(TOKEN_PROGRAM, AccountRole.READONLY),
      meta(ASSOCIATED_TOKEN_PROGRAM, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM, AccountRole.READONLY),
      meta(addresses.bondingEventAuthority, AccountRole.READONLY),
      meta(PUMP_PROGRAM, AccountRole.READONLY),
    ],
    data: PUMP_COLLECT_CREATOR_FEE_V2,
  };
}

export function buildPumpAmmFeeCollection(
  creator: Address,
  addresses: PumpFeeAddresses,
): Instruction {
  return {
    programAddress: PUMP_AMM_PROGRAM,
    accounts: [
      meta(WSOL_MINT, AccountRole.READONLY),
      meta(TOKEN_PROGRAM, AccountRole.READONLY),
      meta(creator, AccountRole.READONLY),
      meta(addresses.ammCreatorVaultAuthority, AccountRole.READONLY),
      meta(addresses.ammCreatorVaultWsolAta, AccountRole.WRITABLE),
      meta(addresses.creatorWsolAta, AccountRole.WRITABLE),
      meta(addresses.ammEventAuthority, AccountRole.READONLY),
      meta(PUMP_AMM_PROGRAM, AccountRole.READONLY),
    ],
    data: PUMP_AMM_COLLECT_COIN_CREATOR_FEE,
  };
}

async function pda(programAddress: Address, seed: string, owner?: Address) {
  return (await getProgramDerivedAddress({
    programAddress,
    seeds: [
      utf8.encode(seed),
      ...(owner ? [Uint8Array.from(addressEncoder.encode(owner))] : []),
    ],
  }))[0];
}

function meta(value: Address, role: AccountRole) { return { address: value, role }; }
