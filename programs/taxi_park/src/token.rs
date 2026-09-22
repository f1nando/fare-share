use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

use crate::TaxiError;

pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const NATIVE_MINT_ID: Pubkey = pubkey!("So11111111111111111111111111111111111111112");

const MINT_BASE_LEN: usize = 82;
const TOKEN_ACCOUNT_BASE_LEN: usize = 165;
const TOKEN_ACCOUNT_STATE_OFFSET: usize = 108;
const MINT_DECIMALS_OFFSET: usize = 44;
const MINT_INITIALIZED_OFFSET: usize = 45;

const CLOSE_ACCOUNT: u8 = 9;
const TRANSFER_CHECKED: u8 = 12;
const BURN_CHECKED: u8 = 15;
const SYNC_NATIVE: u8 = 17;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MintView {
    pub decimals: u8,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TokenAccountView {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}

pub fn is_supported_program(program: &Pubkey) -> bool {
    *program == TOKEN_PROGRAM_ID || *program == TOKEN_2022_PROGRAM_ID
}

pub fn assert_program(program: &AccountInfo<'_>) -> Result<()> {
    require!(
        is_supported_program(program.key) && program.executable,
        TaxiError::InvalidTokenProgram
    );
    Ok(())
}

pub fn mint_view(mint: &AccountInfo<'_>, token_program: &Pubkey) -> Result<MintView> {
    require!(
        is_supported_program(token_program),
        TaxiError::InvalidTokenProgram
    );
    require_keys_eq!(*mint.owner, *token_program, TaxiError::InvalidTokenProgram);
    let data = mint.try_borrow_data()?;
    parse_mint_data(&data)
}

fn parse_mint_data(data: &[u8]) -> Result<MintView> {
    require!(
        data.len() >= MINT_BASE_LEN && data[MINT_INITIALIZED_OFFSET] == 1,
        TaxiError::InvalidTokenAccount
    );
    Ok(MintView {
        decimals: data[MINT_DECIMALS_OFFSET],
    })
}

pub fn account_view(account: &AccountInfo<'_>, token_program: &Pubkey) -> Result<TokenAccountView> {
    require!(
        is_supported_program(token_program),
        TaxiError::InvalidTokenProgram
    );
    require_keys_eq!(
        *account.owner,
        *token_program,
        TaxiError::InvalidTokenProgram
    );
    let data = account.try_borrow_data()?;
    parse_account_data(&data)
}

fn parse_account_data(data: &[u8]) -> Result<TokenAccountView> {
    require!(
        data.len() >= TOKEN_ACCOUNT_BASE_LEN && data[TOKEN_ACCOUNT_STATE_OFFSET] != 0,
        TaxiError::InvalidTokenAccount
    );
    Ok(TokenAccountView {
        mint: pubkey_at(&data, 0).ok_or(TaxiError::InvalidTokenAccount)?,
        owner: pubkey_at(&data, 32).ok_or(TaxiError::InvalidTokenAccount)?,
        amount: u64_at(&data, 64).ok_or(TaxiError::InvalidTokenAccount)?,
    })
}

pub struct TransferCheckedAccounts<'a, 'info> {
    pub program: &'a AccountInfo<'info>,
    pub source: &'a AccountInfo<'info>,
    pub mint: &'a AccountInfo<'info>,
    pub destination: &'a AccountInfo<'info>,
    pub authority: &'a AccountInfo<'info>,
}

pub fn transfer_checked(
    accounts: TransferCheckedAccounts<'_, '_>,
    amount: u64,
    decimals: u8,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    assert_program(accounts.program)?;
    let instruction = Instruction {
        program_id: accounts.program.key(),
        accounts: vec![
            AccountMeta::new(accounts.source.key(), false),
            AccountMeta::new_readonly(accounts.mint.key(), false),
            AccountMeta::new(accounts.destination.key(), false),
            AccountMeta::new_readonly(accounts.authority.key(), true),
        ],
        data: amount_checked_data(TRANSFER_CHECKED, amount, decimals),
    };
    invoke_signed(
        &instruction,
        &[
            accounts.program.clone(),
            accounts.source.clone(),
            accounts.mint.clone(),
            accounts.destination.clone(),
            accounts.authority.clone(),
        ],
        signer_seeds,
    )?;
    Ok(())
}

pub fn burn_checked<'info>(
    program: &AccountInfo<'info>,
    source: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    assert_program(program)?;
    let instruction = Instruction {
        program_id: program.key(),
        accounts: vec![
            AccountMeta::new(source.key(), false),
            AccountMeta::new(mint.key(), false),
            AccountMeta::new_readonly(authority.key(), true),
        ],
        data: amount_checked_data(BURN_CHECKED, amount, decimals),
    };
    invoke_signed(
        &instruction,
        &[
            program.clone(),
            source.clone(),
            mint.clone(),
            authority.clone(),
        ],
        signer_seeds,
    )?;
    Ok(())
}

pub fn close_account<'info>(
    program: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    assert_program(program)?;
    let instruction = Instruction {
        program_id: program.key(),
        accounts: vec![
            AccountMeta::new(account.key(), false),
            AccountMeta::new(destination.key(), false),
            AccountMeta::new_readonly(authority.key(), true),
        ],
        data: vec![CLOSE_ACCOUNT],
    };
    invoke_signed(
        &instruction,
        &[
            program.clone(),
            account.clone(),
            destination.clone(),
            authority.clone(),
        ],
        signer_seeds,
    )?;
    Ok(())
}

pub fn sync_native<'info>(
    program: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
) -> Result<()> {
    assert_program(program)?;
    require_keys_eq!(
        program.key(),
        TOKEN_PROGRAM_ID,
        TaxiError::InvalidTokenProgram
    );
    let instruction = Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![AccountMeta::new(account.key(), false)],
        data: vec![SYNC_NATIVE],
    };
    invoke_signed(&instruction, &[program.clone(), account.clone()], &[])?;
    Ok(())
}

fn amount_checked_data(discriminator: u8, amount: u64, decimals: u8) -> Vec<u8> {
    let mut data = Vec::with_capacity(10);
    data.push(discriminator);
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);
    data
}

fn pubkey_at(data: &[u8], offset: usize) -> Option<Pubkey> {
    let bytes: [u8; 32] = data.get(offset..offset.checked_add(32)?)?.try_into().ok()?;
    Some(Pubkey::new_from_array(bytes))
}

fn u64_at(data: &[u8], offset: usize) -> Option<u64> {
    let bytes: [u8; 8] = data.get(offset..offset.checked_add(8)?)?.try_into().ok()?;
    Some(u64::from_le_bytes(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_program_pack::Pack;

    #[test]
    fn checked_data_matches_official_token_programs() {
        let source = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let destination = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let amount = 123_456_u64;
        let decimals = 8_u8;

        let legacy = spl_token::instruction::transfer_checked(
            &spl_token::ID,
            &source,
            &mint,
            &destination,
            &authority,
            &[],
            amount,
            decimals,
        )
        .unwrap();
        let token_2022 = spl_token_2022::instruction::transfer_checked(
            &spl_token_2022::ID,
            &source,
            &mint,
            &destination,
            &authority,
            &[],
            amount,
            decimals,
        )
        .unwrap();
        let ours = amount_checked_data(TRANSFER_CHECKED, amount, decimals);
        assert_eq!(legacy.data, ours);
        assert_eq!(token_2022.data, ours);

        let burn = spl_token_2022::instruction::burn_checked(
            &spl_token_2022::ID,
            &source,
            &mint,
            &authority,
            &[],
            amount,
            decimals,
        )
        .unwrap();
        assert_eq!(
            burn.data,
            amount_checked_data(BURN_CHECKED, amount, decimals)
        );
    }

    #[test]
    fn base_views_match_legacy_and_extended_token_2022_layouts() {
        let mint = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let account = spl_token::state::Account {
            mint,
            owner,
            amount: 987_654,
            state: spl_token::state::AccountState::Initialized,
            ..spl_token::state::Account::default()
        };
        let mut legacy_data = vec![0_u8; spl_token::state::Account::LEN];
        spl_token::state::Account::pack(account, &mut legacy_data).unwrap();

        let expected = TokenAccountView {
            mint,
            owner,
            amount: 987_654,
        };
        assert_eq!(parse_account_data(&legacy_data).unwrap(), expected);

        let mut extended_data = vec![0_u8; 683];
        extended_data[..legacy_data.len()].copy_from_slice(&legacy_data);
        assert_eq!(parse_account_data(&extended_data).unwrap(), expected);

        let mint_state = spl_token::state::Mint {
            decimals: 8,
            is_initialized: true,
            ..spl_token::state::Mint::default()
        };
        let mut mint_data = vec![0_u8; spl_token::state::Mint::LEN];
        spl_token::state::Mint::pack(mint_state, &mut mint_data).unwrap();
        assert_eq!(parse_mint_data(&mint_data).unwrap().decimals, 8);
    }
}
