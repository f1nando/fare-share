use anchor_lang::{prelude::*, solana_program::instruction::Instruction};

use crate::TaxiError;

const DOMAIN: &[u8] = b"TAXI_TRAINEE_V1";
const OFFSETS_START: usize = 2;
const OFFSETS_LEN: usize = 14;
const SIGNATURE_LEN: usize = 64;
const PUBLIC_KEY_LEN: usize = 32;
const ED25519_PROGRAM_ID: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub struct ActivateTraineeArgs {
    pub campaign_id: u64,
    pub nonce: u64,
    pub duration_minutes: u16,
    pub expires_at: i64,
    pub active_from: i64,
    pub active_until: i64,
    pub page_index: u8,
}

pub fn message(
    program_id: &Pubkey,
    deployment_id: &[u8; 32],
    wallet: &Pubkey,
    args: &ActivateTraineeArgs,
) -> Vec<u8> {
    let mut result = Vec::with_capacity(DOMAIN.len() + 32 * 3 + 8 * 5 + 3);
    result.extend_from_slice(DOMAIN);
    result.extend_from_slice(program_id.as_ref());
    result.extend_from_slice(deployment_id);
    result.extend_from_slice(wallet.as_ref());
    result.extend_from_slice(&args.campaign_id.to_le_bytes());
    result.extend_from_slice(&args.nonce.to_le_bytes());
    result.extend_from_slice(&args.duration_minutes.to_le_bytes());
    result.extend_from_slice(&args.expires_at.to_le_bytes());
    result.extend_from_slice(&args.active_from.to_le_bytes());
    result.extend_from_slice(&args.active_until.to_le_bytes());
    result
}

pub fn verify_ed25519_instruction(
    ix: &Instruction,
    signer: &Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    require_keys_eq!(
        ix.program_id,
        ED25519_PROGRAM_ID,
        TaxiError::InvalidVoucherSignature
    );
    let data = &ix.data;
    require!(
        data.len() >= OFFSETS_START + OFFSETS_LEN,
        TaxiError::InvalidVoucherSignature
    );
    require!(data[0] == 1, TaxiError::InvalidVoucherSignature);

    let signature_offset = read_u16(data, 2)? as usize;
    let signature_instruction = read_u16(data, 4)?;
    let public_key_offset = read_u16(data, 6)? as usize;
    let public_key_instruction = read_u16(data, 8)?;
    let message_offset = read_u16(data, 10)? as usize;
    let message_size = read_u16(data, 12)? as usize;
    let message_instruction = read_u16(data, 14)?;

    require!(
        signature_instruction == u16::MAX
            && public_key_instruction == u16::MAX
            && message_instruction == u16::MAX,
        TaxiError::InvalidVoucherSignature
    );
    let signature_end = signature_offset
        .checked_add(SIGNATURE_LEN)
        .ok_or(TaxiError::MathOverflow)?;
    let public_key_end = public_key_offset
        .checked_add(PUBLIC_KEY_LEN)
        .ok_or(TaxiError::MathOverflow)?;
    let message_end = message_offset
        .checked_add(message_size)
        .ok_or(TaxiError::MathOverflow)?;
    require!(
        signature_end <= data.len(),
        TaxiError::InvalidVoucherSignature
    );
    require!(
        public_key_end <= data.len(),
        TaxiError::InvalidVoucherSignature
    );
    require!(
        message_end <= data.len(),
        TaxiError::InvalidVoucherSignature
    );
    require!(
        message_size == expected_message.len(),
        TaxiError::InvalidVoucherSignature
    );
    require!(
        &data[public_key_offset..public_key_end] == signer.as_ref(),
        TaxiError::InvalidVoucherSignature
    );
    require!(
        &data[message_offset..message_end] == expected_message,
        TaxiError::InvalidVoucherSignature
    );
    Ok(())
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16> {
    let bytes: [u8; 2] = data
        .get(offset..offset + 2)
        .ok_or(TaxiError::InvalidVoucherSignature)?
        .try_into()
        .map_err(|_| error!(TaxiError::InvalidVoucherSignature))?;
    Ok(u16::from_le_bytes(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_one_inline_ed25519_verification() {
        let signer = Pubkey::new_unique();
        let expected = b"signed trainee voucher";
        let public_key_offset = 16_u16;
        let signature_offset = public_key_offset + PUBLIC_KEY_LEN as u16;
        let message_offset = signature_offset + SIGNATURE_LEN as u16;
        let mut data = vec![1, 0];
        for value in [
            signature_offset,
            u16::MAX,
            public_key_offset,
            u16::MAX,
            message_offset,
            expected.len() as u16,
            u16::MAX,
        ] {
            data.extend_from_slice(&value.to_le_bytes());
        }
        data.extend_from_slice(signer.as_ref());
        data.extend_from_slice(&[7; SIGNATURE_LEN]);
        data.extend_from_slice(expected);
        let ix = Instruction {
            program_id: ED25519_PROGRAM_ID,
            accounts: vec![],
            data,
        };
        verify_ed25519_instruction(&ix, &signer, expected).unwrap();
    }

    #[test]
    fn rejects_a_message_for_another_wallet() {
        let signer = Pubkey::new_unique();
        let mut data = vec![1, 0];
        for value in [80_u16, u16::MAX, 16, u16::MAX, 144, 1, u16::MAX] {
            data.extend_from_slice(&value.to_le_bytes());
        }
        data.extend_from_slice(Pubkey::new_unique().as_ref());
        data.extend_from_slice(&[7; SIGNATURE_LEN]);
        data.push(1);
        let ix = Instruction {
            program_id: ED25519_PROGRAM_ID,
            accounts: vec![],
            data,
        };
        assert!(verify_ed25519_instruction(&ix, &signer, &[1]).is_err());
    }
}
