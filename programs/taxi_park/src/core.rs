use crate::TaxiError;
use anchor_lang::prelude::*;

pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

const ASSET_V1_KEY: u8 = 1;
const COLLECTION_V1_KEY: u8 = 5;
const COLLECTION_UPDATE_AUTHORITY: u8 = 2;
pub fn assert_collection(account: &AccountInfo<'_>, update_authority: &Pubkey) -> Result<()> {
    require_keys_eq!(*account.owner, MPL_CORE_ID, TaxiError::InvalidCollection);
    let data = account.try_borrow_data()?;
    require!(
        data.len() >= 33 && data[0] == COLLECTION_V1_KEY,
        TaxiError::InvalidCollection
    );
    let stored_authority = pubkey_at(&data, 1).ok_or(TaxiError::InvalidCollection)?;
    require_keys_eq!(
        stored_authority,
        *update_authority,
        TaxiError::InvalidCollection
    );
    Ok(())
}

pub fn assert_asset(
    account: &AccountInfo<'_>,
    expected_owner: &Pubkey,
    collection: &Pubkey,
    expected_uri: Option<&str>,
) -> Result<()> {
    require_keys_eq!(*account.owner, MPL_CORE_ID, TaxiError::InvalidCollection);
    let data = account.try_borrow_data()?;
    require!(
        data.len() >= 66 && data[0] == ASSET_V1_KEY,
        TaxiError::InvalidCollection
    );
    let stored_owner = pubkey_at(&data, 1).ok_or(TaxiError::InvalidAssetOwner)?;
    require_keys_eq!(stored_owner, *expected_owner, TaxiError::InvalidAssetOwner);
    require!(
        data[33] == COLLECTION_UPDATE_AUTHORITY,
        TaxiError::InvalidCollection
    );
    let stored_collection = pubkey_at(&data, 34).ok_or(TaxiError::InvalidCollection)?;
    require_keys_eq!(stored_collection, *collection, TaxiError::InvalidCollection);
    if let Some(expected_uri) = expected_uri {
        let name_offset = 66;
        let (_, uri_offset) = string_at(&data, name_offset).ok_or(TaxiError::InvalidMetadataUri)?;
        let (stored_uri, _) = string_at(&data, uri_offset).ok_or(TaxiError::InvalidMetadataUri)?;
        require!(stored_uri == expected_uri, TaxiError::InvalidMetadataUri);
    }
    Ok(())
}

fn string_at(data: &[u8], offset: usize) -> Option<(&str, usize)> {
    let len_bytes: [u8; 4] = data.get(offset..offset.checked_add(4)?)?.try_into().ok()?;
    let len = u32::from_le_bytes(len_bytes) as usize;
    let start = offset.checked_add(4)?;
    let end = start.checked_add(len)?;
    Some((core::str::from_utf8(data.get(start..end)?).ok()?, end))
}

fn pubkey_at(data: &[u8], offset: usize) -> Option<Pubkey> {
    let bytes: [u8; 32] = data.get(offset..offset.checked_add(32)?)?.try_into().ok()?;
    Some(Pubkey::new_from_array(bytes))
}
