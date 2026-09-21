use anchor_lang::{prelude::*, solana_program::account_info::AccountInfo};

use crate::voucher;

pub const FARE_SWAP_KIND: u8 = 0;
pub const STOCK_SWAP_KIND: u8 = 1;
const DOMAIN: &[u8] = b"TAXI_SWAP_V1";

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct SwapPlan {
    pub kind: u8,
    pub asset_index: u8,
    pub nonce: u64,
    pub amount_in: u64,
    pub min_out: u64,
    pub deadline: i64,
    pub route_hash: [u8; 32],
}

pub fn message(program_id: &Pubkey, deployment_id: &[u8; 32], plan: &SwapPlan) -> Vec<u8> {
    let mut result = Vec::with_capacity(DOMAIN.len() + 32 * 3 + 36);
    result.extend_from_slice(DOMAIN);
    result.extend_from_slice(program_id.as_ref());
    result.extend_from_slice(deployment_id);
    result.push(plan.kind);
    result.push(plan.asset_index);
    result.extend_from_slice(&plan.nonce.to_le_bytes());
    result.extend_from_slice(&plan.amount_in.to_le_bytes());
    result.extend_from_slice(&plan.min_out.to_le_bytes());
    result.extend_from_slice(&plan.deadline.to_le_bytes());
    result.extend_from_slice(&plan.route_hash);
    result
}

pub fn route_hash(
    route_data: &[u8],
    route_accounts: &[AccountInfo<'_>],
    config: &Pubkey,
) -> [u8; 32] {
    let mut account_bytes = Vec::with_capacity(route_accounts.len() * 34);
    for account in route_accounts {
        account_bytes.extend_from_slice(account.key.as_ref());
        account_bytes.push(u8::from(account.is_writable));
        account_bytes.push(u8::from(account.key == config));
    }
    solana_sha256_hasher::hashv(&[route_data, &account_bytes]).to_bytes()
}

pub fn verify_signature(
    signature_ix: &anchor_lang::solana_program::instruction::Instruction,
    backend_signer: &Pubkey,
    program_id: &Pubkey,
    deployment_id: &[u8; 32],
    plan: &SwapPlan,
) -> Result<()> {
    voucher::verify_ed25519_instruction(
        signature_ix,
        backend_signer,
        &message(program_id, deployment_id, plan),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_message_changes_with_nonce_and_route() {
        let program = Pubkey::new_unique();
        let deployment = [4; 32];
        let mut plan = SwapPlan {
            kind: FARE_SWAP_KIND,
            asset_index: 0,
            nonce: 1,
            amount_in: 10,
            min_out: 9,
            deadline: 100,
            route_hash: [5; 32],
        };
        let first = message(&program, &deployment, &plan);
        plan.nonce = 2;
        assert_ne!(first, message(&program, &deployment, &plan));
        plan.nonce = 1;
        plan.route_hash[0] = 6;
        assert_ne!(first, message(&program, &deployment, &plan));
    }
}
