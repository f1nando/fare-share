use anchor_lang::prelude::*;

use crate::{math, TaxiError};

pub const ASSET_COUNT: usize = 5;
pub const STOCK_COUNT: usize = 4;
pub const CLASS_COUNT: usize = 4;
pub const CLASS_CAPS: [u16; CLASS_COUNT] = [1000, 300, 100, 25];
pub const CLASS_WEIGHTS: [u16; CLASS_COUNT] = [1, 3, 10, 30];
pub const MAX_DURABILITY_SECONDS: i64 = 5 * 24 * 60 * 60;
pub const MAX_QUEUE_PAGES: usize = 80;
pub const EVENTS_PER_PAGE: usize = 128;
pub const MAX_BATCH_EVENTS: u8 = 20;
pub const MAX_METADATA_URI_LEN: usize = 200;
pub const MAX_COLLECTION_NAME_LEN: usize = 64;
pub const TRAINEE_MIN_DURATION_MINUTES: u16 = 60;
pub const TRAINEE_MAX_DURATION_MINUTES: u16 = 7 * 24 * 60;
pub const TRAINEE_WEIGHT: u16 = 1;

#[account]
#[derive(InitSpace)]
pub struct Configuration {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub backend_signer: Pubkey,
    pub team_account: Pubkey,
    pub jupiter_program: Pubkey,
    pub deployment_id: [u8; 32],
    pub fare_swap_nonce: u64,
    pub stock_swap_nonces: [u64; STOCK_COUNT],
    pub collection: Pubkey,
    pub fare_mint: Pubkey,
    pub stock_mints: [Pubkey; STOCK_COUNT],
    #[max_len(MAX_METADATA_URI_LEN)]
    pub economy_uri: String,
    #[max_len(MAX_METADATA_URI_LEN)]
    pub comfort_uri: String,
    #[max_len(MAX_METADATA_URI_LEN)]
    pub business_uri: String,
    #[max_len(MAX_METADATA_URI_LEN)]
    pub legend_uri: String,
    pub mint_prices: [u64; CLASS_COUNT],
    pub minted_by_class: [u16; CLASS_COUNT],
    pub sale_started: bool,
    pub paused_at: i64,
    pub total_paused_seconds: i64,
    pub bump: u8,
}

impl Configuration {
    pub fn is_paused(&self) -> bool {
        self.paused_at != 0
    }

    pub fn protocol_time(&self, unix_timestamp: i64) -> Result<i64> {
        let frozen_now = if self.is_paused() {
            self.paused_at
        } else {
            unix_timestamp
        };
        frozen_now
            .checked_sub(self.total_paused_seconds)
            .ok_or_else(|| error!(TaxiError::MathOverflow))
    }

    pub fn asset_mint(&self, index: usize) -> Result<Pubkey> {
        match index {
            0 => Ok(self.fare_mint),
            1..=STOCK_COUNT => Ok(self.stock_mints[index - 1]),
            _ => err!(TaxiError::InvalidRewardAsset),
        }
    }

    pub fn metadata_uri(&self, class: usize) -> Result<&str> {
        match class {
            0 => Ok(&self.economy_uri),
            1 => Ok(&self.comfort_uri),
            2 => Ok(&self.business_uri),
            3 => Ok(&self.legend_uri),
            _ => err!(TaxiError::InvalidClass),
        }
    }
}

#[account]
#[derive(InitSpace, Default)]
pub struct FeeVault {
    pub fare_sol_reserve: u64,
    pub stock_sol_reserves: [u64; STOCK_COUNT],
    pub bump: u8,
}

impl FeeVault {
    pub fn total_reserved(&self) -> Result<u64> {
        self.stock_sol_reserves
            .iter()
            .try_fold(self.fare_sol_reserve, |total, value| {
                total
                    .checked_add(*value)
                    .ok_or_else(|| error!(TaxiError::MathOverflow))
            })
    }

    pub fn consume_reserves(&mut self, mut amount: u64) -> Result<()> {
        let fare = self.fare_sol_reserve.min(amount);
        self.fare_sol_reserve = self
            .fare_sol_reserve
            .checked_sub(fare)
            .ok_or(TaxiError::MathOverflow)?;
        amount = amount.checked_sub(fare).ok_or(TaxiError::MathOverflow)?;
        for reserve in &mut self.stock_sol_reserves {
            if amount == 0 {
                break;
            }
            let taken = (*reserve).min(amount);
            *reserve = reserve.checked_sub(taken).ok_or(TaxiError::MathOverflow)?;
            amount = amount.checked_sub(taken).ok_or(TaxiError::MathOverflow)?;
        }
        require!(amount == 0, TaxiError::VaultBalanceMismatch);
        Ok(())
    }
}

#[account]
#[derive(InitSpace, Default)]
pub struct RewardPool {
    pub calculated_until: i64,
    pub total_active_weight: u64,
    pub accumulators: [u128; ASSET_COUNT],
    pub obligations: [u64; ASSET_COUNT],
    pub next_pool: [u64; ASSET_COUNT],
    pub series_initial: [u64; ASSET_COUNT],
    pub series_remaining: [u64; ASSET_COUNT],
    pub series_start: i64,
    pub series_end: i64,
    pub series_cursor: i64,
    pub series_event_cutoff: u64,
    pub series_active: bool,
    pub bump: u8,
}

impl RewardPool {
    pub fn add_to_next(&mut self, amounts: [u64; ASSET_COUNT]) -> Result<()> {
        for (balance, amount) in self.next_pool.iter_mut().zip(amounts) {
            *balance = balance.checked_add(amount).ok_or(TaxiError::MathOverflow)?;
        }
        Ok(())
    }

    pub fn accounted_tokens(&self, index: usize) -> Result<u64> {
        require!(index < ASSET_COUNT, TaxiError::InvalidRewardAsset);
        let active = if self.series_active {
            self.series_remaining[index]
        } else {
            0
        };
        self.obligations[index]
            .checked_add(self.next_pool[index])
            .and_then(|value| value.checked_add(active))
            .ok_or_else(|| error!(TaxiError::MathOverflow))
    }

    pub fn start_series(&mut self, now: i64, event_cutoff: u64) -> Result<()> {
        require!(!self.series_active, TaxiError::SeriesAlreadyActive);
        require!(now >= self.calculated_until, TaxiError::InvalidSegment);
        self.series_start = self.calculated_until;
        self.series_end = now;
        self.series_cursor = self.series_start;
        self.series_event_cutoff = event_cutoff;
        self.series_initial = self.next_pool;
        self.series_remaining = self.next_pool;
        self.next_pool = [0; ASSET_COUNT];
        self.series_active = true;
        Ok(())
    }

    pub fn distribute_until(&mut self, segment_end: i64) -> Result<()> {
        require!(self.series_active, TaxiError::SeriesNotActive);
        require!(
            segment_end >= self.series_cursor && segment_end <= self.series_end,
            TaxiError::InvalidSegment
        );
        let total_duration = self
            .series_end
            .checked_sub(self.series_start)
            .ok_or(TaxiError::MathOverflow)?;
        if segment_end == self.series_cursor || total_duration == 0 {
            self.series_cursor = segment_end;
            return Ok(());
        }

        if self.total_active_weight > 0 {
            let elapsed_before = u64::try_from(self.series_cursor - self.series_start)
                .map_err(|_| error!(TaxiError::MathOverflow))?;
            let elapsed_after = u64::try_from(segment_end - self.series_start)
                .map_err(|_| error!(TaxiError::MathOverflow))?;
            let duration =
                u64::try_from(total_duration).map_err(|_| error!(TaxiError::MathOverflow))?;

            for index in 0..ASSET_COUNT {
                let target_before =
                    math::mul_div_u64(self.series_initial[index], elapsed_before, duration)?;
                let target_after =
                    math::mul_div_u64(self.series_initial[index], elapsed_after, duration)?;
                let segment_budget = target_after
                    .checked_sub(target_before)
                    .ok_or(TaxiError::MathOverflow)?;
                let (increment, assigned) =
                    math::reward_per_weight(segment_budget, self.total_active_weight)?;
                self.accumulators[index] = self.accumulators[index]
                    .checked_add(increment)
                    .ok_or(TaxiError::MathOverflow)?;
                self.series_remaining[index] = self.series_remaining[index]
                    .checked_sub(assigned)
                    .ok_or(TaxiError::MathOverflow)?;
                self.obligations[index] = self.obligations[index]
                    .checked_add(assigned)
                    .ok_or(TaxiError::MathOverflow)?;
            }
        }
        self.series_cursor = segment_end;
        Ok(())
    }

    pub fn finish_series(&mut self) -> Result<()> {
        require!(self.series_active, TaxiError::SeriesNotActive);
        self.distribute_until(self.series_end)?;
        for index in 0..ASSET_COUNT {
            self.next_pool[index] = self.next_pool[index]
                .checked_add(self.series_remaining[index])
                .ok_or(TaxiError::MathOverflow)?;
        }
        self.calculated_until = self.series_end;
        self.series_initial = [0; ASSET_COUNT];
        self.series_remaining = [0; ASSET_COUNT];
        self.series_active = false;
        Ok(())
    }
}

#[account]
#[derive(InitSpace, Default)]
pub struct Machine {
    pub asset: Pubkey,
    pub weight: u16,
    pub active_until: i64,
    pub scheduled_generation: u32,
    pub reward_generation: u32,
    pub reward_active: bool,
    pub closed: bool,
    pub checkpoints: [u128; ASSET_COUNT],
    pub claimable: [u64; ASSET_COUNT],
    pub fare_base: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct Trainee {
    pub owner: Pubkey,
    pub campaign_id: u64,
    pub nonce: u64,
    pub active_from: i64,
    pub active_until: i64,
    pub checkpoint: u128,
    pub checkpoint_initialized: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct TraineeBucket {
    pub timestamp: i64,
    pub weight_delta: i64,
    pub accumulator: u128,
    pub processed: bool,
    pub bump: u8,
}

impl Machine {
    pub fn settle(
        &mut self,
        pool: &RewardPool,
        add_to_fare_base: bool,
    ) -> Result<[u64; ASSET_COUNT]> {
        let mut earned = [0_u64; ASSET_COUNT];
        if self.reward_active {
            for index in 0..ASSET_COUNT {
                earned[index] = math::machine_reward(
                    pool.accumulators[index],
                    self.checkpoints[index],
                    self.weight,
                )?;
                self.claimable[index] = self.claimable[index]
                    .checked_add(earned[index])
                    .ok_or(TaxiError::MathOverflow)?;
                self.checkpoints[index] = pool.accumulators[index];
            }
            if add_to_fare_base {
                self.fare_base = self
                    .fare_base
                    .checked_add(earned[0])
                    .ok_or(TaxiError::MathOverflow)?;
            }
        }
        Ok(earned)
    }

    pub fn apply_event(&mut self, pool: &mut RewardPool, event: &MachineEvent) -> Result<()> {
        require_keys_eq!(self.asset, event.machine, TaxiError::InvalidMachineEvent);
        match event.kind()? {
            EventKind::Activate => {
                self.settle(pool, false)?;
                if !self.reward_active {
                    pool.total_active_weight = pool
                        .total_active_weight
                        .checked_add(u64::from(self.weight))
                        .ok_or(TaxiError::MathOverflow)?;
                }
                self.reward_active = true;
                self.reward_generation = event.generation;
                self.checkpoints = pool.accumulators;
            }
            EventKind::Expire => {
                if self.reward_active && self.reward_generation == event.generation {
                    self.settle(pool, true)?;
                    pool.total_active_weight = pool
                        .total_active_weight
                        .checked_sub(u64::from(self.weight))
                        .ok_or(TaxiError::InvalidActiveWeight)?;
                    self.reward_active = false;
                }
            }
            EventKind::Burn => {
                self.settle(pool, true)?;
                if self.reward_active {
                    pool.total_active_weight = pool
                        .total_active_weight
                        .checked_sub(u64::from(self.weight))
                        .ok_or(TaxiError::InvalidActiveWeight)?;
                }
                self.reward_active = false;
                self.closed = true;
                for index in 0..ASSET_COUNT {
                    pool.obligations[index] = pool.obligations[index]
                        .checked_sub(self.claimable[index])
                        .ok_or(TaxiError::MathOverflow)?;
                    pool.next_pool[index] = pool.next_pool[index]
                        .checked_add(self.claimable[index])
                        .ok_or(TaxiError::MathOverflow)?;
                    self.claimable[index] = 0;
                }
            }
        }
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, InitSpace, PartialEq)]
#[repr(u8)]
pub enum EventKind {
    Activate = 0,
    Expire = 1,
    Burn = 2,
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, Eq, InitSpace, PartialEq,
)]
pub struct MachineEvent {
    pub timestamp: i64,
    pub event_number: u64,
    pub machine: Pubkey,
    pub kind: u8,
    pub generation: u32,
}

impl MachineEvent {
    pub fn new(
        timestamp: i64,
        event_number: u64,
        machine: Pubkey,
        kind: EventKind,
        generation: u32,
    ) -> Self {
        Self {
            timestamp,
            event_number,
            machine,
            kind: kind as u8,
            generation,
        }
    }

    pub fn kind(&self) -> Result<EventKind> {
        match self.kind {
            0 => Ok(EventKind::Activate),
            1 => Ok(EventKind::Expire),
            2 => Ok(EventKind::Burn),
            _ => err!(TaxiError::InvalidMachineEvent),
        }
    }

    fn before(&self, other: &Self) -> bool {
        (self.timestamp, self.event_number) < (other.timestamp, other.event_number)
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, Eq, InitSpace, PartialEq,
)]
pub struct PageCursor {
    pub count: u16,
    pub min_timestamp: i64,
    pub min_event_number: u64,
}

#[account]
#[derive(InitSpace)]
pub struct EventQueue {
    pub pages: [PageCursor; MAX_QUEUE_PAGES],
    pub next_event_number: u64,
    pub bump: u8,
}

impl Default for EventQueue {
    fn default() -> Self {
        Self {
            pages: [PageCursor::default(); MAX_QUEUE_PAGES],
            next_event_number: 0,
            bump: 0,
        }
    }
}

impl EventQueue {
    pub fn take_event_number(&mut self) -> Result<u64> {
        let number = self.next_event_number;
        self.next_event_number = number.checked_add(1).ok_or(TaxiError::MathOverflow)?;
        Ok(number)
    }

    pub fn update_page(&mut self, page: &EventPage) -> Result<()> {
        let index = usize::from(page.index);
        require!(index < MAX_QUEUE_PAGES, TaxiError::InvalidQueuePage);
        self.pages[index] = match page.peek() {
            Some(event) => PageCursor {
                count: u16::try_from(page.events.len())
                    .map_err(|_| error!(TaxiError::MathOverflow))?,
                min_timestamp: event.timestamp,
                min_event_number: event.event_number,
            },
            None => PageCursor::default(),
        };
        Ok(())
    }

    pub fn min_page_index(&self, event_cutoff: u64, series_end: i64) -> Option<u8> {
        self.pages
            .iter()
            .enumerate()
            .filter(|(_, page)| {
                page.count > 0
                    && page.min_event_number <= event_cutoff
                    && page.min_timestamp <= series_end
            })
            .min_by_key(|(_, page)| (page.min_timestamp, page.min_event_number))
            .and_then(|(index, _)| u8::try_from(index).ok())
    }
}

#[account]
#[derive(InitSpace, Default)]
pub struct EventPage {
    pub index: u8,
    #[max_len(EVENTS_PER_PAGE)]
    pub events: Vec<MachineEvent>,
    pub bump: u8,
}

impl EventPage {
    pub fn peek(&self) -> Option<&MachineEvent> {
        self.events.first()
    }

    pub fn push(&mut self, event: MachineEvent) -> Result<()> {
        require!(self.events.len() < EVENTS_PER_PAGE, TaxiError::QueueFull);
        self.events.push(event);
        let mut index = self.events.len() - 1;
        while index > 0 {
            let parent = (index - 1) / 2;
            if !self.events[index].before(&self.events[parent]) {
                break;
            }
            self.events.swap(index, parent);
            index = parent;
        }
        Ok(())
    }

    pub fn pop(&mut self) -> Result<MachineEvent> {
        let last = self.events.pop().ok_or(TaxiError::QueueEmpty)?;
        if self.events.is_empty() {
            return Ok(last);
        }
        let result = core::mem::replace(&mut self.events[0], last);
        let mut index = 0;
        loop {
            let left = index * 2 + 1;
            let right = left + 1;
            if left >= self.events.len() {
                break;
            }
            let mut next = left;
            if right < self.events.len() && self.events[right].before(&self.events[left]) {
                next = right;
            }
            if !self.events[next].before(&self.events[index]) {
                break;
            }
            self.events.swap(index, next);
            index = next;
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(timestamp: i64, number: u64) -> MachineEvent {
        MachineEvent::new(
            timestamp,
            number,
            Pubkey::new_unique(),
            EventKind::Expire,
            1,
        )
    }

    #[test]
    fn heap_keeps_same_second_events_separate_and_ordered() {
        let mut page = EventPage::default();
        page.push(event(10, 3)).unwrap();
        page.push(event(9, 9)).unwrap();
        page.push(event(10, 1)).unwrap();
        assert_eq!(
            (
                page.pop().unwrap().timestamp,
                page.pop().unwrap().event_number
            ),
            (9, 1)
        );
        assert_eq!(page.pop().unwrap().event_number, 3);
    }

    #[test]
    fn rewards_follow_time_segments_and_weight() {
        let mut pool = RewardPool {
            calculated_until: 0,
            total_active_weight: 3,
            next_pool: [100, 0, 0, 0, 0],
            ..RewardPool::default()
        };
        pool.start_series(4 * 60 * 60, 0).unwrap();
        pool.distribute_until(60 * 60).unwrap();
        assert_eq!(pool.series_remaining[0], 76); // 25 budget, 24 assigned across weight 3.
        pool.total_active_weight = 2;
        pool.finish_series().unwrap();
        assert_eq!(pool.obligations[0], 99);
        assert_eq!(pool.next_pool[0], 1);
    }

    #[test]
    fn empty_period_keeps_money_for_next_series() {
        let mut pool = RewardPool {
            calculated_until: 0,
            next_pool: [100, 0, 0, 0, 0],
            ..RewardPool::default()
        };
        pool.start_series(3600, 0).unwrap();
        pool.finish_series().unwrap();
        assert_eq!(pool.next_pool[0], 100);
        assert_eq!(pool.obligations[0], 0);
    }

    #[test]
    fn stale_expiry_does_not_remove_repaired_machine() {
        let asset = Pubkey::new_unique();
        let mut pool = RewardPool {
            total_active_weight: 1,
            ..RewardPool::default()
        };
        let mut machine = Machine {
            asset,
            weight: 1,
            reward_generation: 2,
            reward_active: true,
            ..Machine::default()
        };
        machine
            .apply_event(
                &mut pool,
                &MachineEvent::new(10, 1, asset, EventKind::Expire, 1),
            )
            .unwrap();
        assert!(machine.reward_active);
        assert_eq!(pool.total_active_weight, 1);
    }

    #[test]
    fn queued_burn_removes_weight_and_returns_unclaimed_rewards() {
        let asset = Pubkey::new_unique();
        let mut pool = RewardPool {
            total_active_weight: 3,
            accumulators: [math::ACCUMULATOR_SCALE, 0, 0, 0, 0],
            obligations: [2, 0, 0, 0, 0],
            ..RewardPool::default()
        };
        let mut machine = Machine {
            asset,
            weight: 2,
            reward_active: true,
            closed: true,
            ..Machine::default()
        };

        machine
            .apply_event(
                &mut pool,
                &MachineEvent::new(10, 1, asset, EventKind::Burn, 0),
            )
            .unwrap();

        assert!(machine.closed);
        assert!(!machine.reward_active);
        assert_eq!(pool.total_active_weight, 1);
        assert_eq!(pool.obligations[0], 0);
        assert_eq!(pool.next_pool[0], 2);
        assert_eq!(machine.claimable[0], 0);
    }

    #[test]
    fn queue_accounts_fit_normal_anchor_initialization() {
        assert!(EventQueue::INIT_SPACE + 8 <= 10_240);
        assert!(EventPage::INIT_SPACE + 8 <= 10_240);
        assert_eq!(MAX_QUEUE_PAGES * EVENTS_PER_PAGE, 10_240);
    }

    #[test]
    fn trainee_buckets_split_rewards_before_and_after_one_trainee_expires() {
        let mut pool = RewardPool {
            calculated_until: 0,
            total_active_weight: 2,
            next_pool: [120, 0, 0, 0, 0],
            ..RewardPool::default()
        };
        pool.start_series(120, 0).unwrap();
        pool.distribute_until(60).unwrap();
        let first_hour_accumulator = pool.accumulators[0];
        pool.total_active_weight = 1;
        pool.finish_series().unwrap();

        assert_eq!(
            math::machine_reward(first_hour_accumulator, 0, TRAINEE_WEIGHT).unwrap(),
            30
        );
        assert_eq!(
            math::machine_reward(pool.accumulators[0], 0, TRAINEE_WEIGHT).unwrap(),
            90
        );
        assert_eq!(pool.obligations[0], 120);
    }

    #[test]
    fn rescue_consumes_recorded_sol_reserves_in_a_stable_order() {
        let mut vault = FeeVault {
            fare_sol_reserve: 70,
            stock_sol_reserves: [5, 5, 5, 5],
            bump: 0,
        };
        vault.consume_reserves(76).unwrap();
        assert_eq!(vault.fare_sol_reserve, 0);
        assert_eq!(vault.stock_sol_reserves, [0, 4, 5, 5]);
        assert_eq!(vault.total_reserved().unwrap(), 14);
    }
}
