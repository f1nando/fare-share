#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    sysvar::instructions::{load_current_index_checked, load_instruction_at_checked},
};
use anchor_spl::token::{self as spl_token, SyncNative, Token, TokenAccount as LegacyTokenAccount};
use anchor_spl::token_interface::{
    self, BurnChecked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use mpl_core::accounts::{BaseAssetV1, BaseCollectionV1};
use mpl_core::types::{DataState, ImmutableMetadata, Plugin, PluginAuthorityPair, UpdateAuthority};

pub mod error;
pub mod math;
pub mod state;
pub mod swap;
pub mod voucher;

pub use error::*;
pub use state::*;
pub use swap::{SwapPlan, FARE_SWAP_KIND, STOCK_SWAP_KIND};
pub use voucher::ActivateTraineeArgs;

declare_id!("7SpHocA8dThiUTfkv9iv63bhJnzWysk2bFgKbT4WKwnY");

#[program]
pub mod taxi_park {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
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
        config.fare_mint = args.fare_mint;
        config.stock_mints = args.stock_mints;
        require!(
            args.metadata_uris
                .iter()
                .all(|uri| !uri.is_empty() && uri.len() <= MAX_METADATA_URI_LEN),
            TaxiError::InvalidMetadataUri
        );
        let [economy_uri, comfort_uri, business_uri, legend_uri] = args.metadata_uris;
        config.economy_uri = economy_uri;
        config.comfort_uri = comfort_uri;
        config.business_uri = business_uri;
        config.legend_uri = legend_uri;
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
        queue.next_event_number = 1;
        queue.bump = ctx.bumps.queue;
        ctx.accounts.trainee_queue.next_event_number = 1;
        ctx.accounts.trainee_queue.bump = ctx.bumps.trainee_queue;
        ctx.accounts.fee_vault.bump = ctx.bumps.fee_vault;

        let config_info = config.to_account_info();
        mpl_core::instructions::CreateCollectionV2Cpi {
            collection: &ctx.accounts.collection.to_account_info(),
            update_authority: Some(&config_info),
            payer: &ctx.accounts.admin.to_account_info(),
            system_program: &ctx.accounts.system_program.to_account_info(),
            __program: &ctx.accounts.mpl_core_program.to_account_info(),
            __args: mpl_core::instructions::CreateCollectionV2InstructionArgs {
                name: args.collection_name,
                uri: args.collection_uri,
                plugins: Some(vec![PluginAuthorityPair {
                    plugin: Plugin::ImmutableMetadata(ImmutableMetadata {}),
                    authority: None,
                }]),
                external_plugin_adapters: None,
            },
        }
        .invoke()?;
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

    pub fn start_sale(ctx: Context<AdminState>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.sale_started, TaxiError::SaleAlreadyStarted);
        require!(
            config.mint_prices.iter().all(|price| *price > 0),
            TaxiError::InvalidPrice
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
        ctx.accounts.fee_vault.consume_reserves(amount)?;
        emit!(AssetRescued {
            mint: Pubkey::default(),
            recipient: ctx.accounts.recipient.key(),
            amount
        });
        Ok(())
    }

    pub fn rescue_token(ctx: Context<RescueToken>, amount: u64) -> Result<()> {
        require!(ctx.accounts.config.is_paused(), TaxiError::NotPaused);
        require!(
            amount > 0 && amount <= ctx.accounts.vault.amount,
            TaxiError::InvalidRescueAmount
        );
        require_keys_eq!(
            ctx.accounts.destination.mint,
            ctx.accounts.mint.key(),
            TaxiError::InvalidTokenAccount
        );
        let bump = [ctx.accounts.config.bump];
        let seeds: &[&[u8]] = &[b"config", &bump];
        let transfer = TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.config.to_account_info(),
        };
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer,
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        emit!(AssetRescued {
            mint: ctx.accounts.mint.key(),
            recipient: ctx.accounts.destination.key(),
            amount
        });
        Ok(())
    }

    pub fn sync_reward_asset(ctx: Context<SyncRewardAsset>, asset_index: u8) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        let index = usize::from(asset_index);
        require!(index < ASSET_COUNT, TaxiError::InvalidRewardAsset);
        require_keys_eq!(
            ctx.accounts.config.asset_mint(index)?,
            ctx.accounts.mint.key(),
            TaxiError::InvalidRewardMint
        );

        let accounted = ctx.accounts.pool.accounted_tokens(index)?;
        let actual = ctx.accounts.vault.amount;
        let received = actual
            .checked_sub(accounted)
            .ok_or(TaxiError::VaultBalanceMismatch)?;
        require!(received > 0, TaxiError::NothingToSync);
        ctx.accounts.pool.next_pool[index] = ctx.accounts.pool.next_pool[index]
            .checked_add(received)
            .ok_or(TaxiError::MathOverflow)?;
        emit!(RewardAssetSynced {
            asset_index,
            amount: received
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

    pub fn process_fare_swap<'info>(
        ctx: Context<'_, '_, 'info, 'info, ProcessFareSwap<'info>>,
        plan: SwapPlan,
        route_data: Vec<u8>,
    ) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
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
        )?;

        fund_wsol(
            &ctx.accounts.fee_vault.to_account_info(),
            &ctx.accounts.wsol_vault.to_account_info(),
            &ctx.accounts.token_program,
            plan.amount_in,
        )?;
        ctx.accounts.wsol_vault.reload()?;
        let source_before = ctx.accounts.wsol_vault.amount;
        let output_before = ctx.accounts.reward_vault.amount;
        invoke_jupiter(
            &ctx.accounts.config,
            &ctx.accounts.jupiter_program,
            ctx.remaining_accounts,
            route_data,
        )?;
        ctx.accounts.wsol_vault.reload()?;
        ctx.accounts.reward_vault.reload()?;
        let spent = source_before
            .checked_sub(ctx.accounts.wsol_vault.amount)
            .ok_or(TaxiError::InvalidSwapInput)?;
        require!(spent == plan.amount_in, TaxiError::InvalidSwapInput);
        let received = ctx
            .accounts
            .reward_vault
            .amount
            .checked_sub(output_before)
            .ok_or(TaxiError::InsufficientSwapOutput)?;
        require!(received >= plan.min_out, TaxiError::InsufficientSwapOutput);

        let (main_amount, trainee_amount, burn_amount) = math::fare_swap_split(received)?;
        if burn_amount > 0 {
            let bump = [ctx.accounts.config.bump];
            let seeds: &[&[u8]] = &[b"config", &bump];
            let burn = BurnChecked {
                mint: ctx.accounts.fare_mint.to_account_info(),
                from: ctx.accounts.reward_vault.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            };
            token_interface::burn_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.fare_token_program.to_account_info(),
                    burn,
                    &[seeds],
                ),
                burn_amount,
                ctx.accounts.fare_mint.decimals,
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
        )?;

        fund_wsol(
            &ctx.accounts.fee_vault.to_account_info(),
            &ctx.accounts.wsol_vault.to_account_info(),
            &ctx.accounts.token_program,
            plan.amount_in,
        )?;
        ctx.accounts.wsol_vault.reload()?;
        let source_before = ctx.accounts.wsol_vault.amount;
        let output_before = ctx.accounts.reward_vault.amount;
        invoke_jupiter(
            &ctx.accounts.config,
            &ctx.accounts.jupiter_program,
            ctx.remaining_accounts,
            route_data,
        )?;
        ctx.accounts.wsol_vault.reload()?;
        ctx.accounts.reward_vault.reload()?;
        let spent = source_before
            .checked_sub(ctx.accounts.wsol_vault.amount)
            .ok_or(TaxiError::InvalidSwapInput)?;
        require!(spent == plan.amount_in, TaxiError::InvalidSwapInput);
        let received = ctx
            .accounts
            .reward_vault
            .amount
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
        require!(minted < cap, TaxiError::ClassSoldOut);
        let price = ctx.accounts.config.mint_prices[class_index];
        let serial = minted.checked_add(1).ok_or(TaxiError::MathOverflow)?;
        let name = format!("FARE {} #{:04}", class_name(class)?, serial);
        let uri = ctx.accounts.config.metadata_uri(class_index)?.to_owned();

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
        mpl_core::instructions::CreateV1Cpi {
            asset: &ctx.accounts.asset.to_account_info(),
            collection: Some(&ctx.accounts.collection.to_account_info()),
            authority: Some(&config_info),
            payer: &ctx.accounts.owner.to_account_info(),
            owner: Some(&ctx.accounts.owner.to_account_info()),
            update_authority: None,
            system_program: &ctx.accounts.system_program.to_account_info(),
            log_wrapper: None,
            __program: &ctx.accounts.mpl_core_program,
            __args: mpl_core::instructions::CreateV1InstructionArgs {
                data_state: DataState::AccountState,
                name,
                uri,
                plugins: None,
            },
        }
        .invoke_signed(&[config_seeds])?;

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
        let cost = math::repair_cost(ctx.accounts.machine.fare_base, missing)?;

        if cost > 0 {
            let burn_accounts = BurnChecked {
                mint: ctx.accounts.fare_mint.to_account_info(),
                from: ctx.accounts.owner_fare_account.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            };
            token_interface::burn_checked(
                CpiContext::new(
                    ctx.accounts.fare_token_program.to_account_info(),
                    burn_accounts,
                ),
                cost,
                ctx.accounts.fare_mint.decimals,
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
        require!(
            asset_info.lamports() == 0 && asset_info.data_is_empty(),
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

    pub fn sync_trainee_fare(ctx: Context<SyncTraineeFare>) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        let accounted = ctx.accounts.trainee_pool.accounted_tokens(0)?;
        let received = ctx
            .accounts
            .vault
            .amount
            .checked_sub(accounted)
            .ok_or(TaxiError::VaultBalanceMismatch)?;
        require!(received > 0, TaxiError::NothingToSync);
        ctx.accounts.trainee_pool.next_pool[0] = ctx.accounts.trainee_pool.next_pool[0]
            .checked_add(received)
            .ok_or(TaxiError::MathOverflow)?;
        emit!(TraineeFareSynced { amount: received });
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

        if amount > 0 {
            let bump = [ctx.accounts.config.bump];
            let seeds: &[&[u8]] = &[b"config", &bump];
            let transfer = TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.fare_mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            };
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    transfer,
                    &[seeds],
                ),
                amount,
                ctx.accounts.fare_mint.decimals,
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
            require!(
                token_program_info.key() == anchor_spl::token::ID
                    || token_program_info.key() == anchor_spl::token_2022::ID,
                TaxiError::InvalidTokenProgram
            );
            require_keys_eq!(
                *mint_info.owner,
                token_program_info.key(),
                TaxiError::InvalidTokenProgram
            );

            let mint = InterfaceAccount::<Mint>::try_from(mint_info)?;
            let vault = InterfaceAccount::<TokenAccount>::try_from(vault_info)?;
            let destination = InterfaceAccount::<TokenAccount>::try_from(destination_info)?;
            require_keys_eq!(vault.mint, mint_info.key(), TaxiError::InvalidTokenAccount);
            require_keys_eq!(
                vault.owner,
                ctx.accounts.config.key(),
                TaxiError::InvalidTokenAccount
            );
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

            if amount > 0 {
                let transfer = TransferChecked {
                    from: vault_info.clone(),
                    mint: mint_info.clone(),
                    to: destination_info.clone(),
                    authority: config_info.clone(),
                };
                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        token_program_info.clone(),
                        transfer,
                        &[signer_seeds],
                    ),
                    amount,
                    mint.decimals,
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
    pub fare_mint: Pubkey,
    pub stock_mints: [Pubkey; STOCK_COUNT],
    pub mint_prices: [u64; CLASS_COUNT],
    pub metadata_uris: [String; CLASS_COUNT],
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
    #[account(address = mpl_core::ID)]
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
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = config,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SyncRewardAsset<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"pool", b"main"], bump = pool.bump)]
    pub pool: Box<Account<'info, RewardPool>>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        token::mint = mint,
        token::authority = config,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
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
    #[account(address = anchor_spl::token::spl_token::native_mint::ID)]
    pub wsol_mint: Account<'info, anchor_spl::token::Mint>,
    #[account(mut, token::mint = wsol_mint, token::authority = config)]
    pub wsol_vault: Account<'info, LegacyTokenAccount>,
    #[account(mut)]
    pub fare_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = fare_mint, token::authority = config, token::token_program = fare_token_program)]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Address is the currently configured Jupiter router program.
    #[account(address = config.jupiter_program @ TaxiError::InvalidJupiterProgram)]
    pub jupiter_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub fare_token_program: Interface<'info, TokenInterface>,
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
    #[account(address = anchor_spl::token::spl_token::native_mint::ID)]
    pub wsol_mint: Account<'info, anchor_spl::token::Mint>,
    #[account(mut, token::mint = wsol_mint, token::authority = config)]
    pub wsol_vault: Account<'info, LegacyTokenAccount>,
    pub stock_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = stock_mint, token::authority = config, token::token_program = stock_token_program)]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Address is the currently configured Jupiter router program.
    #[account(address = config.jupiter_program @ TaxiError::InvalidJupiterProgram)]
    pub jupiter_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub stock_token_program: Interface<'info, TokenInterface>,
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
    #[account(
        mut,
        address = config.collection,
        constraint = collection.update_authority == config.key() @ TaxiError::InvalidCollection
    )]
    pub collection: Account<'info, BaseCollectionV1>,
    /// CHECK: Address is constrained by Configuration::has_one and only receives SOL.
    #[account(mut)]
    pub team_account: UncheckedAccount<'info>,
    /// CHECK: Fixed official Metaplex Core program.
    #[account(address = mpl_core::ID)]
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
    #[account(
        address = machine.asset,
        constraint = asset.owner == owner.key() @ TaxiError::InvalidAssetOwner,
        constraint = asset.update_authority == UpdateAuthority::Collection(config.collection) @ TaxiError::InvalidCollection
    )]
    pub asset: Account<'info, BaseAssetV1>,
    #[account(mut, address = config.fare_mint @ TaxiError::InvalidRewardMint)]
    pub fare_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = fare_mint,
        token::authority = owner,
        token::token_program = fare_token_program
    )]
    pub owner_fare_account: InterfaceAccount<'info, TokenAccount>,
    pub fare_token_program: Interface<'info, TokenInterface>,
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
    /// CHECK: Its address is bound to Machine; a burned Core asset has zero lamports and no data.
    pub asset: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
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
pub struct SyncTraineeFare<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = fare_mint @ TaxiError::InvalidRewardMint)]
    pub config: Box<Account<'info, Configuration>>,
    #[account(mut, seeds = [b"pool".as_ref(), b"trainee".as_ref()], bump = trainee_pool.bump)]
    pub trainee_pool: Box<Account<'info, RewardPool>>,
    pub fare_mint: InterfaceAccount<'info, Mint>,
    #[account(
        token::mint = fare_mint,
        token::authority = config,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
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
    pub fare_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = fare_mint,
        token::authority = config,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = fare_mint,
        token::authority = owner,
        token::token_program = token_program
    )]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
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
    #[account(
        address = machine.asset,
        constraint = asset.owner == owner.key() @ TaxiError::InvalidAssetOwner,
        constraint = asset.update_authority == UpdateAuthority::Collection(config.collection) @ TaxiError::InvalidCollection
    )]
    pub asset: Account<'info, BaseAssetV1>,
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
) -> Result<()> {
    for required in [config, source, destination] {
        require!(
            route_accounts.iter().any(|account| account.key == required),
            TaxiError::MissingSwapAccount
        );
    }
    Ok(())
}

fn fund_wsol<'info>(
    fee_vault: &AccountInfo<'info>,
    wsol_vault: &AccountInfo<'info>,
    token_program: &Program<'info, Token>,
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
    spl_token::sync_native(CpiContext::new(
        token_program.to_account_info(),
        SyncNative {
            account: wsol_vault.clone(),
        },
    ))?;
    Ok(())
}

fn invoke_jupiter<'info>(
    config: &Account<'info, Configuration>,
    jupiter_program: &UncheckedAccount<'info>,
    route_accounts: &[AccountInfo<'info>],
    route_data: Vec<u8>,
) -> Result<()> {
    let config_key = config.key();
    let accounts = route_accounts
        .iter()
        .map(|account| AccountMeta {
            pubkey: account.key(),
            is_signer: account.key() == config_key,
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
pub struct RewardAssetSynced {
    pub asset_index: u8,
    pub amount: u64,
}

#[event]
pub struct MachineMinted {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub class: u8,
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
pub struct TraineeActivated {
    pub owner: Pubkey,
    pub campaign_id: u64,
    pub active_from: i64,
    pub active_until: i64,
}

#[event]
pub struct TraineeFareSynced {
    pub amount: u64,
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
