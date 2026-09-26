use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

use crate::TaxiError;

pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

const ASSET_V1_KEY: u8 = 1;
const COLLECTION_V1_KEY: u8 = 5;
const COLLECTION_UPDATE_AUTHORITY: u8 = 2;
const CREATE_V1_DISCRIMINATOR: u8 = 0;
const CREATE_COLLECTION_V2_DISCRIMINATOR: u8 = 21;
const ACCOUNT_STATE: u8 = 0;
const UPDATE_DELEGATE_PLUGIN: u8 = 4;
const IMMUTABLE_METADATA_PLUGIN: u8 = 12;

pub fn create_collection_v2(
    collection: Pubkey,
    update_authority: Pubkey,
    update_delegate: Pubkey,
    payer: Pubkey,
    system_program: Pubkey,
    name: &str,
    uri: &str,
) -> Result<Instruction> {
    let mut data = Vec::with_capacity(16 + name.len() + uri.len());
    data.push(CREATE_COLLECTION_V2_DISCRIMINATOR);
    push_string(&mut data, name)?;
    push_string(&mut data, uri)?;

    // Some([ImmutableMetadata { authority: None }, UpdateDelegate { ... }]).
    // This is the official Borsh layout used by CreateCollectionV2.
    data.push(1);
    data.extend_from_slice(&2_u32.to_le_bytes());
    data.push(IMMUTABLE_METADATA_PLUGIN);
    data.push(0);
    data.push(UPDATE_DELEGATE_PLUGIN);
    data.extend_from_slice(&1_u32.to_le_bytes());
    data.extend_from_slice(update_delegate.as_ref());
    data.push(0);
    // external_plugin_adapters: None
    data.push(0);

    Ok(Instruction {
        program_id: MPL_CORE_ID,
        accounts: vec![
            AccountMeta::new(collection, true),
            AccountMeta::new_readonly(update_authority, false),
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(system_program, false),
        ],
        data,
    })
}

pub struct CreateAsset<'a> {
    pub asset: Pubkey,
    pub collection: Pubkey,
    pub authority: Pubkey,
    pub payer: Pubkey,
    pub owner: Pubkey,
    pub system_program: Pubkey,
    pub name: &'a str,
    pub uri: &'a str,
}

pub fn create_asset_v1(args: CreateAsset<'_>) -> Result<Instruction> {
    let mut data = Vec::with_capacity(12 + args.name.len() + args.uri.len());
    data.push(CREATE_V1_DISCRIMINATOR);
    data.push(ACCOUNT_STATE);
    push_string(&mut data, args.name)?;
    push_string(&mut data, args.uri)?;
    // plugins: None
    data.push(0);

    Ok(Instruction {
        program_id: MPL_CORE_ID,
        accounts: vec![
            AccountMeta::new(args.asset, true),
            AccountMeta::new(args.collection, false),
            AccountMeta::new_readonly(args.authority, true),
            AccountMeta::new(args.payer, true),
            AccountMeta::new_readonly(args.owner, false),
            AccountMeta::new_readonly(MPL_CORE_ID, false),
            AccountMeta::new_readonly(args.system_program, false),
            AccountMeta::new_readonly(MPL_CORE_ID, false),
        ],
        data,
    })
}

pub fn assert_collection(account: &AccountInfo<'_>, update_authorities: &[Pubkey]) -> Result<()> {
    require_keys_eq!(*account.owner, MPL_CORE_ID, TaxiError::InvalidCollection);
    let data = account.try_borrow_data()?;
    require!(
        data.len() >= 33 && data[0] == COLLECTION_V1_KEY,
        TaxiError::InvalidCollection
    );
    let stored_authority = pubkey_at(&data, 1).ok_or(TaxiError::InvalidCollection)?;
    require!(
        update_authorities.contains(&stored_authority),
        TaxiError::InvalidCollection
    );
    Ok(())
}

pub fn assert_asset(
    account: &AccountInfo<'_>,
    expected_owner: &Pubkey,
    collection: &Pubkey,
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
    Ok(())
}

fn push_string(data: &mut Vec<u8>, value: &str) -> Result<()> {
    let len = u32::try_from(value.len()).map_err(|_| TaxiError::InvalidMetadataUri)?;
    data.extend_from_slice(&len.to_le_bytes());
    data.extend_from_slice(value.as_bytes());
    Ok(())
}

fn pubkey_at(data: &[u8], offset: usize) -> Option<Pubkey> {
    let bytes: [u8; 32] = data.get(offset..offset.checked_add(32)?)?.try_into().ok()?;
    Some(Pubkey::new_from_array(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_asset_layout_matches_mpl_core_shape() {
        let asset = Pubkey::new_unique();
        let collection = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let payer = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let name = "FARE Economy #0001";
        let uri = "https://example.test/economy.json";
        let instruction = create_asset_v1(CreateAsset {
            asset,
            collection,
            authority,
            payer,
            owner,
            system_program: anchor_lang::system_program::ID,
            name,
            uri,
        })
        .unwrap();

        let expected = mpl_core::instructions::CreateV1 {
            asset,
            collection: Some(collection),
            authority: Some(authority),
            payer,
            owner: Some(owner),
            update_authority: None,
            system_program: anchor_lang::system_program::ID,
            log_wrapper: None,
        }
        .instruction(mpl_core::instructions::CreateV1InstructionArgs {
            data_state: mpl_core::types::DataState::AccountState,
            name: name.to_owned(),
            uri: uri.to_owned(),
            plugins: None,
        });

        assert_eq!(instruction, expected);
    }

    #[test]
    fn collection_layout_contains_immutable_metadata_and_update_delegate_plugins() {
        let collection = Pubkey::new_unique();
        let update_authority = Pubkey::new_unique();
        let update_delegate = Pubkey::new_unique();
        let payer = Pubkey::new_unique();
        let name = "FARE Taxi Park";
        let uri = "https://example.test/collection.json";
        let instruction = create_collection_v2(
            collection,
            update_authority,
            update_delegate,
            payer,
            anchor_lang::system_program::ID,
            name,
            uri,
        )
        .unwrap();

        let expected = mpl_core::instructions::CreateCollectionV2 {
            collection,
            update_authority: Some(update_authority),
            payer,
            system_program: anchor_lang::system_program::ID,
        }
        .instruction(mpl_core::instructions::CreateCollectionV2InstructionArgs {
            name: name.to_owned(),
            uri: uri.to_owned(),
            plugins: Some(vec![
                mpl_core::types::PluginAuthorityPair {
                    plugin: mpl_core::types::Plugin::ImmutableMetadata(
                        mpl_core::types::ImmutableMetadata {},
                    ),
                    authority: None,
                },
                mpl_core::types::PluginAuthorityPair {
                    plugin: mpl_core::types::Plugin::UpdateDelegate(
                        mpl_core::types::UpdateDelegate {
                            additional_delegates: vec![update_delegate],
                        },
                    ),
                    authority: None,
                },
            ]),
            external_plugin_adapters: None,
        });

        assert_eq!(instruction, expected);
    }
}
