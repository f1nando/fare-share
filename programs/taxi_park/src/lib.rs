#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    sysvar::instructions::{load_current_index_checked, load_instruction_at_checked},
};
pub mod error;
pub mod math;
#[path = "core.rs"]
pub mod metaplex_core;
pub mod state;
pub mod swap;
pub mod token;
pub mod voucher;

pub use error::*;
pub use state::*;
pub use swap::{SwapPlan, FARE_SWAP_KIND, STOCK_SWAP_KIND};
pub use voucher::ActivateTraineeArgs;

declare_id!("H7X7Ky8q6mvEdeDLikx6fPGAyjjHywR74W53DyXZJrsY");

#[program]
pub mod taxi_park {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        validate_initial_addresses(&args)?;
        require!(
            !args.collection_name.is_empty()
                && args.collection_name.len() <= MAX_COLLECTION_NAME_LEN
                && !args.collection_uri.is_empty()
                && args.collection_uri.len() <= MAX_METADATA_URI_LEN,
            TaxiError::InvalidMetadataUri
        );
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.backend_signer = args.backend_signer;
        config.team_account = args.team_account;
        config.jupiter_program = args.jupiter_program;
        config.deployment_id = args.deployment_id;
        config.collection = ctx.accounts.collection.key();
        config.fare_mint = Pubkey::default();
        config.stock_mints = args.stock_mints;
        config.metadata_uris = std::array::from_fn(|_| String::new());
        config.mint_prices = args.mint_prices;
        config.sale_started = false;
        config.paused_at = 0;
        config.total_paused_seconds = 0;
        config.bump = ctx.bumps.config;

        let pool = &mut ctx.accounts.pool;
        pool.calculated_until = now;
        pool.bump = ctx.bumps.pool;

        let trainee_pool = &mut ctx.accounts.trainee_pool;
        trainee_pool.calculated_until = now;
        trainee_pool.bump = ctx.bumps.trainee_pool;

        let queue = &mut ctx.accounts.queue;
        queue.pages = vec![PageCursor::default(); MAX_QUEUE_PAGES];
        queue.next_event_number = 1;
        queue.bump = ctx.bumps.queue;
        ctx.accounts.trainee_queue.pages = vec![PageCursor::default(); MAX_QUEUE_PAGES];
        ctx.accounts.trainee_queue.next_event_number = 1;
        ctx.accounts.trainee_queue.bump = ctx.bumps.trainee_queue;
        ctx.accounts.fee_vault.bump = ctx.bumps.fee_vault;

        let instruction = metaplex_core::create_collection_v2(
            ctx.accounts.collection.key(),
            ctx.accounts.admin.key(),
            config.key(),
            ctx.accounts.admin.key(),
            ctx.accounts.system_program.key(),
            &args.collection_name,
            &args.collection_uri,
        )?;
        anchor_lang::solana_program::program::invoke(
            &instruction,
            &[
                ctx.accounts.mpl_core_program.to_account_info(),
                ctx.accounts.collection.to_account_info(),
                ctx.accounts.admin.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
        Ok(())
    }

    pub fn set_mint_prices(ctx: Context<AdminState>, prices: [u64; CLASS_COUNT]) -> Result<()> {
        require!(
            !ctx.accounts.config.sale_started,
            TaxiError::SaleAlreadyStarted
        );
        require!(
            prices.iter().all(|price| *price > 0),
            TaxiError::InvalidPrice
        );
        ctx.accounts.config.mint_prices = prices;
        Ok(())
    }

    pub fn set_metadata_uris(
        ctx: Context<AdminState>,
        class: u8,
        metadata_uris: [String; VARIANTS_PER_CLASS],
    ) -> Result<()> {
        let class_index = usize::from(class);
        require!(class_index < CLASS_COUNT, TaxiError::InvalidClass);
        require!(
            metadata_uris
                .iter()
                .enumerate()
                .all(|(index, uri)| {
                    !uri.is_empty()
                        && uri.len() <= MAX_METADATA_URI_LEN
                        && metadata_uris[..index]
                            .iter()
                            .all(|previous| previous != uri)
                }),
            TaxiError::InvalidMetadataUri
        );
        let start = metadata_uri_index(class_index, 0)?;
        if ctx.accounts.config.sale_started {
            require!(
                ctx.accounts.config.metadata_uris[start..start + VARIANTS_PER_CLASS]
                    == metadata_uris[..],
                TaxiError::SaleAlreadyStarted
            );
            return Ok(());
        }
        for (offset, uri) in metadata_uris.into_iter().enumerate() {
            ctx.accounts.config.metadata_uris[start + offset] = uri;
        }
        Ok(())
    }

    pub fn set_fare_mint(ctx: Context<SetFareMint>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let fare_mint = ctx.accounts.fare_mint.key();
        validate_fare_assignment(config, fare_mint)?;
        validate_pump_fee_recipient(
            fare_mint,
            &ctx.accounts.fee_recipient.key(),
            &ctx.accounts.bonding_curve,
            &ctx.accounts.fee_sharing_config,
        )?;
        let config_key = config.key();
        let token_program_key = ctx.accounts.token_program.key();
        token::assert_program(&ctx.accounts.token_program)?;
        token::mint_view(&ctx.accounts.fare_mint, &token_program_key)?;
        let expected_vault = Pubkey::find_program_address(
            &[config_key.as_ref(), token_program_key.as_ref(), fare_mint.as_ref()],
            &token::ASSOCIATED_TOKEN_PROGRAM_ID,
        )
        .0;
        require_keys_eq!(
            ctx.accounts.fare_vault.key(),
            expected_vault,
            TaxiError::InvalidTokenAccount
        );
        let vault = token::account_view(&ctx.accounts.fare_vault, &token_program_key)?;
        require_keys_eq!(vault.mint, fare_mint, TaxiError::InvalidTokenAccount);
        require_keys_eq!(vault.owner, config_key, TaxiError::InvalidTokenAccount);
        config.fare_mint = fare_mint;
        Ok(())
    }

    pub fn start_sale(ctx: Context<AdminState>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.sale_started, TaxiError::SaleAlreadyStarted);
        require_fare_ready(config.fare_mint)?;
        require!(
            config.mint_prices.iter().all(|price| *price > 0),
            TaxiError::InvalidPrice
        );
        require!(
            metadata_uris_are_valid(&config.metadata_uris),
            TaxiError::InvalidMetadataUri
        );
        config.sale_started = true;
        Ok(())
    }

    pub fn pause(ctx: Context<AdminState>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.is_paused(), TaxiError::AlreadyPaused);
        config.paused_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminState>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let config = &mut ctx.accounts.config;
        require!(config.is_paused(), TaxiError::NotPaused);
        let paused = now
            .checked_sub(config.paused_at)
            .ok_or(TaxiError::MathOverflow)?;
        config.total_paused_seconds = config
            .total_paused_seconds
            .checked_add(paused)
            .ok_or(TaxiError::MathOverflow)?;
        config.paused_at = 0;
        Ok(())
    }

    pub fn propose_admin(ctx: Context<AdminState>, pending_admin: Pubkey) -> Result<()> {
        require!(pending_admin != Pubkey::default(), TaxiError::InvalidAdmin);
        ctx.accounts.config.pending_admin = pending_admin;
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require_keys_eq!(
            config.pending_admin,
            ctx.accounts.pending_admin.key(),
            TaxiError::Unauthorized
        );
        config.admin = config.pending_admin;
        config.pending_admin = Pubkey::default();
        Ok(())
    }

    pub fn set_team_account(ctx: Context<AdminState>, team_account: Pubkey) -> Result<()> {
        require!(
            team_account != Pubkey::default(),
            TaxiError::InvalidTeamAccount
        );
        ctx.accounts.config.team_account = team_account;
        Ok(())
    }

    pub fn set_backend_signer(ctx: Context<AdminState>, backend_signer: Pubkey) -> Result<()> {
        require!(
            backend_signer != Pubkey::default(),
            TaxiError::InvalidBackendSigner
        );
        ctx.accounts.config.backend_signer = backend_signer;
        Ok(())
    }

    pub fn set_jupiter_program(ctx: Context<AdminState>, jupiter_program: Pubkey) -> Result<()> {
        require!(ctx.accounts.config.is_paused(), TaxiError::NotPaused);
        require!(
            jupiter_program != Pubkey::default(),
            TaxiError::InvalidJupiterProgram
        );
        ctx.accounts.config.jupiter_program = jupiter_program;
        Ok(())
    }

    pub fn rescue_sol(ctx: Context<RescueSol>, amount: u64) -> Result<()> {
        require!(ctx.accounts.config.is_paused(), TaxiError::NotPaused);
        let vault_info = ctx.accounts.fee_vault.to_account_info();
        let rent_floor = Rent::get()?.minimum_balance(vault_info.data_len());
        let available = vault_info
            .lamports()
            .checked_sub(rent_floor)
            .ok_or(TaxiError::VaultBalanceMismatch)?;
        require!(
            amount > 0 && amount <= available,
            TaxiError::InvalidRescueAmount
        );
        let recipient_after = ctx
            .accounts
            .recipient
            .lamports()
            .checked_add(amount)
            .ok_or(TaxiError::MathOverflow)?;
        let vault_after = vault_info
            .lamports()
            .checked_sub(amount)
            .ok_or(TaxiError::MathOverflow)?;
        **vault_info.try_borrow_mut_lamports()? = vault_after;
        **ctx.accounts.recipient.try_borrow_mut_lamports()? = recipient_after;
        ctx.accounts.fee_vault.consume_reserves_for_rescue(amount)?;
        emit!(AssetRescued {
            mint: Pubkey::default(),
            recipient: ctx.accounts.recipient.key(),
            amount
        });
        Ok(())
    }

    pub fn rescue_token(ctx: Context<RescueToken>, amount: u64) -> Result<()> {
        require!(ctx.accounts.config.is_paused(), TaxiError::NotPaused);
        token::assert_program(&ctx.accounts.token_program)?;
        let mint = token::mint_view(&ctx.accounts.mint, &ctx.accounts.token_program.key())?;
        let vault = token::account_view(&ctx.accounts.vault, &ctx.accounts.token_program.key())?;
        let destination =
            token::account_view(&ctx.accounts.destination, &ctx.accounts.token_program.key())?;
        require!(
            amount > 0 && amount <= vault.amount,
            TaxiError::InvalidRescueAmount
        );
        require_keys_eq!(
            vault.mint,
            ctx.accounts.mint.key(),
            TaxiError::InvalidTokenAccount
        );
        require_keys_eq!(
            vault.owner,
            ctx.accounts.config.key(),
            TaxiError::InvalidTokenAccount
        );
        require_keys_eq!(
            destination.mint,
            ctx.accounts.mint.key(),
            TaxiError::InvalidTokenAccount
        );
        let bump = [ctx.accounts.config.bump];
        let seeds: &[&[u8]] = &[b"config", &bump];
        token::transfer_checked(
            token::TransferCheckedAccounts {
                program: &ctx.accounts.token_program,
                source: &ctx.accounts.vault,
                mint: &ctx.accounts.mint,
                destination: &ctx.accounts.destination,
                authority: &ctx.accounts.config.to_account_info(),
            },
            amount,
            mint.decimals,
            &[seeds],
        )?;
        emit!(AssetRescued {
            mint: ctx.accounts.mint.key(),
            recipient: ctx.accounts.destination.key(),
            amount
        });
        Ok(())
    }

    pub fn collect_fees(ctx: Context<CollectFees>) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        require_keys_eq!(
            ctx.accounts.config.team_account,
            ctx.accounts.team_account.key(),
            TaxiError::InvalidTeamAccount
        );

        let vault_info = ctx.accounts.fee_vault.to_account_info();
        let rent_floor = Rent::get()?.minimum_balance(vault_info.data_len());
        let reserved = ctx.accounts.fee_vault.total_reserved()?;
        let available = vault_info
            .lamports()
            .checked_sub(rent_floor)
            .and_then(|value| value.checked_sub(reserved))
            .ok_or(TaxiError::VaultBalanceMismatch)?;
        require!(available > 0, TaxiError::NothingToCollect);

        let team_amount = available / 10;
        let mut fare_amount = math::mul_div_u64(available, 70, 100)?;
        let stock_amount = math::mul_div_u64(available, 5, 100)?;
        let assigned = team_amount
            .checked_add(fare_amount)
            .and_then(|value| value.checked_add(stock_amount.checked_mul(STOCK_COUNT as u64)?))
            .ok_or(TaxiError::MathOverflow)?;
        fare_amount = fare_amount
            .checked_add(
                available
                    .checked_sub(assigned)
                    .ok_or(TaxiError::MathOverflow)?,
            )
            .ok_or(TaxiError::MathOverflow)?;

        ctx.accounts.fee_vault.fare_sol_reserve = ctx
            .accounts
            .fee_vault
            .fare_sol_reserve
            .checked_add(fare_amount)
            .ok_or(TaxiError::MathOverflow)?;
        for reserve in &mut ctx.accounts.fee_vault.stock_sol_reserves {
            *reserve = reserve
                .checked_add(stock_amount)
                .ok_or(TaxiError::MathOverflow)?;
        }

        if team_amount > 0 {
            let vault_after = vault_info
                .lamports()
                .checked_sub(team_amount)
                .ok_or(TaxiError::MathOverflow)?;
            let team_after = ctx
                .accounts
                .team_account
                .lamports()
                .checked_add(team_amount)
                .ok_or(TaxiError::MathOverflow)?;
            **vault_info.try_borrow_mut_lamports()? = vault_after;
            **ctx.accounts.team_account.try_borrow_mut_lamports()? = team_after;
        }

        emit!(FeesCollected {
            total: available,
            fare_reserve: fare_amount,
            stock_reserve_each: stock_amount,
            team_amount
        });
        Ok(())
    }

    pub fn absorb_pump_wsol_fees(ctx: Context<AbsorbPumpWsolFees>) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        token::assert_program(&ctx.accounts.token_program)?;
        let pump_vault = token::account_view(
            &ctx.accounts.pump_wsol_vault,
            &ctx.accounts.token_program.key(),
        )?;
        if (pump_vault.owner == ctx.accounts.config.key()
            || pump_vault.owner == ctx.accounts.caller.key())
            && pump_vault.amount == 0
            && ctx.remaining_accounts.is_empty()
        {
            let bump = [ctx.accounts.config.bump];
            let config_seeds: &[&[u8]] = &[b"config", &bump];
            let signed = [config_seeds];
            let signer_seeds: &[&[&[u8]]] = if pump_vault.owner == ctx.accounts.config.key() {
                &signed
            } else {
                &[]
            };
            let authority = if pump_vault.owner == ctx.accounts.config.key() {
                ctx.accounts.config.to_account_info()
            } else {
                ctx.accounts.caller.to_account_info()
            };
            return token::close_account(
                &ctx.accounts.token_program,
                &ctx.accounts.pump_wsol_vault,
                &ctx.accounts.fee_vault.to_account_info(),
                &authority,
                signer_seeds,
            );
        }
        require_keys_eq!(pump_vault.mint, token::NATIVE_MINT_ID, TaxiError::InvalidRewardMint);
        if (pump_vault.owner == ctx.accounts.config.key()
            || pump_vault.owner == ctx.accounts.caller.key())
            && !ctx.remaining_accounts.is_empty()
        {
            let instructions = ctx
                .remaining_accounts
                .first()
                .ok_or(TaxiError::InvalidSwapPlan)?;
            require_keys_eq!(
                instructions.key(),
                anchor_lang::solana_program::sysvar::instructions::ID,
                TaxiError::InvalidSwapPlan
            );
            let (kind, asset_index, amount_in) = following_swap_funding(
                instructions,
                ctx.program_id,
                &ctx.accounts.pump_wsol_vault.key(),
            )?;
            let reserve = if kind == FARE_SWAP_KIND && asset_index == 0 {
                require!(ctx.accounts.config.sale_started, TaxiError::SaleNotStarted);
                ctx.accounts.fee_vault.fare_sol_reserve
            } else {
                let stock_index = usize::from(asset_index);
                require!(kind == STOCK_SWAP_KIND && stock_index < STOCK_COUNT, TaxiError::InvalidSwapPlan);
                ctx.accounts.fee_vault.stock_sol_reserves[stock_index]
            };
            require!(amount_in > 0 && amount_in <= reserve, TaxiError::InvalidSwapInput);
            return move_lamports_to_wsol(
                &ctx.accounts.fee_vault.to_account_info(),
                &ctx.accounts.pump_wsol_vault.to_account_info(),
                amount_in,
            );
        }
        require_keys_eq!(
            pump_vault.owner,
            ctx.accounts.fee_vault.key(),
            TaxiError::InvalidTokenAccount
        );
        let amount = pump_vault.amount;
        require!(amount > 0, TaxiError::NothingToCollect);
        let rent_refund =
            Rent::get()?.minimum_balance(ctx.accounts.pump_wsol_vault.to_account_info().data_len());

        let bump = [ctx.accounts.fee_vault.bump];
        let seeds: &[&[u8]] = &[b"fees", &bump];
        token::close_account(
            &ctx.accounts.token_program,
            &ctx.accounts.pump_wsol_vault,
            &ctx.accounts.fee_vault.to_account_info(),
            &ctx.accounts.fee_vault.to_account_info(),
            &[seeds],
        )?;

        let fee_vault_after = ctx
            .accounts
            .fee_vault
            .to_account_info()
            .lamports()
            .checked_sub(rent_refund)
            .ok_or(TaxiError::MathOverflow)?;
        let caller_after = ctx
            .accounts
            .caller
            .to_account_info()
            .lamports()
            .checked_add(rent_refund)
            .ok_or(TaxiError::MathOverflow)?;
        **ctx
            .accounts
            .fee_vault
            .to_account_info()
            .try_borrow_mut_lamports()? = fee_vault_after;
        **ctx
            .accounts
            .caller
            .to_account_info()
            .try_borrow_mut_lamports()? = caller_after;

        emit!(PumpWsolFeesAbsorbed { amount });
        Ok(())
    }

    pub fn process_fare_swap<'info>(
        ctx: Context<'_, '_, 'info, 'info, ProcessFareSwap<'info>>,
        plan: SwapPlan,
        route_data: Vec<u8>,
    ) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        require!(ctx.accounts.config.sale_started, TaxiError::SaleNotStarted);
        require!(
            plan.kind == FARE_SWAP_KIND && plan.asset_index == 0,
            TaxiError::InvalidSwapPlan
        );
        require!(
            plan.nonce == ctx.accounts.config.fare_swap_nonce,
            TaxiError::InvalidSwapNonce
        );
        require!(
            Clock::get()?.unix_timestamp <= plan.deadline,
            TaxiError::SwapPlanExpired
        );
        require!(
            plan.amount_in > 0 && plan.amount_in <= ctx.accounts.fee_vault.fare_sol_reserve,
            TaxiError::InvalidSwapInput
        );
        require!(plan.min_out > 0, TaxiError::InsufficientSwapOutput);
        require!(
            swap::route_hash(
                &route_data,
                ctx.remaining_accounts,
                &ctx.accounts.config.key()
            ) == plan.route_hash,
            TaxiError::InvalidSwapRoute
        );
        verify_swap_plan_signature(
            &ctx.accounts.instructions,
            ctx.program_id,
            &ctx.accounts.config,
            &plan,
        )?;
        require_route_accounts(
            ctx.remaining_accounts,
            &ctx.accounts.config.key(),
            &ctx.accounts.wsol_vault.key(),
            &ctx.accounts.reward_vault.key(),
            false,
        )?;

        token::assert_program(&ctx.accounts.token_program)?;
        token::assert_program(&ctx.accounts.fare_token_program)?;
        let fare_mint = token::mint_view(
            &ctx.accounts.fare_mint,
            &ctx.accounts.fare_token_program.key(),
        )?;
        let wsol =
            token::account_view(&ctx.accounts.wsol_vault, &ctx.accounts.token_program.key())?;
        require_keys_eq!(
            wsol.mint,
            token::NATIVE_MINT_ID,
            TaxiError::InvalidRewardMint
        );
        require_keys_eq!(
            wsol.owner,
            ctx.accounts.caller.key(),
            TaxiError::InvalidTokenAccount
        );
        let output = token::account_view(
            &ctx.accounts.reward_vault,
            &ctx.accounts.fare_token_program.key(),
        )?;
        require_keys_eq!(
            output.mint,
            ctx.accounts.fare_mint.key(),
            TaxiError::InvalidTokenAccount
        );
        require_keys_eq!(
            output.owner,
            ctx.accounts.config.key(),
            TaxiError::InvalidTokenAccount
        );

        token::sync_native(
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.wsol_vault.to_account_info(),
        )?;
        let source_before =
            token::account_view(&ctx.accounts.wsol_vault, &ctx.accounts.token_program.key())?
                .amount;
        let output_before = output.amount;
        invoke_jupiter(
            &ctx.accounts.config,
            &ctx.accounts.caller,
            &ctx.accounts.jupiter_program,
            ctx.remaining_accounts,
            route_data,
        )?;
        let source_after = token::account_amount_or_zero(
            &ctx.accounts.wsol_vault,
            &ctx.accounts.token_program.key(),
        )?;
        let output_after = token::account_view(
            &ctx.accounts.reward_vault,
            &ctx.accounts.fare_token_program.key(),
        )?
        .amount;
        let spent = source_before
            .checked_sub(source_after)
            .ok_or(TaxiError::InvalidSwapInput)?;
        require!(spent == plan.amount_in, TaxiError::InvalidSwapInput);
        let received = output_after
            .checked_sub(output_before)
            .ok_or(TaxiError::InsufficientSwapOutput)?;
        require!(received >= plan.min_out, TaxiError::InsufficientSwapOutput);

        let (main_amount, trainee_amount, burn_amount) = math::fare_swap_split(received)?;
        if burn_amount > 0 {
            let bump = [ctx.accounts.config.bump];
            let seeds: &[&[u8]] = &[b"config", &bump];
            token::burn_checked(
                &ctx.accounts.fare_token_program,
                &ctx.accounts.reward_vault,
                &ctx.accounts.fare_mint,
                &ctx.accounts.config.to_account_info(),
                burn_amount,
                fare_mint.decimals,
                &[seeds],
            )?;
        }

        ctx.accounts.pool.next_pool[0] = ctx.accounts.pool.next_pool[0]
            .checked_add(main_amount)
            .ok_or(TaxiError::MathOverflow)?;
        ctx.accounts.trainee_pool.next_pool[0] = ctx.accounts.trainee_pool.next_pool[0]
            .checked_add(trainee_amount)
            .ok_or(TaxiError::MathOverflow)?;
        ctx.accounts.fee_vault.fare_sol_reserve = ctx
            .accounts
            .fee_vault
            .fare_sol_reserve
            .checked_sub(plan.amount_in)
            .ok_or(TaxiError::MathOverflow)?;
        ctx.accounts.config.fare_swap_nonce = ctx
            .accounts
            .config
            .fare_swap_nonce
            .checked_add(1)
            .ok_or(TaxiError::MathOverflow)?;
        emit!(FareSwapProcessed {
            nonce: plan.nonce,
            sol_in: plan.amount_in,
            fare_out: received,
            main_amount,
            trainee_amount,
            burned_amount: burn_amount,
        });
        Ok(())
    }

    pub fn process_stock_swap<'info>(
        ctx: Context<'_, '_, 'info, 'info, ProcessStockSwap<'info>>,
        plan: SwapPlan,
        route_data: Vec<u8>,
    ) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        let stock_index = usize::from(plan.asset_index);
        require!(
            plan.kind == STOCK_SWAP_KIND && stock_index < STOCK_COUNT,
            TaxiError::InvalidSwapPlan
        );
        require!(
            plan.nonce == ctx.accounts.config.stock_swap_nonces[stock_index],
            TaxiError::InvalidSwapNonce
        );
        require!(
            Clock::get()?.unix_timestamp <= plan.deadline,
            TaxiError::SwapPlanExpired
        );
        require!(
            plan.amount_in > 0
                && plan.amount_in <= ctx.accounts.fee_vault.stock_sol_reserves[stock_index],
            TaxiError::InvalidSwapInput
        );
        require!(plan.min_out > 0, TaxiError::InsufficientSwapOutput);
        require_keys_eq!(
            ctx.accounts.config.stock_mints[stock_index],
            ctx.accounts.stock_mint.key(),
            TaxiError::InvalidRewardMint
        );
        require!(
            swap::route_hash(
                &route_data,
                ctx.remaining_accounts,
                &ctx.accounts.config.key()
            ) == plan.route_hash,
            TaxiError::InvalidSwapRoute
        );
        verify_swap_plan_signature(
            &ctx.accounts.instructions,
            ctx.program_id,
            &ctx.accounts.config,
            &plan,
        )?;
        require_route_accounts(
            ctx.remaining_accounts,
            &ctx.accounts.config.key(),
            &ctx.accounts.wsol_vault.key(),
            &ctx.accounts.reward_vault.key(),
            false,
        )?;

        token::assert_program(&ctx.accounts.token_program)?;
        token::assert_program(&ctx.accounts.stock_token_program)?;
        token::mint_view(
            &ctx.accounts.stock_mint,
            &ctx.accounts.stock_token_program.key(),
        )?;
        let wsol =
            token::account_view(&ctx.accounts.wsol_vault, &ctx.accounts.token_program.key())?;
        require_keys_eq!(
            wsol.mint,
            token::NATIVE_MINT_ID,
            TaxiError::InvalidRewardMint
        );
        require_keys_eq!(
            wsol.owner,
            ctx.accounts.caller.key(),
            TaxiError::InvalidTokenAccount
        );
        let output = token::account_view(
            &ctx.accounts.reward_vault,
            &ctx.accounts.stock_token_program.key(),
        )?;
        require_keys_eq!(
            output.mint,
            ctx.accounts.stock_mint.key(),
            TaxiError::InvalidTokenAccount
        );
        require_keys_eq!(
            output.owner,
            ctx.accounts.config.key(),
            TaxiError::InvalidTokenAccount
        );

        token::sync_native(
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.wsol_vault.to_account_info(),
        )?;
        let source_before =
            token::account_view(&ctx.accounts.wsol_vault, &ctx.accounts.token_program.key())?
                .amount;
        let output_before = output.amount;
        invoke_jupiter(
            &ctx.accounts.config,
            &ctx.accounts.caller,
            &ctx.accounts.jupiter_program,
            ctx.remaining_accounts,
            route_data,
        )?;
        let source_after = token::account_amount_or_zero(
            &ctx.accounts.wsol_vault,
            &ctx.accounts.token_program.key(),
        )?;
        let output_after = token::account_view(
            &ctx.accounts.reward_vault,
            &ctx.accounts.stock_token_program.key(),
        )?
        .amount;
        let spent = source_before
            .checked_sub(source_after)
            .ok_or(TaxiError::InvalidSwapInput)?;
        require!(spent == plan.amount_in, TaxiError::InvalidSwapInput);
        let received = output_after
            .checked_sub(output_before)
            .ok_or(TaxiError::InsufficientSwapOutput)?;
        require!(received >= plan.min_out, TaxiError::InsufficientSwapOutput);

        let asset_index = stock_index + 1;
        ctx.accounts.pool.next_pool[asset_index] = ctx.accounts.pool.next_pool[asset_index]
            .checked_add(received)
            .ok_or(TaxiError::MathOverflow)?;
        ctx.accounts.fee_vault.stock_sol_reserves[stock_index] =
            ctx.accounts.fee_vault.stock_sol_reserves[stock_index]
                .checked_sub(plan.amount_in)
                .ok_or(TaxiError::MathOverflow)?;
        ctx.accounts.config.stock_swap_nonces[stock_index] = ctx.accounts.config.stock_swap_nonces
            [stock_index]
            .checked_add(1)
            .ok_or(TaxiError::MathOverflow)?;
        emit!(StockSwapProcessed {
            stock_index: plan.asset_index,
            nonce: plan.nonce,
            sol_in: plan.amount_in,
            tokens_out: received,
        });
        Ok(())
    }

    pub fn mint_machine(ctx: Context<MintMachine>, class: u8, page_index: u8) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        require!(ctx.accounts.config.sale_started, TaxiError::SaleNotStarted);
        require!(
            usize::from(page_index) < MAX_QUEUE_PAGES,
            TaxiError::InvalidQueuePage
        );
        require!(
            ctx.accounts.event_page.events.len() + 2 <= EVENTS_PER_PAGE,
            TaxiError::EventPageCapacity
        );

        let class_index = usize::from(class);
        let (weight, cap) = class_terms(class)?;
        let minted = ctx.accounts.config.minted_by_class[class_index];
        let price = ctx.accounts.config.mint_prices[class_index];
        let (serial, variant) = next_mint_selection(minted, cap)?;
        let name = format!("FARE {} #{:04}", class_name(class)?, serial);
        let uri = ctx
            .accounts
            .config
            .metadata_uri(class_index, usize::from(variant))?
            .to_owned();

        let payment = anchor_lang::system_program::Transfer {
            from: ctx.accounts.owner.to_account_info(),
            to: ctx.accounts.team_account.to_account_info(),
        };
        anchor_lang::system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), payment),
            price,
        )?;

        let config_info = ctx.accounts.config.to_account_info();
        let config_bump = [ctx.accounts.config.bump];
        let config_seeds: &[&[u8]] = &[b"config", &config_bump];
        metaplex_core::assert_collection(
            &ctx.accounts.collection,
            &[ctx.accounts.config.key(), ctx.accounts.config.admin],
        )?;
        let instruction = metaplex_core::create_asset_v1(metaplex_core::CreateAsset {
            asset: ctx.accounts.asset.key(),
            collection: ctx.accounts.collection.key(),
            authority: ctx.accounts.config.key(),
            payer: ctx.accounts.owner.key(),
            owner: ctx.accounts.owner.key(),
            system_program: ctx.accounts.system_program.key(),
            name: &name,
            uri: &uri,
        })?;
        invoke_signed(
            &instruction,
            &[
                ctx.accounts.mpl_core_program.to_account_info(),
                ctx.accounts.asset.to_account_info(),
                ctx.accounts.collection.to_account_info(),
                config_info,
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[config_seeds],
        )?;

        let now = ctx
            .accounts
            .config
            .protocol_time(Clock::get()?.unix_timestamp)?;
        ctx.accounts.config.minted_by_class[class_index] = serial;
        initialize_machine_and_events(
            &mut ctx.accounts.machine,
            &mut ctx.accounts.queue,
            &mut ctx.accounts.event_page,
            ctx.accounts.asset.key(),
            weight,
            now,
            page_index,
            ctx.bumps.machine,
            ctx.bumps.event_page,
        )?;

        emit!(MachineMinted {
            asset: ctx.accounts.asset.key(),
            owner: ctx.accounts.owner.key(),
            class,
            variant,
            serial,
            weight,
            active_until: ctx.accounts.machine.active_until,
            paid_lamports: price,
        });
        Ok(())
    }

    pub fn repair(ctx: Context<RepairMachine>, page_index: u8) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        require!(!ctx.accounts.machine.closed, TaxiError::MachineClosed);
        metaplex_core::assert_asset(
            &ctx.accounts.asset,
            &ctx.accounts.owner.key(),
            &ctx.accounts.config.collection,
        )?;
        require!(
            usize::from(page_index) < MAX_QUEUE_PAGES,
            TaxiError::InvalidQueuePage
        );
        require!(
            ctx.accounts.event_page.events.len() + 2 <= EVENTS_PER_PAGE,
            TaxiError::EventPageCapacity
        );

        let now = ctx
            .accounts
            .config
            .protocol_time(Clock::get()?.unix_timestamp)?;
        ctx.accounts.machine.settle(&ctx.accounts.pool, true)?;
        let remaining = ctx
            .accounts
            .machine
            .active_until
            .saturating_sub(now)
            .clamp(0, MAX_DURABILITY_SECONDS);
        let missing = MAX_DURABILITY_SECONDS
            .checked_sub(remaining)
            .ok_or(TaxiError::MathOverflow)?;
        require!(missing > 0, TaxiError::NothingToRepair);
        let cost = math::repair_cost(ctx.accounts.machine.fare_base)?;

        token::assert_program(&ctx.accounts.fare_token_program)?;
        let fare_mint = token::mint_view(
            &ctx.accounts.fare_mint,
            &ctx.accounts.fare_token_program.key(),
        )?;

        if cost > 0 {
            let owner_fare_info = ctx.accounts.owner_fare_account.to_account_info();
            let owner_fare =
                token::account_view(&owner_fare_info, &ctx.accounts.fare_token_program.key())?;
            require_keys_eq!(
                owner_fare.mint,
                ctx.accounts.fare_mint.key(),
                TaxiError::InvalidTokenAccount
            );
            require_keys_eq!(
                owner_fare.owner,
                ctx.accounts.owner.key(),
                TaxiError::InvalidTokenAccount
            );
            token::burn_checked(
                &ctx.accounts.fare_token_program,
                &owner_fare_info,
                &ctx.accounts.fare_mint,
                &ctx.accounts.owner.to_account_info(),
                cost,
                fare_mint.decimals,
                &[],
            )?;
        }

        let generation = ctx
            .accounts
            .machine
            .scheduled_generation
            .checked_add(1)
            .ok_or(TaxiError::MathOverflow)?;
        let active_until = now
            .checked_add(MAX_DURABILITY_SECONDS)
            .ok_or(TaxiError::MathOverflow)?;
        ctx.accounts.machine.fare_base = 0;
        ctx.accounts.machine.scheduled_generation = generation;
        ctx.accounts.machine.active_until = active_until;

        let page = &mut ctx.accounts.event_page;
        if page.events.is_empty() {
            page.index = page_index;
            page.bump = ctx.bumps.event_page;
        }
        require!(page.index == page_index, TaxiError::InvalidQueuePage);
        let activate_number = ctx.accounts.queue.take_event_number()?;
        let expire_number = ctx.accounts.queue.take_event_number()?;
        page.push(MachineEvent::new(
            now,
            activate_number,
            ctx.accounts.machine.asset,
            EventKind::Activate,
            generation,
        ))?;
        page.push(MachineEvent::new(
            active_until,
            expire_number,
            ctx.accounts.machine.asset,
            EventKind::Expire,
            generation,
        ))?;
        ctx.accounts.queue.update_page(page)?;

        emit!(MachineRepaired {
            asset: ctx.accounts.machine.asset,
            owner: ctx.accounts.owner.key(),
            cost,
            missing_seconds: missing,
            active_until,
            generation,
        });
        Ok(())
    }

    pub fn cleanup_burned_machine(
        ctx: Context<CleanupBurnedMachine>,
        page_index: u8,
    ) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        require!(!ctx.accounts.machine.closed, TaxiError::MachineClosed);
        require!(
            usize::from(page_index) < MAX_QUEUE_PAGES,
            TaxiError::InvalidQueuePage
        );
        require!(
            ctx.accounts.event_page.events.len() < EVENTS_PER_PAGE,
            TaxiError::EventPageCapacity
        );

        let asset_info = ctx.accounts.asset.to_account_info();
        let asset_data = asset_info.try_borrow_data()?;
        let fully_closed = asset_info.lamports() == 0 && asset_data.is_empty();
        let core_uninitialized = asset_info.owner == &metaplex_core::MPL_CORE_ID
            && asset_data.as_ref() == [0];
        require!(
            fully_closed || core_uninitialized,
            TaxiError::AssetNotBurned
        );

        let now = ctx
            .accounts
            .config
            .protocol_time(Clock::get()?.unix_timestamp)?;
        ctx.accounts.machine.closed = true;
        ctx.accounts.machine.active_until = now;

        let page = &mut ctx.accounts.event_page;
        if page.events.is_empty() {
            page.index = page_index;
            page.bump = ctx.bumps.event_page;
        }
        require!(page.index == page_index, TaxiError::InvalidQueuePage);
        let event_number = ctx.accounts.queue.take_event_number()?;
        page.push(MachineEvent::new(
            now,
            event_number,
            ctx.accounts.machine.asset,
            EventKind::Burn,
            ctx.accounts.machine.scheduled_generation,
        ))?;
        ctx.accounts.queue.update_page(page)?;

        emit!(MachineBurnQueued {
            asset: ctx.accounts.machine.asset,
            detected_by: ctx.accounts.caller.key(),
            timestamp: now,
        });
        Ok(())
    }

    pub fn prune_stale_events<'info>(
        ctx: Context<'_, '_, 'info, 'info, PruneStaleEvents<'info>>,
        page_index: u8,
        event_numbers: Vec<u64>,
    ) -> Result<()> {
        require!(
            !event_numbers.is_empty() && event_numbers.len() <= usize::from(MAX_BATCH_EVENTS),
            TaxiError::InvalidBatchLimit
        );
        require!(
            usize::from(page_index) < MAX_QUEUE_PAGES,
            TaxiError::InvalidQueuePage
        );
        require!(
            ctx.accounts.event_page.index == page_index,
            TaxiError::InvalidQueuePage
        );

        for event_number in &event_numbers {
            let event = ctx
                .accounts
                .event_page
                .event(*event_number)
                .ok_or(TaxiError::InvalidMachineEvent)?;
            require!(
                event.kind()? == EventKind::Expire,
                TaxiError::InvalidMachineEvent
            );
            let machine_key =
                Pubkey::find_program_address(&[b"machine", event.machine.as_ref()], ctx.program_id)
                    .0;
            let machine_info = ctx
                .remaining_accounts
                .iter()
                .find(|account| account.key() == machine_key)
                .ok_or(TaxiError::MissingMachineAccount)?;
            let machine = Account::<Machine>::try_from(machine_info)?;
            require!(machine.expiry_is_stale(&event)?, TaxiError::EventNotStale);
            ctx.accounts.event_page.remove(*event_number)?;
        }
        ctx.accounts.queue.update_page(&ctx.accounts.event_page)?;
        emit!(StaleEventsPruned {
            page_index,
            count: u8::try_from(event_numbers.len()).map_err(|_| TaxiError::MathOverflow)?,
        });
        Ok(())
    }

    pub fn activate_trainee(
        ctx: Context<ActivateTrainee>,
        args: ActivateTraineeArgs,
    ) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        require!(
            usize::from(args.page_index) < MAX_QUEUE_PAGES,
            TaxiError::InvalidQueuePage
        );
        require!(
            (TRAINEE_MIN_DURATION_MINUTES..=TRAINEE_MAX_DURATION_MINUTES)
                .contains(&args.duration_minutes),
            TaxiError::InvalidTraineeDuration
        );

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp <= args.expires_at,
            TaxiError::VoucherExpired
        );
        let now = ctx.accounts.config.protocol_time(clock.unix_timestamp)?;
        let active_from = now
            .checked_div(60)
            .and_then(|minute| minute.checked_add(1))
            .and_then(|minute| minute.checked_mul(60))
            .ok_or(TaxiError::MathOverflow)?;
        let duration_seconds = i64::from(args.duration_minutes)
            .checked_mul(60)
            .ok_or(TaxiError::MathOverflow)?;
        let active_until = active_from
            .checked_add(duration_seconds)
            .ok_or(TaxiError::MathOverflow)?;
        require!(
            args.active_from == active_from && args.active_until == active_until,
            TaxiError::InvalidTraineeTimes
        );

        let instructions_info = ctx.accounts.instructions.to_account_info();
        let current_index = usize::from(load_current_index_checked(&instructions_info)?);
        require!(current_index > 0, TaxiError::InvalidVoucherSignature);
        let signature_ix = load_instruction_at_checked(current_index - 1, &instructions_info)?;
        let expected_message = voucher::message(
            ctx.program_id,
            &ctx.accounts.config.deployment_id,
            &ctx.accounts.owner.key(),
            &args,
        );
        voucher::verify_ed25519_instruction(
            &signature_ix,
            &ctx.accounts.config.backend_signer,
            &expected_message,
        )?;

        let start_is_new = ctx.accounts.start_bucket.timestamp == 0;
        let end_is_new = ctx.accounts.end_bucket.timestamp == 0;
        let new_events = usize::from(start_is_new) + usize::from(end_is_new);
        require!(
            ctx.accounts.event_page.events.len() + new_events <= EVENTS_PER_PAGE,
            TaxiError::EventPageCapacity
        );
        if ctx.accounts.event_page.events.is_empty() {
            ctx.accounts.event_page.index = args.page_index;
            ctx.accounts.event_page.bump = ctx.bumps.event_page;
        }
        require!(
            ctx.accounts.event_page.index == args.page_index,
            TaxiError::InvalidQueuePage
        );

        initialize_trainee_bucket(
            &mut ctx.accounts.start_bucket,
            active_from,
            ctx.bumps.start_bucket,
        )?;
        initialize_trainee_bucket(
            &mut ctx.accounts.end_bucket,
            active_until,
            ctx.bumps.end_bucket,
        )?;
        require!(
            !ctx.accounts.start_bucket.processed,
            TaxiError::TraineeBucketProcessed
        );
        require!(
            !ctx.accounts.end_bucket.processed,
            TaxiError::TraineeBucketProcessed
        );
        ctx.accounts.start_bucket.weight_delta = ctx
            .accounts
            .start_bucket
            .weight_delta
            .checked_add(i64::from(TRAINEE_WEIGHT))
            .ok_or(TaxiError::MathOverflow)?;
        ctx.accounts.end_bucket.weight_delta = ctx
            .accounts
            .end_bucket
            .weight_delta
            .checked_sub(i64::from(TRAINEE_WEIGHT))
            .ok_or(TaxiError::MathOverflow)?;

        if start_is_new {
            push_trainee_bucket_event(
                &mut ctx.accounts.trainee_queue,
                &mut ctx.accounts.event_page,
                ctx.accounts.start_bucket.key(),
                active_from,
            )?;
        }
        if end_is_new {
            push_trainee_bucket_event(
                &mut ctx.accounts.trainee_queue,
                &mut ctx.accounts.event_page,
                ctx.accounts.end_bucket.key(),
                active_until,
            )?;
        }
        ctx.accounts
            .trainee_queue
            .update_page(&ctx.accounts.event_page)?;

        let trainee = &mut ctx.accounts.trainee;
        trainee.owner = ctx.accounts.owner.key();
        trainee.campaign_id = args.campaign_id;
        trainee.nonce = args.nonce;
        trainee.active_from = active_from;
        trainee.active_until = active_until;
        trainee.bump = ctx.bumps.trainee;

        emit!(TraineeActivated {
            owner: trainee.owner,
            campaign_id: trainee.campaign_id,
            active_from,
            active_until,
        });
        Ok(())
    }

    pub fn calculate_trainee_rewards<'info>(
        ctx: Context<'_, '_, 'info, 'info, CalculateTraineeRewards<'info>>,
        limit: u8,
    ) -> Result<()> {
        require!(
            limit > 0 && limit <= MAX_BATCH_EVENTS,
            TaxiError::InvalidBatchLimit
        );
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);

        let pool = &mut ctx.accounts.trainee_pool;
        let queue = &mut ctx.accounts.trainee_queue;
        if !pool.series_active {
            let now = ctx
                .accounts
                .config
                .protocol_time(Clock::get()?.unix_timestamp)?;
            pool.start_series(now, queue.next_event_number.saturating_sub(1))?;
        }

        let mut processed = 0_u8;
        while processed < limit {
            let Some(page_index) = queue.min_page_index(pool.series_event_cutoff, pool.series_end)
            else {
                break;
            };
            let page_key = Pubkey::find_program_address(
                &[b"trainee-event-page".as_ref(), &[page_index]],
                ctx.program_id,
            )
            .0;
            let page_info = ctx
                .remaining_accounts
                .iter()
                .find(|account| account.key() == page_key)
                .ok_or(TaxiError::MissingEventPage)?;
            require!(page_info.is_writable, TaxiError::EventPageNotWritable);
            let mut page = Account::<EventPage>::try_from(page_info)?;
            require!(page.index == page_index, TaxiError::InvalidQueuePage);
            let next = page.peek().copied().ok_or(TaxiError::QueueEmpty)?;
            let cursor = queue.pages[usize::from(page_index)];
            require!(
                cursor.min_timestamp == next.timestamp
                    && cursor.min_event_number == next.event_number,
                TaxiError::QueueCursorMismatch
            );

            let boundary = next.timestamp.max(pool.series_cursor).min(pool.series_end);
            pool.distribute_until(boundary)?;
            let event = page.pop()?;
            queue.update_page(&page)?;
            page.exit(ctx.program_id)?;

            let bucket_info = ctx
                .remaining_accounts
                .iter()
                .find(|account| account.key() == event.machine)
                .ok_or(TaxiError::InvalidTraineeBucket)?;
            require!(bucket_info.is_writable, TaxiError::InvalidTraineeBucket);
            let mut bucket = Account::<TraineeBucket>::try_from(bucket_info)?;
            require!(
                bucket.timestamp == event.timestamp,
                TaxiError::InvalidTraineeBucket
            );
            require!(!bucket.processed, TaxiError::TraineeBucketProcessed);
            bucket.accumulator = pool.accumulators[0];
            if bucket.weight_delta >= 0 {
                pool.total_active_weight = pool
                    .total_active_weight
                    .checked_add(bucket.weight_delta as u64)
                    .ok_or(TaxiError::MathOverflow)?;
            } else {
                pool.total_active_weight = pool
                    .total_active_weight
                    .checked_sub(bucket.weight_delta.unsigned_abs())
                    .ok_or(TaxiError::InvalidActiveWeight)?;
            }
            bucket.processed = true;
            bucket.exit(ctx.program_id)?;
            processed = processed.checked_add(1).ok_or(TaxiError::MathOverflow)?;
        }

        if queue
            .min_page_index(pool.series_event_cutoff, pool.series_end)
            .is_none()
        {
            pool.finish_series()?;
        }
        emit!(TraineeRewardsAdvanced {
            calculated_until: pool.calculated_until,
            series_cursor: pool.series_cursor,
            processed_events: processed,
            series_active: pool.series_active,
        });
        Ok(())
    }

    pub fn claim_trainee(ctx: Context<ClaimTrainee>) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        require!(
            ctx.accounts.start_bucket.processed,
            TaxiError::TraineeRewardsNotCalculated
        );
        let effective_until = if ctx.accounts.trainee_pool.series_active {
            ctx.accounts.trainee_pool.series_cursor
        } else {
            ctx.accounts.trainee_pool.calculated_until
        };
        require!(
            effective_until >= ctx.accounts.trainee.active_from,
            TaxiError::TraineeRewardsNotCalculated
        );

        let target = if effective_until >= ctx.accounts.trainee.active_until {
            require!(
                ctx.accounts.end_bucket.processed,
                TaxiError::TraineeRewardsNotCalculated
            );
            ctx.accounts.end_bucket.accumulator
        } else {
            ctx.accounts.trainee_pool.accumulators[0]
        };
        let checkpoint = if ctx.accounts.trainee.checkpoint_initialized {
            ctx.accounts.trainee.checkpoint
        } else {
            ctx.accounts.start_bucket.accumulator
        };
        let amount = math::machine_reward(target, checkpoint, TRAINEE_WEIGHT)?;
        token::assert_program(&ctx.accounts.token_program)?;
        let fare_mint =
            token::mint_view(&ctx.accounts.fare_mint, &ctx.accounts.token_program.key())?;
        let vault = token::account_view(&ctx.accounts.vault, &ctx.accounts.token_program.key())?;
        require_keys_eq!(
            vault.mint,
            ctx.accounts.fare_mint.key(),
            TaxiError::InvalidTokenAccount
        );
        require_keys_eq!(
            vault.owner,
            ctx.accounts.config.key(),
            TaxiError::InvalidTokenAccount
        );

        if amount > 0 {
            let destination_info = ctx.accounts.destination.to_account_info();
            let destination =
                token::account_view(&destination_info, &ctx.accounts.token_program.key())?;
            require_keys_eq!(
                destination.mint,
                ctx.accounts.fare_mint.key(),
                TaxiError::InvalidTokenAccount
            );
            require_keys_eq!(
                destination.owner,
                ctx.accounts.owner.key(),
                TaxiError::InvalidTokenAccount
            );
            let bump = [ctx.accounts.config.bump];
            let seeds: &[&[u8]] = &[b"config", &bump];
            token::transfer_checked(
                token::TransferCheckedAccounts {
                    program: &ctx.accounts.token_program,
                    source: &ctx.accounts.vault,
                    mint: &ctx.accounts.fare_mint,
                    destination: &destination_info,
                    authority: &ctx.accounts.config.to_account_info(),
                },
                amount,
                fare_mint.decimals,
                &[seeds],
            )?;
        }
        ctx.accounts.trainee_pool.obligations[0] = ctx.accounts.trainee_pool.obligations[0]
            .checked_sub(amount)
            .ok_or(TaxiError::MathOverflow)?;
        ctx.accounts.trainee.checkpoint = target;
        ctx.accounts.trainee.checkpoint_initialized = true;
        emit!(TraineeRewardsClaimed {
            owner: ctx.accounts.owner.key(),
            campaign_id: ctx.accounts.trainee.campaign_id,
            amount,
        });
        Ok(())
    }

    pub fn claim<'info>(ctx: Context<'_, '_, 'info, 'info, Claim<'info>>) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        require!(!ctx.accounts.machine.closed, TaxiError::MachineClosed);
        metaplex_core::assert_asset(
            &ctx.accounts.asset,
            &ctx.accounts.owner.key(),
            &ctx.accounts.config.collection,
        )?;
        require!(
            ctx.remaining_accounts.len() == ASSET_COUNT * 4,
            TaxiError::InvalidClaimAccounts
        );

        ctx.accounts.machine.settle(&ctx.accounts.pool, true)?;
        let amounts = ctx.accounts.machine.claimable;
        let config_info = ctx.accounts.config.to_account_info();
        let bump = [ctx.accounts.config.bump];
        let signer_seeds: &[&[u8]] = &[b"config", &bump];

        for (index, amount) in amounts.into_iter().enumerate() {
            let offset = index * 4;
            let mint_info = &ctx.remaining_accounts[offset];
            let vault_info = &ctx.remaining_accounts[offset + 1];
            let destination_info = &ctx.remaining_accounts[offset + 2];
            let token_program_info = &ctx.remaining_accounts[offset + 3];
            require_keys_eq!(
                ctx.accounts.config.asset_mint(index)?,
                mint_info.key(),
                TaxiError::InvalidRewardMint
            );
            token::assert_program(token_program_info)?;
            let mint = token::mint_view(mint_info, token_program_info.key)?;
            let vault = token::account_view(vault_info, token_program_info.key)?;
            require_keys_eq!(vault.mint, mint_info.key(), TaxiError::InvalidTokenAccount);
            require_keys_eq!(
                vault.owner,
                ctx.accounts.config.key(),
                TaxiError::InvalidTokenAccount
            );

            if amount > 0 {
                let destination = token::account_view(destination_info, token_program_info.key)?;
                require_keys_eq!(
                    destination.mint,
                    mint_info.key(),
                    TaxiError::InvalidTokenAccount
                );
                require_keys_eq!(
                    destination.owner,
                    ctx.accounts.owner.key(),
                    TaxiError::InvalidTokenAccount
                );
                token::transfer_checked(
                    token::TransferCheckedAccounts {
                        program: token_program_info,
                        source: vault_info,
                        mint: mint_info,
                        destination: destination_info,
                        authority: &config_info,
                    },
                    amount,
                    mint.decimals,
                    &[signer_seeds],
                )?;
            }
        }

        for (index, amount) in amounts.into_iter().enumerate() {
            ctx.accounts.pool.obligations[index] = ctx.accounts.pool.obligations[index]
                .checked_sub(amount)
                .ok_or(TaxiError::MathOverflow)?;
            ctx.accounts.machine.claimable[index] = 0;
        }
        emit!(RewardsClaimed {
            asset: ctx.accounts.machine.asset,
            owner: ctx.accounts.owner.key(),
            amounts
        });
        Ok(())
    }

    pub fn claim_many<'info>(
        ctx: Context<'_, '_, 'info, 'info, ClaimMany<'info>>,
        machine_count: u8,
    ) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        require!(
            machine_count > 0 && machine_count <= MAX_CLAIM_MACHINES,
            TaxiError::InvalidClaimBatch
        );
        let machine_count = usize::from(machine_count);
        let reward_offset = machine_count
            .checked_mul(2)
            .ok_or(TaxiError::MathOverflow)?;
        require!(
            ctx.remaining_accounts.len() == reward_offset + ASSET_COUNT * 4,
            TaxiError::InvalidClaimAccounts
        );

        for first in 0..machine_count {
            for second in (first + 1)..machine_count {
                require_keys_neq!(
                    ctx.remaining_accounts[first * 2].key(),
                    ctx.remaining_accounts[second * 2].key(),
                    TaxiError::InvalidClaimBatch
                );
            }
        }

        let mut totals = [0_u64; ASSET_COUNT];
        for machine_index in 0..machine_count {
            let machine_info = &ctx.remaining_accounts[machine_index * 2];
            let asset_info = &ctx.remaining_accounts[machine_index * 2 + 1];
            require!(machine_info.is_writable, TaxiError::MachineAccountNotWritable);
            let mut machine = Account::<Machine>::try_from(machine_info)?;
            require!(!machine.closed, TaxiError::MachineClosed);
            require_keys_eq!(machine.asset, asset_info.key(), TaxiError::InvalidMachineEvent);
            let expected_machine = Pubkey::find_program_address(
                &[b"machine", machine.asset.as_ref()],
                ctx.program_id,
            )
            .0;
            require_keys_eq!(
                expected_machine,
                machine_info.key(),
                TaxiError::InvalidMachineEvent
            );
            metaplex_core::assert_asset(
                asset_info,
                &ctx.accounts.owner.key(),
                &ctx.accounts.config.collection,
            )?;
            machine.settle(&ctx.accounts.pool, true)?;
            let amounts = machine.claimable;
            for (index, amount) in amounts.into_iter().enumerate() {
                totals[index] = totals[index]
                    .checked_add(amount)
                    .ok_or(TaxiError::MathOverflow)?;
                machine.claimable[index] = 0;
            }
            machine.exit(ctx.program_id)?;
            emit!(RewardsClaimed {
                asset: asset_info.key(),
                owner: ctx.accounts.owner.key(),
                amounts
            });
        }

        let config_info = ctx.accounts.config.to_account_info();
        let bump = [ctx.accounts.config.bump];
        let signer_seeds: &[&[u8]] = &[b"config", &bump];
        for (index, amount) in totals.into_iter().enumerate() {
            let offset = reward_offset + index * 4;
            let mint_info = &ctx.remaining_accounts[offset];
            let vault_info = &ctx.remaining_accounts[offset + 1];
            let destination_info = &ctx.remaining_accounts[offset + 2];
            let token_program_info = &ctx.remaining_accounts[offset + 3];
            require_keys_eq!(
                ctx.accounts.config.asset_mint(index)?,
                mint_info.key(),
                TaxiError::InvalidRewardMint
            );
            token::assert_program(token_program_info)?;
            let mint = token::mint_view(mint_info, token_program_info.key)?;
            let vault = token::account_view(vault_info, token_program_info.key)?;
            require_keys_eq!(vault.mint, mint_info.key(), TaxiError::InvalidTokenAccount);
            require_keys_eq!(
                vault.owner,
                ctx.accounts.config.key(),
                TaxiError::InvalidTokenAccount
            );
            if amount > 0 {
                let destination = token::account_view(destination_info, token_program_info.key)?;
                require_keys_eq!(
                    destination.mint,
                    mint_info.key(),
                    TaxiError::InvalidTokenAccount
                );
                require_keys_eq!(
                    destination.owner,
                    ctx.accounts.owner.key(),
                    TaxiError::InvalidTokenAccount
                );
                token::transfer_checked(
                    token::TransferCheckedAccounts {
                        program: token_program_info,
                        source: vault_info,
                        mint: mint_info,
                        destination: destination_info,
                        authority: &config_info,
                    },
                    amount,
                    mint.decimals,
                    &[signer_seeds],
                )?;
            }
            ctx.accounts.pool.obligations[index] = ctx.accounts.pool.obligations[index]
                .checked_sub(amount)
                .ok_or(TaxiError::MathOverflow)?;
        }
        Ok(())
    }

    pub fn calculate_rewards<'info>(
        ctx: Context<'_, '_, 'info, 'info, CalculateRewards<'info>>,
        limit: u8,
    ) -> Result<()> {
        require!(
            limit > 0 && limit <= MAX_BATCH_EVENTS,
            TaxiError::InvalidBatchLimit
        );
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);

        let pool = &mut ctx.accounts.pool;
        let queue = &mut ctx.accounts.queue;
        if !pool.series_active {
            let now = ctx
                .accounts
                .config
                .protocol_time(Clock::get()?.unix_timestamp)?;
            pool.start_series(now, queue.next_event_number.saturating_sub(1))?;
        }

        let mut processed = 0_u8;
        while processed < limit {
            let Some(page_index) = queue.min_page_index(pool.series_event_cutoff, pool.series_end)
            else {
                break;
            };
            let page_key = Pubkey::find_program_address(
                &[b"event-page".as_ref(), &[page_index]],
                ctx.program_id,
            )
            .0;
            let page_info = ctx
                .remaining_accounts
                .iter()
                .find(|account| account.key() == page_key)
                .ok_or(TaxiError::MissingEventPage)?;
            require!(page_info.is_writable, TaxiError::EventPageNotWritable);
            let mut page = Account::<EventPage>::try_from(page_info)?;
            require!(page.index == page_index, TaxiError::InvalidQueuePage);
            let next = page.peek().copied().ok_or(TaxiError::QueueEmpty)?;
            let cursor = queue.pages[usize::from(page_index)];
            require!(
                cursor.min_timestamp == next.timestamp
                    && cursor.min_event_number == next.event_number,
                TaxiError::QueueCursorMismatch
            );

            let boundary = next.timestamp.max(pool.series_cursor).min(pool.series_end);
            pool.distribute_until(boundary)?;
            let event = page.pop()?;
            queue.update_page(&page)?;
            page.exit(ctx.program_id)?;
            let machine_key =
                Pubkey::find_program_address(&[b"machine", event.machine.as_ref()], ctx.program_id)
                    .0;
            let machine_info = ctx
                .remaining_accounts
                .iter()
                .find(|account| account.key() == machine_key)
                .ok_or(TaxiError::MissingMachineAccount)?;
            require!(
                machine_info.is_writable,
                TaxiError::MachineAccountNotWritable
            );
            let mut machine = Account::<Machine>::try_from(machine_info)?;
            machine.apply_event(pool, &event)?;
            machine.exit(ctx.program_id)?;
            processed = processed.checked_add(1).ok_or(TaxiError::MathOverflow)?;
        }

        let series_has_more_events = queue
            .min_page_index(pool.series_event_cutoff, pool.series_end)
            .is_some();
        if !series_has_more_events {
            pool.finish_series()?;
        }

        emit!(RewardsAdvanced {
            calculated_until: pool.calculated_until,
            series_cursor: pool.series_cursor,
            processed_events: processed,
            series_active: pool.series_active,
        });
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeArgs {
    pub backend_signer: Pubkey,
    pub team_account: Pubkey,
    pub jupiter_program: Pubkey,
    pub deployment_id: [u8; 32],
    pub collection_name: String,
    pub collection_uri: String,
    pub stock_mints: [Pubkey; STOCK_COUNT],
    pub mint_prices: [u64; CLASS_COUNT],
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Configuration::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(init, payer = admin, space = 8 + RewardPool::INIT_SPACE, seeds = [b"pool", b"main"], bump)]
    pub pool: Box<Account<'info, RewardPool>>,
    #[account(init, payer = admin, space = 8 + RewardPool::INIT_SPACE, seeds = [b"pool".as_ref(), b"trainee".as_ref()], bump)]
    pub trainee_pool: Box<Account<'info, RewardPool>>,
    #[account(init, payer = admin, space = 8 + EventQueue::INIT_SPACE, seeds = [b"queue".as_ref(), b"main".as_ref()], bump)]
    pub queue: Box<Account<'info, EventQueue>>,
    #[account(init, payer = admin, space = 8 + EventQueue::INIT_SPACE, seeds = [b"queue".as_ref(), b"trainee".as_ref()], bump)]
    pub trainee_queue: Box<Account<'info, EventQueue>>,
    #[account(init, payer = admin, space = 8 + FeeVault::INIT_SPACE, seeds = [b"fees"], bump)]
    pub fee_vault: Account<'info, FeeVault>,
    /// CHECK: New Metaplex Core collection created atomically by initialize.
    #[account(mut)]
    pub collection: Signer<'info>,
    /// CHECK: Fixed official Metaplex Core program.
    #[account(address = metaplex_core::MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminState<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin @ TaxiError::Unauthorized)]
    pub config: Box<Account<'info, Configuration>>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub pending_admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Configuration>>,
}

#[derive(Accounts)]
pub struct RescueSol<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ TaxiError::Unauthorized)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"fees"], bump = fee_vault.bump)]
    pub fee_vault: Account<'info, FeeVault>,
    /// CHECK: Admin deliberately chooses the emergency recipient.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RescueToken<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ TaxiError::Unauthorized)]
    pub config: Box<Account<'info, Configuration>>,
    /// CHECK: Mint owner and base data are validated in the handler.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: Token program, mint and authority are validated in the handler.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: Token program and mint are validated in the handler.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
    /// CHECK: Must be the legacy or Token-2022 program.
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CalculateRewards<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"pool", b"main"], bump = pool.bump)]
    pub pool: Box<Account<'info, RewardPool>>,
    #[account(mut, seeds = [b"queue".as_ref(), b"main".as_ref()], bump = queue.bump)]
    pub queue: Box<Account<'info, EventQueue>>,
}

#[derive(Accounts)]
pub struct CollectFees<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"fees"], bump = fee_vault.bump)]
    pub fee_vault: Account<'info, FeeVault>,
    /// CHECK: Must equal the configured team recipient; it only receives SOL.
    #[account(mut)]
    pub team_account: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AbsorbPumpWsolFees<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"fees"], bump = fee_vault.bump)]
    pub fee_vault: Account<'info, FeeVault>,
    /// CHECK: Legacy WSOL mint, authority and amount are validated in the handler.
    #[account(mut)]
    pub pump_wsol_vault: UncheckedAccount<'info>,
    /// CHECK: SPL Token program is validated in the handler.
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ProcessFareSwap<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = fare_mint @ TaxiError::InvalidRewardMint)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"fees"], bump = fee_vault.bump)]
    pub fee_vault: Account<'info, FeeVault>,
    #[account(mut, seeds = [b"pool", b"main"], bump = pool.bump)]
    pub pool: Box<Account<'info, RewardPool>>,
    #[account(mut, seeds = [b"pool".as_ref(), b"trainee".as_ref()], bump = trainee_pool.bump)]
    pub trainee_pool: Box<Account<'info, RewardPool>>,
    /// CHECK: Fixed native mint, parsed in the handler.
    #[account(address = token::NATIVE_MINT_ID)]
    pub wsol_mint: UncheckedAccount<'info>,
    /// CHECK: Legacy WSOL mint and authority are validated in the handler.
    #[account(mut)]
    pub wsol_vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub fare_mint: UncheckedAccount<'info>,
    /// CHECK: Token program, FARE mint and authority are validated in the handler.
    #[account(mut)]
    pub reward_vault: UncheckedAccount<'info>,
    /// CHECK: Address is the currently configured Jupiter router program.
    #[account(address = config.jupiter_program @ TaxiError::InvalidJupiterProgram)]
    pub jupiter_program: UncheckedAccount<'info>,
    /// CHECK: Fixed legacy SPL Token program.
    #[account(address = token::TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: Must be the program that owns fare_mint.
    pub fare_token_program: UncheckedAccount<'info>,
    /// CHECK: Fixed Solana instructions sysvar used to inspect the preceding ed25519 verification.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ProcessStockSwap<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"fees"], bump = fee_vault.bump)]
    pub fee_vault: Account<'info, FeeVault>,
    #[account(mut, seeds = [b"pool", b"main"], bump = pool.bump)]
    pub pool: Box<Account<'info, RewardPool>>,
    /// CHECK: Fixed native mint, parsed in the handler.
    #[account(address = token::NATIVE_MINT_ID)]
    pub wsol_mint: UncheckedAccount<'info>,
    /// CHECK: Legacy WSOL mint and authority are validated in the handler.
    #[account(mut)]
    pub wsol_vault: UncheckedAccount<'info>,
    /// CHECK: Mint owner and base data are validated in the handler.
    pub stock_mint: UncheckedAccount<'info>,
    /// CHECK: Token program, stock mint and authority are validated in the handler.
    #[account(mut)]
    pub reward_vault: UncheckedAccount<'info>,
    /// CHECK: Address is the currently configured Jupiter router program.
    #[account(address = config.jupiter_program @ TaxiError::InvalidJupiterProgram)]
    pub jupiter_program: UncheckedAccount<'info>,
    /// CHECK: Fixed legacy SPL Token program.
    #[account(address = token::TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: Must be the program that owns stock_mint.
    pub stock_token_program: UncheckedAccount<'info>,
    /// CHECK: Fixed Solana instructions sysvar used to inspect the preceding ed25519 verification.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(class: u8, page_index: u8)]
pub struct MintMachine<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = collection @ TaxiError::InvalidCollection,
        has_one = team_account @ TaxiError::InvalidTeamAccount
    )]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"queue".as_ref(), b"main".as_ref()], bump = queue.bump)]
    pub queue: Box<Account<'info, EventQueue>>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + EventPage::INIT_SPACE,
        seeds = [b"event-page".as_ref(), &[page_index]],
        bump
    )]
    pub event_page: Box<Account<'info, EventPage>>,
    #[account(mut)]
    pub asset: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + Machine::INIT_SPACE,
        seeds = [b"machine", asset.key().as_ref()],
        bump
    )]
    pub machine: Box<Account<'info, Machine>>,
    /// CHECK: Address, owner and update authority are validated by metaplex_core::assert_collection.
    #[account(mut, address = config.collection)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: Address is constrained by Configuration::has_one and only receives SOL.
    #[account(mut)]
    pub team_account: UncheckedAccount<'info>,
    /// CHECK: Fixed official Metaplex Core program.
    #[account(address = metaplex_core::MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(page_index: u8)]
pub struct RepairMachine<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"pool", b"main"], bump = pool.bump)]
    pub pool: Box<Account<'info, RewardPool>>,
    #[account(mut, seeds = [b"queue".as_ref(), b"main".as_ref()], bump = queue.bump)]
    pub queue: Box<Account<'info, EventQueue>>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + EventPage::INIT_SPACE,
        seeds = [b"event-page".as_ref(), &[page_index]],
        bump
    )]
    pub event_page: Box<Account<'info, EventPage>>,
    #[account(mut, seeds = [b"machine", asset.key().as_ref()], bump = machine.bump, has_one = asset @ TaxiError::InvalidMachineEvent)]
    pub machine: Box<Account<'info, Machine>>,
    /// CHECK: Core owner, asset owner and collection are validated by metaplex_core::assert_asset.
    #[account(address = machine.asset)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: Address, token program and decimals are validated in the handler.
    #[account(mut, address = config.fare_mint @ TaxiError::InvalidRewardMint)]
    pub fare_mint: UncheckedAccount<'info>,
    /// CHECK: May be an uninitialized ATA for a zero-cost repair; validated before any burn.
    #[account(mut)]
    pub owner_fare_account: UncheckedAccount<'info>,
    /// CHECK: Must be the program that owns fare_mint.
    pub fare_token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(page_index: u8)]
pub struct CleanupBurnedMachine<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"queue".as_ref(), b"main".as_ref()], bump = queue.bump)]
    pub queue: Box<Account<'info, EventQueue>>,
    #[account(
        init_if_needed,
        payer = caller,
        space = 8 + EventPage::INIT_SPACE,
        seeds = [b"event-page".as_ref(), &[page_index]],
        bump
    )]
    pub event_page: Box<Account<'info, EventPage>>,
    #[account(mut, seeds = [b"machine", asset.key().as_ref()], bump = machine.bump, has_one = asset @ TaxiError::InvalidMachineEvent)]
    pub machine: Box<Account<'info, Machine>>,
    /// CHECK: Its address is bound to Machine; Core burn leaves either a closed account or Core-owned Uninitialized data.
    pub asset: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(page_index: u8)]
pub struct PruneStaleEvents<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"queue".as_ref(), b"main".as_ref()], bump = queue.bump)]
    pub queue: Box<Account<'info, EventQueue>>,
    #[account(
        mut,
        seeds = [b"event-page".as_ref(), &[page_index]],
        bump = event_page.bump
    )]
    pub event_page: Box<Account<'info, EventPage>>,
}

#[derive(Accounts)]
#[instruction(args: ActivateTraineeArgs)]
pub struct ActivateTrainee<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"queue".as_ref(), b"trainee".as_ref()], bump = trainee_queue.bump)]
    pub trainee_queue: Box<Account<'info, EventQueue>>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + EventPage::INIT_SPACE,
        seeds = [b"trainee-event-page".as_ref(), &[args.page_index]],
        bump
    )]
    pub event_page: Box<Account<'info, EventPage>>,
    #[account(
        init,
        payer = owner,
        space = 8 + Trainee::INIT_SPACE,
        seeds = [b"trainee", owner.key().as_ref(), &args.campaign_id.to_le_bytes()],
        bump
    )]
    pub trainee: Account<'info, Trainee>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + TraineeBucket::INIT_SPACE,
        seeds = [b"trainee-bucket".as_ref(), &args.active_from.to_le_bytes()],
        bump
    )]
    pub start_bucket: Account<'info, TraineeBucket>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + TraineeBucket::INIT_SPACE,
        seeds = [b"trainee-bucket".as_ref(), &args.active_until.to_le_bytes()],
        bump
    )]
    pub end_bucket: Account<'info, TraineeBucket>,
    /// CHECK: Fixed Solana instructions sysvar used to inspect the preceding ed25519 verification.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CalculateTraineeRewards<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"pool".as_ref(), b"trainee".as_ref()], bump = trainee_pool.bump)]
    pub trainee_pool: Box<Account<'info, RewardPool>>,
    #[account(mut, seeds = [b"queue".as_ref(), b"trainee".as_ref()], bump = trainee_queue.bump)]
    pub trainee_queue: Box<Account<'info, EventQueue>>,
}

#[derive(Accounts)]
pub struct ClaimTrainee<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = fare_mint @ TaxiError::InvalidRewardMint)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"pool".as_ref(), b"trainee".as_ref()], bump = trainee_pool.bump)]
    pub trainee_pool: Box<Account<'info, RewardPool>>,
    #[account(
        mut,
        seeds = [b"trainee", owner.key().as_ref(), &trainee.campaign_id.to_le_bytes()],
        bump = trainee.bump,
        has_one = owner @ TaxiError::Unauthorized
    )]
    pub trainee: Account<'info, Trainee>,
    #[account(
        seeds = [b"trainee-bucket".as_ref(), &trainee.active_from.to_le_bytes()],
        bump = start_bucket.bump
    )]
    pub start_bucket: Account<'info, TraineeBucket>,
    #[account(
        seeds = [b"trainee-bucket".as_ref(), &trainee.active_until.to_le_bytes()],
        bump = end_bucket.bump
    )]
    pub end_bucket: Account<'info, TraineeBucket>,
    /// CHECK: Address, owner and decimals are validated in the handler.
    pub fare_mint: UncheckedAccount<'info>,
    /// CHECK: Token program, mint and authority are validated in the handler.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: May reuse the vault for a zero claim; validated before a positive transfer.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
    /// CHECK: Must be the program that owns fare_mint.
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"pool", b"main"], bump = pool.bump)]
    pub pool: Box<Account<'info, RewardPool>>,
    #[account(mut, seeds = [b"machine", asset.key().as_ref()], bump = machine.bump, has_one = asset @ TaxiError::InvalidMachineEvent)]
    pub machine: Box<Account<'info, Machine>>,
    /// CHECK: Core owner, asset owner and collection are validated by metaplex_core::assert_asset.
    #[account(address = machine.asset)]
    pub asset: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SetFareMint<'info> {
    pub admin: Signer<'info>,
    pub fee_recipient: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin @ TaxiError::Unauthorized)]
    pub config: Box<Account<'info, Configuration>>,
    /// CHECK: Owner and initialized mint layout are validated in the handler.
    pub fare_mint: UncheckedAccount<'info>,
    /// CHECK: Canonical ATA, mint and authority are validated in the handler.
    pub fare_vault: UncheckedAccount<'info>,
    /// CHECK: Pump ownership, PDA, creator, stage and flags are validated in the handler.
    pub bonding_curve: UncheckedAccount<'info>,
    /// CHECK: Canonical Pump Fees PDA is validated; an initialized config must be immutable and assign 100% to fee_recipient.
    pub fee_sharing_config: UncheckedAccount<'info>,
    /// CHECK: Must be the SPL Token or Token-2022 program that owns fare_mint.
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimMany<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"pool", b"main"], bump = pool.bump)]
    pub pool: Box<Account<'info, RewardPool>>,
}

fn verify_swap_plan_signature(
    instructions: &UncheckedAccount<'_>,
    program_id: &Pubkey,
    config: &Account<Configuration>,
    plan: &SwapPlan,
) -> Result<()> {
    let instructions_info = instructions.to_account_info();
    let current_index = usize::from(load_current_index_checked(&instructions_info)?);
    require!(current_index > 0, TaxiError::InvalidVoucherSignature);
    let signature_ix = load_instruction_at_checked(current_index - 1, &instructions_info)?;
    swap::verify_signature(
        &signature_ix,
        &config.backend_signer,
        program_id,
        &config.deployment_id,
        plan,
    )
}

fn require_route_accounts(
    route_accounts: &[AccountInfo<'_>],
    config: &Pubkey,
    source: &Pubkey,
    destination: &Pubkey,
    require_config: bool,
) -> Result<()> {
    for required in [source, destination] {
        require!(
            route_accounts.iter().any(|account| account.key == required),
            TaxiError::MissingSwapAccount
        );
    }
    if require_config {
        require!(route_accounts.iter().any(|account| account.key == config), TaxiError::MissingSwapAccount);
    }
    Ok(())
}

fn validate_initial_addresses(args: &InitializeArgs) -> Result<()> {
    require!(
        args.backend_signer != Pubkey::default(),
        TaxiError::InvalidBackendSigner
    );
    require!(
        args.team_account != Pubkey::default(),
        TaxiError::InvalidTeamAccount
    );
    require!(
        args.jupiter_program != Pubkey::default(),
        TaxiError::InvalidJupiterProgram
    );
    for (index, mint) in args.stock_mints.iter().enumerate() {
        require!(
            *mint != Pubkey::default(),
            TaxiError::InvalidRewardMint
        );
        require!(
            args.stock_mints[..index]
                .iter()
                .all(|previous| previous != mint),
            TaxiError::InvalidRewardMint
        );
    }
    Ok(())
}

fn validate_fare_assignment(config: &Configuration, fare_mint: Pubkey) -> Result<()> {
    require!(!config.sale_started, TaxiError::SaleAlreadyStarted);
    require!(
        fare_mint != Pubkey::default()
            && !config.stock_mints.iter().any(|mint| *mint == fare_mint),
        TaxiError::InvalidRewardMint
    );
    Ok(())
}

fn require_fare_ready(fare_mint: Pubkey) -> Result<()> {
    require!(fare_mint != Pubkey::default(), TaxiError::FareMintNotSet);
    Ok(())
}

fn validate_pump_fee_recipient(
    fare_mint: Pubkey,
    fee_recipient: &Pubkey,
    bonding_curve: &AccountInfo<'_>,
    sharing_config: &AccountInfo<'_>,
) -> Result<()> {
    const PUMP_PROGRAM: Pubkey = pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
    const PUMP_FEE_PROGRAM: Pubkey = pubkey!("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
    let expected = Pubkey::find_program_address(
        &[b"bonding-curve", fare_mint.as_ref()],
        &PUMP_PROGRAM,
    )
    .0;
    require_keys_eq!(bonding_curve.key(), expected, TaxiError::InvalidPumpToken);
    require_keys_eq!(*bonding_curve.owner, PUMP_PROGRAM, TaxiError::InvalidPumpToken);
    let data = bonding_curve.try_borrow_data()?;
    let (creator, complete) = decode_direct_pump_curve(&data)?;
    require!(!complete, TaxiError::PumpTokenAlreadyGraduated);
    let expected_sharing_config = Pubkey::find_program_address(
        &[b"sharing-config", fare_mint.as_ref()],
        &PUMP_FEE_PROGRAM,
    )
    .0;
    require_keys_eq!(sharing_config.key(), expected_sharing_config, TaxiError::InvalidPumpToken);
    if sharing_config.lamports() == 0 && sharing_config.data_is_empty() {
        require_keys_eq!(creator, *fee_recipient, TaxiError::InvalidPumpCreator);
        return Ok(());
    }
    require_keys_eq!(*sharing_config.owner, PUMP_FEE_PROGRAM, TaxiError::InvalidPumpToken);
    require_keys_eq!(creator, expected_sharing_config, TaxiError::InvalidPumpCreator);
    let sharing_data = sharing_config.try_borrow_data()?;
    validate_fixed_fee_sharing(&sharing_data, fare_mint, *fee_recipient)?;
    Ok(())
}

fn validate_fixed_fee_sharing(data: &[u8], fare_mint: Pubkey, fee_recipient: Pubkey) -> Result<()> {
    const DISCRIMINATOR: [u8; 8] = [216, 74, 9, 0, 56, 140, 93, 75];
    const MIN_LENGTH: usize = 114;
    require!(data.len() >= MIN_LENGTH, TaxiError::InvalidPumpToken);
    require!(data[..8] == DISCRIMINATOR, TaxiError::InvalidPumpToken);
    require!(data[9] == 2 && data[10] == 1, TaxiError::InvalidPumpToken);
    require!(data[11..43] == fare_mint.to_bytes(), TaxiError::InvalidPumpToken);
    require!(data[75] == 1, TaxiError::InvalidPumpToken);
    let shareholder_count = u32::from_le_bytes(
        data[76..80].try_into().map_err(|_| TaxiError::InvalidPumpToken)?,
    );
    require!(shareholder_count == 1, TaxiError::InvalidPumpToken);
    require!(data[80..112] == fee_recipient.to_bytes(), TaxiError::InvalidPumpCreator);
    let share_bps = u16::from_le_bytes(
        data[112..114].try_into().map_err(|_| TaxiError::InvalidPumpToken)?,
    );
    require!(share_bps == 10_000, TaxiError::InvalidPumpCreator);
    Ok(())
}

fn decode_direct_pump_curve(data: &[u8]) -> Result<(Pubkey, bool)> {
    const BONDING_CURVE_DISCRIMINATOR: [u8; 8] = [23, 183, 248, 55, 96, 216, 172, 96];
    const COMPLETE_OFFSET: usize = 48;
    const CREATOR_OFFSET: usize = 49;
    const CASHBACK_OFFSET: usize = 82;
    const QUOTE_MINT_OFFSET: usize = 83;
    const CREATOR_FEE_BPS_OFFSET: usize = 115;
    const CAN_EDIT_CREATOR_FEE_OFFSET: usize = 123;
    const HOLDER_REWARD_OFFSET: usize = 124;
    require!(data.len() > HOLDER_REWARD_OFFSET, TaxiError::InvalidPumpToken);
    require!(data[..8] == BONDING_CURVE_DISCRIMINATOR, TaxiError::InvalidPumpToken);
    let creator = Pubkey::new_from_array(
        data[CREATOR_OFFSET..CREATOR_OFFSET + 32]
            .try_into()
            .map_err(|_| TaxiError::InvalidPumpToken)?,
    );
    require!(data[81] == 0, TaxiError::InvalidPumpToken);
    require!(data[CASHBACK_OFFSET] == 0, TaxiError::InvalidPumpToken);
    let quote_mint = Pubkey::new_from_array(
        data[QUOTE_MINT_OFFSET..QUOTE_MINT_OFFSET + 32]
            .try_into()
            .map_err(|_| TaxiError::InvalidPumpToken)?,
    );
    require!(quote_mint == Pubkey::default(), TaxiError::InvalidPumpToken);
    let creator_fee_bps = u64::from_le_bytes(
        data[CREATOR_FEE_BPS_OFFSET..CREATOR_FEE_BPS_OFFSET + 8]
            .try_into()
            .map_err(|_| TaxiError::InvalidPumpToken)?,
    );
    require!(creator_fee_bps == 0, TaxiError::InvalidPumpToken);
    require!(data[CAN_EDIT_CREATOR_FEE_OFFSET] == 0, TaxiError::InvalidPumpToken);
    require!(data[HOLDER_REWARD_OFFSET] == 0, TaxiError::InvalidPumpToken);
    Ok((creator, data[COMPLETE_OFFSET] != 0))
}

#[cfg(test)]
mod accounting_tests {
    use super::*;

    #[test]
    fn initialize_rejects_duplicate_reward_mints() {
        let repeated = Pubkey::new_unique();
        let args = InitializeArgs {
            backend_signer: Pubkey::new_unique(),
            team_account: Pubkey::new_unique(),
            jupiter_program: Pubkey::new_unique(),
            deployment_id: [1; 32],
            collection_name: "Taxi".to_owned(),
            collection_uri: "uri".to_owned(),
            stock_mints: [
                repeated,
                repeated,
                Pubkey::new_unique(),
                Pubkey::new_unique(),
            ],
            mint_prices: [1; CLASS_COUNT],
        };
        assert!(validate_initial_addresses(&args).is_err());
    }

    #[test]
    fn fare_mint_can_change_before_sale_and_cannot_match_a_stock() {
        let stock_mints = [
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        ];
        let mut config = Configuration {
            admin: Pubkey::new_unique(),
            pending_admin: Pubkey::default(),
            backend_signer: Pubkey::new_unique(),
            team_account: Pubkey::new_unique(),
            jupiter_program: Pubkey::new_unique(),
            deployment_id: [1; 32],
            fare_swap_nonce: 0,
            stock_swap_nonces: [0; STOCK_COUNT],
            collection: Pubkey::new_unique(),
            fare_mint: Pubkey::default(),
            stock_mints,
            metadata_uris: std::array::from_fn(|index| format!("uri-{index}")),
            mint_prices: [1; CLASS_COUNT],
            minted_by_class: [0; CLASS_COUNT],
            sale_started: false,
            paused_at: 0,
            total_paused_seconds: 0,
            bump: 1,
        };
        let fare_mint = Pubkey::new_unique();
        assert!(require_fare_ready(config.fare_mint).is_err());
        assert!(validate_fare_assignment(&config, Pubkey::default()).is_err());
        assert!(validate_fare_assignment(&config, stock_mints[0]).is_err());
        assert!(validate_fare_assignment(&config, fare_mint).is_ok());

        config.fare_mint = fare_mint;
        assert!(require_fare_ready(config.fare_mint).is_ok());
        assert!(validate_fare_assignment(&config, Pubkey::new_unique()).is_ok());
        config.sale_started = true;
        assert!(validate_fare_assignment(&config, Pubkey::new_unique()).is_err());
    }

    #[test]
    fn variants_are_bounded_balanced_and_use_class_scoped_uris() {
        let metadata_uris = std::array::from_fn(|index| format!("uri-{index}"));
        let config = Configuration {
            admin: Pubkey::new_unique(),
            pending_admin: Pubkey::default(),
            backend_signer: Pubkey::new_unique(),
            team_account: Pubkey::new_unique(),
            jupiter_program: Pubkey::new_unique(),
            deployment_id: [1; 32],
            fare_swap_nonce: 0,
            stock_swap_nonces: [0; STOCK_COUNT],
            collection: Pubkey::new_unique(),
            fare_mint: Pubkey::new_unique(),
            stock_mints: std::array::from_fn(|_| Pubkey::new_unique()),
            metadata_uris,
            mint_prices: [1, 2, 3, 4],
            minted_by_class: [0; CLASS_COUNT],
            sale_started: false,
            paused_at: 0,
            total_paused_seconds: 0,
            bump: 1,
        };

        for class in 0..CLASS_COUNT {
            for serial in 1..=12_u16 {
                let variant = variant_for_serial(serial).unwrap();
                assert!(usize::from(variant) < VARIANTS_PER_CLASS);
                assert_eq!(
                    config.metadata_uri(class, usize::from(variant)).unwrap(),
                    format!("uri-{}", class * VARIANTS_PER_CLASS + usize::from(variant)),
                );
            }
        }
        assert_eq!(CLASS_CAPS, [1000, 300, 100, 25]);
        assert_eq!(CLASS_WEIGHTS, [1, 3, 10, 30]);
        assert_eq!(
            (1..=8)
                .map(|serial| variant_for_serial(serial).unwrap())
                .collect::<Vec<_>>(),
            [0, 1, 2, 3, 0, 1, 2, 3]
        );
        assert_eq!(next_mint_selection(0, 1000).unwrap(), (1, 0));
        assert_eq!(next_mint_selection(999, 1000).unwrap(), (1000, 3));
        assert!(next_mint_selection(1000, 1000).is_err());
        assert!(metadata_uris_are_valid(&config.metadata_uris));
        let mut duplicate_uris = config.metadata_uris.clone();
        duplicate_uris[15] = duplicate_uris[0].clone();
        assert!(!metadata_uris_are_valid(&duplicate_uris));
        assert!(variant_for_serial(0).is_err());
        assert!(config.metadata_uri(4, 0).is_err());
        assert!(config.metadata_uri(0, 4).is_err());
    }

    #[test]
    fn configuration_layout_requires_new_initialization() {
        const LEGACY_CONFIGURATION_INIT_SPACE: usize = 1298;
        assert_eq!(Configuration::INIT_SPACE, 3746);
        assert_eq!(
            Configuration::INIT_SPACE - LEGACY_CONFIGURATION_INIT_SPACE,
            12 * (4 + MAX_METADATA_URI_LEN),
        );
    }

    #[test]
    fn machine_minted_event_serializes_class_variant_and_serial() {
        let event = MachineMinted {
            asset: Pubkey::new_unique(),
            owner: Pubkey::new_unique(),
            class: 2,
            variant: 3,
            serial: 17,
            weight: 10,
            active_until: 42,
            paid_lamports: 99,
        };
        let bytes = event.try_to_vec().unwrap();
        assert_eq!(bytes[64], 2);
        assert_eq!(bytes[65], 3);
        assert_eq!(u16::from_le_bytes(bytes[66..68].try_into().unwrap()), 17);
    }

    #[test]
    fn pump_curve_requires_direct_creator_sol_quote_and_no_cashback() {
        let creator = Pubkey::new_unique();
        let mut data = vec![0_u8; 125];
        data[..8].copy_from_slice(&[23, 183, 248, 55, 96, 216, 172, 96]);
        data[49..81].copy_from_slice(creator.as_ref());
        assert_eq!(decode_direct_pump_curve(&data).unwrap(), (creator, false));
        data[82] = 1;
        assert!(decode_direct_pump_curve(&data).is_err());
        data[82] = 0;
        data[83..115].copy_from_slice(Pubkey::new_unique().as_ref());
        assert!(decode_direct_pump_curve(&data).is_err());
        data[83..115].fill(0);
        data[124] = 1;
        assert!(decode_direct_pump_curve(&data).is_err());
        data[124] = 0;
        data[81] = 1;
        assert!(decode_direct_pump_curve(&data).is_err());
        data[81] = 0;
        data[115] = 1;
        assert!(decode_direct_pump_curve(&data).is_err());
    }

    #[test]
    fn pump_fee_sharing_must_be_immutable_and_pay_only_the_fee_recipient() {
        let mint = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let mut data = vec![0_u8; 1024];
        data[..8].copy_from_slice(&[216, 74, 9, 0, 56, 140, 93, 75]);
        data[8] = 252;
        data[9] = 2;
        data[10] = 1;
        data[11..43].copy_from_slice(mint.as_ref());
        data[43..75].copy_from_slice(Pubkey::new_unique().as_ref());
        data[75] = 1;
        data[76..80].copy_from_slice(&1_u32.to_le_bytes());
        data[80..112].copy_from_slice(recipient.as_ref());
        data[112..114].copy_from_slice(&10_000_u16.to_le_bytes());

        assert!(validate_fixed_fee_sharing(&data, mint, recipient).is_ok());
        data[75] = 0;
        assert!(validate_fixed_fee_sharing(&data, mint, recipient).is_err());
        data[75] = 1;
        data[112..114].copy_from_slice(&9_999_u16.to_le_bytes());
        assert!(validate_fixed_fee_sharing(&data, mint, recipient).is_err());
        data[112..114].copy_from_slice(&10_000_u16.to_le_bytes());
        data[80..112].copy_from_slice(Pubkey::new_unique().as_ref());
        assert!(validate_fixed_fee_sharing(&data, mint, recipient).is_err());
    }
}

fn following_swap_funding(
    instructions: &AccountInfo<'_>,
    program_id: &Pubkey,
    wsol_vault: &Pubkey,
) -> Result<(u8, u8, u64)> {
    const PROCESS_FARE_SWAP: [u8; 8] = [132, 236, 100, 80, 1, 220, 9, 61];
    const PROCESS_STOCK_SWAP: [u8; 8] = [139, 227, 181, 243, 162, 165, 81, 70];
    let current_index = usize::from(load_current_index_checked(instructions)?);
    let process_index = current_index.checked_add(2).ok_or(TaxiError::MathOverflow)?;
    let process = load_instruction_at_checked(process_index, instructions)?;
    require_keys_eq!(process.program_id, *program_id, TaxiError::InvalidSwapPlan);
    require!(process.data.len() >= 74, TaxiError::InvalidSwapPlan);
    let kind = process.data[8];
    let asset_index = process.data[9];
    let mut amount_bytes = [0_u8; 8];
    amount_bytes.copy_from_slice(&process.data[18..26]);
    let amount_in = u64::from_le_bytes(amount_bytes);
    let (discriminator, wsol_index) = if kind == FARE_SWAP_KIND && asset_index == 0 {
        (PROCESS_FARE_SWAP, 6_usize)
    } else {
        require!(kind == STOCK_SWAP_KIND && usize::from(asset_index) < STOCK_COUNT, TaxiError::InvalidSwapPlan);
        (PROCESS_STOCK_SWAP, 5_usize)
    };
    require!(
        process.data[..8] == discriminator
            && process.accounts.len() > wsol_index
            && process.accounts[wsol_index].pubkey == *wsol_vault,
        TaxiError::InvalidSwapPlan
    );
    Ok((kind, asset_index, amount_in))
}

fn move_lamports_to_wsol<'info>(
    fee_vault: &AccountInfo<'info>,
    wsol_vault: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let rent_floor = Rent::get()?.minimum_balance(fee_vault.data_len());
    let available = fee_vault
        .lamports()
        .checked_sub(rent_floor)
        .ok_or(TaxiError::VaultBalanceMismatch)?;
    require!(amount <= available, TaxiError::VaultBalanceMismatch);
    let fee_after = fee_vault
        .lamports()
        .checked_sub(amount)
        .ok_or(TaxiError::MathOverflow)?;
    let wsol_after = wsol_vault
        .lamports()
        .checked_add(amount)
        .ok_or(TaxiError::MathOverflow)?;
    **fee_vault.try_borrow_mut_lamports()? = fee_after;
    **wsol_vault.try_borrow_mut_lamports()? = wsol_after;
    Ok(())
}

fn invoke_jupiter<'info>(
    config: &Account<'info, Configuration>,
    caller: &Signer<'info>,
    jupiter_program: &UncheckedAccount<'info>,
    route_accounts: &[AccountInfo<'info>],
    route_data: Vec<u8>,
) -> Result<()> {
    let config_key = config.key();
    let accounts = route_accounts
        .iter()
        .map(|account| AccountMeta {
            pubkey: account.key(),
            is_signer: account.key() == config_key || account.key() == caller.key(),
            is_writable: account.is_writable,
        })
        .collect();
    let bump = [config.bump];
    let seeds: &[&[u8]] = &[b"config", &bump];
    let mut account_infos = Vec::with_capacity(route_accounts.len() + 1);
    account_infos.extend_from_slice(route_accounts);
    account_infos.push(jupiter_program.to_account_info());
    invoke_signed(
        &Instruction {
            program_id: jupiter_program.key(),
            accounts,
            data: route_data,
        },
        &account_infos,
        &[seeds],
    )?;
    Ok(())
}

fn class_terms(class: u8) -> Result<(u16, u16)> {
    let index = usize::from(class);
    require!(index < CLASS_COUNT, TaxiError::InvalidClass);
    Ok((CLASS_WEIGHTS[index], CLASS_CAPS[index]))
}

fn class_name(class: u8) -> Result<&'static str> {
    match class {
        0 => Ok("Economy"),
        1 => Ok("Comfort"),
        2 => Ok("Business"),
        3 => Ok("Legend"),
        _ => err!(TaxiError::InvalidClass),
    }
}

fn variant_for_serial(serial: u16) -> Result<u8> {
    require!(serial > 0, TaxiError::MathOverflow);
    u8::try_from((serial - 1) % VARIANTS_PER_CLASS as u16)
        .map_err(|_| error!(TaxiError::MathOverflow))
}

fn next_mint_selection(minted: u16, cap: u16) -> Result<(u16, u8)> {
    require!(minted < cap, TaxiError::ClassSoldOut);
    let serial = minted.checked_add(1).ok_or(TaxiError::MathOverflow)?;
    Ok((serial, variant_for_serial(serial)?))
}

fn metadata_uris_are_valid(metadata_uris: &[String; METADATA_URI_COUNT]) -> bool {
    metadata_uris.iter().enumerate().all(|(index, uri)| {
        !uri.is_empty()
            && uri.len() <= MAX_METADATA_URI_LEN
            && metadata_uris[..index]
                .iter()
                .all(|previous| previous != uri)
    })
}

fn initialize_trainee_bucket(
    bucket: &mut Account<TraineeBucket>,
    timestamp: i64,
    bump: u8,
) -> Result<()> {
    if bucket.timestamp == 0 {
        bucket.timestamp = timestamp;
        bucket.bump = bump;
    }
    require!(
        bucket.timestamp == timestamp,
        TaxiError::InvalidTraineeBucket
    );
    Ok(())
}

fn push_trainee_bucket_event(
    queue: &mut Account<EventQueue>,
    page: &mut Account<EventPage>,
    bucket: Pubkey,
    timestamp: i64,
) -> Result<()> {
    let event_number = queue.take_event_number()?;
    page.push(MachineEvent::new(
        timestamp,
        event_number,
        bucket,
        EventKind::Activate,
        0,
    ))
}

#[allow(clippy::too_many_arguments)]
fn initialize_machine_and_events(
    machine: &mut Account<Machine>,
    queue: &mut Account<EventQueue>,
    page: &mut Account<EventPage>,
    asset: Pubkey,
    weight: u16,
    now: i64,
    page_index: u8,
    machine_bump: u8,
    page_bump: u8,
) -> Result<()> {
    require!(
        usize::from(page_index) < MAX_QUEUE_PAGES,
        TaxiError::InvalidQueuePage
    );
    require!(
        page.events.len() + 2 <= EVENTS_PER_PAGE,
        TaxiError::EventPageCapacity
    );
    if page.events.is_empty() {
        page.index = page_index;
        page.bump = page_bump;
    }
    require!(page.index == page_index, TaxiError::InvalidQueuePage);

    machine.asset = asset;
    machine.weight = weight;
    machine.active_until = now
        .checked_add(MAX_DURABILITY_SECONDS)
        .ok_or(TaxiError::MathOverflow)?;
    machine.scheduled_generation = 1;
    machine.bump = machine_bump;

    let activate_number = queue.take_event_number()?;
    let expire_number = queue.take_event_number()?;
    page.push(MachineEvent::new(
        now,
        activate_number,
        asset,
        EventKind::Activate,
        1,
    ))?;
    page.push(MachineEvent::new(
        machine.active_until,
        expire_number,
        asset,
        EventKind::Expire,
        1,
    ))?;
    queue.update_page(page)
}

#[event]
pub struct RewardsAdvanced {
    pub calculated_until: i64,
    pub series_cursor: i64,
    pub processed_events: u8,
    pub series_active: bool,
}

#[event]
pub struct FeesCollected {
    pub total: u64,
    pub fare_reserve: u64,
    pub stock_reserve_each: u64,
    pub team_amount: u64,
}

#[event]
pub struct PumpWsolFeesAbsorbed {
    pub amount: u64,
}

#[event]
pub struct FareSwapProcessed {
    pub nonce: u64,
    pub sol_in: u64,
    pub fare_out: u64,
    pub main_amount: u64,
    pub trainee_amount: u64,
    pub burned_amount: u64,
}

#[event]
pub struct StockSwapProcessed {
    pub stock_index: u8,
    pub nonce: u64,
    pub sol_in: u64,
    pub tokens_out: u64,
}

#[event]
pub struct MachineMinted {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub class: u8,
    pub variant: u8,
    pub serial: u16,
    pub weight: u16,
    pub active_until: i64,
    pub paid_lamports: u64,
}

#[event]
pub struct MachineRepaired {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub cost: u64,
    pub missing_seconds: i64,
    pub active_until: i64,
    pub generation: u32,
}

#[event]
pub struct MachineBurnQueued {
    pub asset: Pubkey,
    pub detected_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct StaleEventsPruned {
    pub page_index: u8,
    pub count: u8,
}

#[event]
pub struct TraineeActivated {
    pub owner: Pubkey,
    pub campaign_id: u64,
    pub active_from: i64,
    pub active_until: i64,
}

#[event]
pub struct TraineeRewardsAdvanced {
    pub calculated_until: i64,
    pub series_cursor: i64,
    pub processed_events: u8,
    pub series_active: bool,
}

#[event]
pub struct TraineeRewardsClaimed {
    pub owner: Pubkey,
    pub campaign_id: u64,
    pub amount: u64,
}

#[event]
pub struct RewardsClaimed {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub amounts: [u64; ASSET_COUNT],
}

#[event]
pub struct AssetRescued {
    /// Pubkey::default() denotes native SOL.
    pub mint: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
}
