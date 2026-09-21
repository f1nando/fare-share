#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

pub mod error;
pub mod math;
pub mod state;

pub use error::*;
pub use state::*;

declare_id!("7SpHocA8dThiUTfkv9iv63bhJnzWysk2bFgKbT4WKwnY");

#[program]
pub mod taxi_park {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.backend_signer = args.backend_signer;
        config.team_account = args.team_account;
        config.collection = args.collection;
        config.fare_mint = args.fare_mint;
        config.stock_mints = args.stock_mints;
        config.mint_prices = args.mint_prices;
        config.sale_started = false;
        config.paused_at = 0;
        config.total_paused_seconds = 0;
        config.bump = ctx.bumps.config;

        let pool = &mut ctx.accounts.pool;
        pool.calculated_until = now;
        pool.bump = ctx.bumps.pool;

        let queue = &mut ctx.accounts.queue;
        queue.next_event_number = 1;
        queue.bump = ctx.bumps.queue;
        ctx.accounts.fee_vault.bump = ctx.bumps.fee_vault;
        Ok(())
    }

    pub fn set_mint_prices(ctx: Context<AdminState>, prices: [u64; CLASS_COUNT]) -> Result<()> {
        require!(!ctx.accounts.config.sale_started, TaxiError::SaleAlreadyStarted);
        require!(prices.iter().all(|price| *price > 0), TaxiError::InvalidPrice);
        ctx.accounts.config.mint_prices = prices;
        Ok(())
    }

    pub fn start_sale(ctx: Context<AdminState>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.sale_started, TaxiError::SaleAlreadyStarted);
        require!(config.mint_prices.iter().all(|price| *price > 0), TaxiError::InvalidPrice);
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
        let paused = now.checked_sub(config.paused_at).ok_or(TaxiError::MathOverflow)?;
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
        require_keys_eq!(config.pending_admin, ctx.accounts.pending_admin.key(), TaxiError::Unauthorized);
        config.admin = config.pending_admin;
        config.pending_admin = Pubkey::default();
        Ok(())
    }

    pub fn add_rewards_for_test(ctx: Context<AddRewardsForTest>, amounts: [u64; ASSET_COUNT]) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        ctx.accounts.pool.add_to_next(amounts)
    }

    pub fn sync_reward_asset(ctx: Context<SyncRewardAsset>, asset_index: u8) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        let index = usize::from(asset_index);
        require!(index < ASSET_COUNT, TaxiError::InvalidRewardAsset);
        require_keys_eq!(ctx.accounts.config.asset_mint(index)?, ctx.accounts.mint.key(), TaxiError::InvalidRewardMint);

        let accounted = ctx.accounts.pool.accounted_tokens(index)?;
        let actual = ctx.accounts.vault.amount;
        let received = actual.checked_sub(accounted).ok_or(TaxiError::VaultBalanceMismatch)?;
        require!(received > 0, TaxiError::NothingToSync);
        ctx.accounts.pool.next_pool[index] = ctx.accounts.pool.next_pool[index]
            .checked_add(received)
            .ok_or(TaxiError::MathOverflow)?;
        emit!(RewardAssetSynced { asset_index, amount: received });
        Ok(())
    }

    pub fn collect_fees(ctx: Context<CollectFees>) -> Result<()> {
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        require_keys_eq!(ctx.accounts.config.team_account, ctx.accounts.team_account.key(), TaxiError::InvalidTeamAccount);

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
            .checked_add(available.checked_sub(assigned).ok_or(TaxiError::MathOverflow)?)
            .ok_or(TaxiError::MathOverflow)?;

        ctx.accounts.fee_vault.fare_sol_reserve = ctx.accounts.fee_vault
            .fare_sol_reserve
            .checked_add(fare_amount)
            .ok_or(TaxiError::MathOverflow)?;
        for reserve in &mut ctx.accounts.fee_vault.stock_sol_reserves {
            *reserve = reserve.checked_add(stock_amount).ok_or(TaxiError::MathOverflow)?;
        }

        if team_amount > 0 {
            let vault_after = vault_info
                .lamports()
                .checked_sub(team_amount)
                .ok_or(TaxiError::MathOverflow)?;
            let team_after = ctx.accounts
                .team_account
                .lamports()
                .checked_add(team_amount)
                .ok_or(TaxiError::MathOverflow)?;
            **vault_info.try_borrow_mut_lamports()? = vault_after;
            **ctx.accounts.team_account.try_borrow_mut_lamports()? = team_after;
        }

        emit!(FeesCollected { total: available, fare_reserve: fare_amount, stock_reserve_each: stock_amount, team_amount });
        Ok(())
    }

    pub fn calculate_rewards<'info>(
        ctx: Context<'_, '_, 'info, 'info, CalculateRewards<'info>>,
        limit: u8,
    ) -> Result<()> {
        require!(limit > 0 && limit <= MAX_BATCH_EVENTS, TaxiError::InvalidBatchLimit);
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);

        let pool = &mut ctx.accounts.pool;
        let queue = &mut ctx.accounts.queue;
        if !pool.series_active {
            let now = ctx.accounts.config.protocol_time(Clock::get()?.unix_timestamp)?;
            pool.start_series(now, queue.next_event_number.saturating_sub(1))?;
        }

        let mut processed = 0_u8;
        while processed < limit {
            let Some(page_index) = queue.min_page_index(pool.series_event_cutoff, pool.series_end) else { break };
            let page_key = Pubkey::find_program_address(
                &[b"event-page".as_ref(), &[page_index]],
                ctx.program_id,
            ).0;
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
                cursor.min_timestamp == next.timestamp && cursor.min_event_number == next.event_number,
                TaxiError::QueueCursorMismatch
            );

            let boundary = next.timestamp.max(pool.series_cursor).min(pool.series_end);
            pool.distribute_until(boundary)?;
            let event = page.pop()?;
            queue.update_page(&page)?;
            page.exit(ctx.program_id)?;
            let machine_key = Pubkey::find_program_address(
                &[b"machine", event.machine.as_ref()],
                ctx.program_id,
            ).0;
            let machine_info = ctx
                .remaining_accounts
                .iter()
                .find(|account| account.key() == machine_key)
                .ok_or(TaxiError::MissingMachineAccount)?;
            require!(machine_info.is_writable, TaxiError::MachineAccountNotWritable);
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

    pub fn schedule_machine_for_test(
        ctx: Context<ScheduleMachineForTest>,
        asset: Pubkey,
        class: u8,
        page_index: u8,
    ) -> Result<()> {
        // Temporary harness instruction. It exercises the exact queue and reward state while the
        // Metaplex Core mint CPI is wired in the next layer; admin-only prevents fake production NFTs.
        require!(!ctx.accounts.config.is_paused(), TaxiError::Paused);
        let now = ctx.accounts.config.protocol_time(Clock::get()?.unix_timestamp)?;
        let (weight, _) = class_terms(class)?;
        let machine = &mut ctx.accounts.machine;
        machine.asset = asset;
        machine.weight = weight;
        machine.active_until = now.checked_add(MAX_DURABILITY_SECONDS).ok_or(TaxiError::MathOverflow)?;
        machine.scheduled_generation = 1;
        machine.bump = ctx.bumps.machine;

        require!(usize::from(page_index) < MAX_QUEUE_PAGES, TaxiError::InvalidQueuePage);
        let queue = &mut ctx.accounts.queue;
        let page = &mut ctx.accounts.event_page;
        if page.events.is_empty() {
            page.index = page_index;
            page.bump = ctx.bumps.event_page;
        }
        require!(page.index == page_index, TaxiError::InvalidQueuePage);
        let activate_number = queue.take_event_number()?;
        let expire_number = queue.take_event_number()?;
        page.push(MachineEvent::new(now, activate_number, asset, EventKind::Activate, 1))?;
        page.push(MachineEvent::new(
            machine.active_until,
            expire_number,
            asset,
            EventKind::Expire,
            1,
        ))?;
        queue.update_page(page)?;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeArgs {
    pub backend_signer: Pubkey,
    pub team_account: Pubkey,
    pub collection: Pubkey,
    pub fare_mint: Pubkey,
    pub stock_mints: [Pubkey; STOCK_COUNT],
    pub mint_prices: [u64; CLASS_COUNT],
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Configuration::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Configuration>,
    #[account(init, payer = admin, space = 8 + RewardPool::INIT_SPACE, seeds = [b"pool", b"main"], bump)]
    pub pool: Account<'info, RewardPool>,
    #[account(init, payer = admin, space = 8 + EventQueue::INIT_SPACE, seeds = [b"queue".as_ref(), b"main".as_ref()], bump)]
    pub queue: Account<'info, EventQueue>,
    #[account(init, payer = admin, space = 8 + FeeVault::INIT_SPACE, seeds = [b"fees"], bump)]
    pub fee_vault: Account<'info, FeeVault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminState<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin @ TaxiError::Unauthorized)]
    pub config: Account<'info, Configuration>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub pending_admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Configuration>,
}

#[derive(Accounts)]
pub struct AddRewardsForTest<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ TaxiError::Unauthorized)]
    pub config: Account<'info, Configuration>,
    #[account(mut, seeds = [b"pool", b"main"], bump = pool.bump)]
    pub pool: Account<'info, RewardPool>,
}

#[derive(Accounts)]
pub struct SyncRewardAsset<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Configuration>,
    #[account(mut, seeds = [b"pool", b"main"], bump = pool.bump)]
    pub pool: Account<'info, RewardPool>,
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
    pub config: Account<'info, Configuration>,
    #[account(mut, seeds = [b"pool", b"main"], bump = pool.bump)]
    pub pool: Account<'info, RewardPool>,
    #[account(mut, seeds = [b"queue".as_ref(), b"main".as_ref()], bump = queue.bump)]
    pub queue: Account<'info, EventQueue>,
}

#[derive(Accounts)]
pub struct CollectFees<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Configuration>,
    #[account(mut, seeds = [b"fees"], bump = fee_vault.bump)]
    pub fee_vault: Account<'info, FeeVault>,
    /// CHECK: Must equal the configured team recipient; it only receives SOL.
    #[account(mut)]
    pub team_account: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(asset: Pubkey, class: u8, page_index: u8)]
pub struct ScheduleMachineForTest<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ TaxiError::Unauthorized)]
    pub config: Account<'info, Configuration>,
    #[account(mut, seeds = [b"pool", b"main"], bump = pool.bump)]
    pub pool: Account<'info, RewardPool>,
    #[account(mut, seeds = [b"queue".as_ref(), b"main".as_ref()], bump = queue.bump)]
    pub queue: Account<'info, EventQueue>,
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + EventPage::INIT_SPACE,
        seeds = [b"event-page".as_ref(), &[page_index]],
        bump
    )]
    pub event_page: Account<'info, EventPage>,
    #[account(init, payer = admin, space = 8 + Machine::INIT_SPACE, seeds = [b"machine", asset.as_ref()], bump)]
    pub machine: Account<'info, Machine>,
    pub system_program: Program<'info, System>,
}

fn class_terms(class: u8) -> Result<(u16, u16)> {
    let index = usize::from(class);
    require!(index < CLASS_COUNT, TaxiError::InvalidClass);
    Ok((CLASS_WEIGHTS[index], CLASS_CAPS[index]))
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
pub struct RewardAssetSynced {
    pub asset_index: u8,
    pub amount: u64,
}
