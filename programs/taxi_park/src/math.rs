use anchor_lang::prelude::*;

use crate::TaxiError;

pub const ACCUMULATOR_SCALE: u128 = 1_000_000_000_000_000_000;

pub fn mul_div_u64(value: u64, numerator: u64, denominator: u64) -> Result<u64> {
    require!(denominator > 0, TaxiError::InvalidSegment);
    let result = u128::from(value)
        .checked_mul(u128::from(numerator))
        .ok_or(TaxiError::MathOverflow)?
        .checked_div(u128::from(denominator))
        .ok_or(TaxiError::MathOverflow)?;
    u64::try_from(result).map_err(|_| error!(TaxiError::MathOverflow))
}

pub fn reward_per_weight(amount: u64, total_weight: u64) -> Result<(u128, u64)> {
    require!(total_weight > 0, TaxiError::InvalidActiveWeight);
    let increment = u128::from(amount)
        .checked_mul(ACCUMULATOR_SCALE)
        .ok_or(TaxiError::MathOverflow)?
        .checked_div(u128::from(total_weight))
        .ok_or(TaxiError::MathOverflow)?;
    let assigned = increment
        .checked_mul(u128::from(total_weight))
        .ok_or(TaxiError::MathOverflow)?
        .checked_div(ACCUMULATOR_SCALE)
        .ok_or(TaxiError::MathOverflow)?;
    Ok((
        increment,
        u64::try_from(assigned).map_err(|_| error!(TaxiError::MathOverflow))?,
    ))
}

pub fn machine_reward(accumulator: u128, checkpoint: u128, weight: u16) -> Result<u64> {
    let delta = accumulator
        .checked_sub(checkpoint)
        .ok_or(TaxiError::MathOverflow)?;
    let amount = delta
        .checked_mul(u128::from(weight))
        .ok_or(TaxiError::MathOverflow)?
        .checked_div(ACCUMULATOR_SCALE)
        .ok_or(TaxiError::MathOverflow)?;
    u64::try_from(amount).map_err(|_| error!(TaxiError::MathOverflow))
}

pub fn repair_cost(fare_base: u64, missing_seconds: i64) -> Result<u64> {
    if fare_base == 0 || missing_seconds <= 0 {
        return Ok(0);
    }
    let missing = u64::try_from(missing_seconds).map_err(|_| error!(TaxiError::MathOverflow))?;
    let full_cost = u128::from(fare_base)
        .checked_mul(25)
        .ok_or(TaxiError::MathOverflow)?
        .checked_div(100)
        .ok_or(TaxiError::MathOverflow)?;
    let cost = full_cost
        .checked_mul(u128::from(missing))
        .ok_or(TaxiError::MathOverflow)?
        .checked_div(crate::MAX_DURABILITY_SECONDS as u128)
        .ok_or(TaxiError::MathOverflow)?;
    u64::try_from(cost).map_err(|_| error!(TaxiError::MathOverflow))
}

pub fn fare_swap_split(received: u64) -> Result<(u64, u64, u64)> {
    let main = mul_div_u64(received, 45, 70)?;
    let trainee = mul_div_u64(received, 5, 70)?;
    let burn = received
        .checked_sub(main)
        .and_then(|amount| amount.checked_sub(trainee))
        .ok_or(TaxiError::MathOverflow)?;
    Ok((main, trainee, burn))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_missing_day_costs_five_percent_of_base() {
        assert_eq!(repair_cost(20_000_000, 86_400).unwrap(), 1_000_000);
    }

    #[test]
    fn reward_rounding_never_assigns_more_than_the_segment() {
        let (increment, assigned) = reward_per_weight(100, 3).unwrap();
        assert_eq!(assigned, 99);
        assert_eq!(machine_reward(increment, 0, 1).unwrap(), 33);
    }

    #[test]
    fn fare_swap_split_assigns_every_received_token() {
        assert_eq!(fare_swap_split(70).unwrap(), (45, 5, 20));
        assert_eq!(fare_swap_split(1).unwrap(), (0, 0, 1));
    }
}
