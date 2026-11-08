//! The accounts and helpers shared by every instruction that works on one of a room's
//! sealed ephemeral accounts (a view or a recorder chunk) and its permission.
use anchor_lang::prelude::*;

use crate::error::BlackoutError;
use crate::state::*;
use ephemeral_rollups_sdk::access_control::instructions::{CreateEphemeralPermissionCpi, UpdateEphemeralPermissionCpi};
use ephemeral_rollups_sdk::access_control::structs::{EphemeralMembersArgs, EphemeralPermission, Member, AUTHORITY_FLAG, TX_LOGS_FLAG};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::ephemeral_accounts::EphemeralAccount;

/// Shared by the instructions that work on one of a room's ephemeral accounts (a view or a
/// recorder chunk) and its permission. Handlers check `target` with `expect_pda`.
#[derive(Accounts)]
pub struct RoomAccount<'info> {
    #[account(mut, seeds = [ROOM_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: expect_pda in the handler
    #[account(mut)]
    pub target: UncheckedAccount<'info>,
    /// CHECK: permission program checks
    #[account(mut)]
    pub target_permission: UncheckedAccount<'info>,
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: ephemeral rent vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

/// The bump for `seeds`, after checking they really derive `target`.
pub fn expect_pda(target: &AccountInfo, seeds: &[&[u8]]) -> Result<u8> {
    let (key, bump) = Pubkey::find_program_address(seeds, &crate::ID);
    require_keys_eq!(*target.key, key, BlackoutError::BadAccount);
    Ok(bump)
}

/// `perm` must be the real permission PDA of `account`. Setup skips creating a permission
/// that already exists, so without this a caller could pass any non-empty account,
/// skip the real one and leave a sealed account with no access rule at all.
pub fn expect_permission(perm: &AccountInfo, account: &Pubkey) -> Result<()> {
    let (key, _) = EphemeralPermission::find_pda(account);
    require_keys_eq!(*perm.key, key, BlackoutError::BadAccount);
    Ok(())
}

/// Rewrite who may read a seat's view: `members` only.
pub fn set_view_members<'info>(ctx: &Context<'info, RoomAccount<'info>>, rid: &[u8; 8], seat: u8, members: Vec<Member>) -> Result<()> {
    let a = &ctx.accounts;
    let view_bump = expect_pda(&a.target, &[VIEW_SEED, rid, &[seat]])?;
    let room_seeds: &[&[u8]] = &[ROOM_SEED, rid, &[ctx.bumps.room]];
    let view_seeds: &[&[u8]] = &[VIEW_SEED, rid, &[seat], &[view_bump]];
    UpdateEphemeralPermissionCpi {
        payer: a.room.to_account_info(),
        permissioned_account: a.target.to_account_info(),
        permission: a.target_permission.to_account_info(),
        vault: a.ephemeral_vault.to_account_info(),
        magic_program: a.magic_program.to_account_info(),
        permission_program: a.permission_program.to_account_info(),
        authority: a.target.to_account_info(),
        authority_is_signer: false,
        args: EphemeralMembersArgs { is_private: true, members },
    }
    .invoke_signed(&[room_seeds, view_seeds])?;
    Ok(())
}

/// Create a sealed ephemeral account (a recorder chunk or a view) and its private permission.
pub fn create_sealed<'info>(ctx: &Context<'info, RoomAccount<'info>>, rid: &[u8; 8], own_seeds: &[&[u8]], len: u32, init: impl FnOnce(&mut [u8])) -> Result<()> {
    let a = &ctx.accounts;
    let room_seeds: &[&[u8]] = &[ROOM_SEED, rid, &[ctx.bumps.room]];
    let room_ai = a.room.to_account_info();
    let target = a.target.to_account_info();
    let vault = a.ephemeral_vault.to_account_info();
    if target.data_is_empty() {
        EphemeralAccount::new(&room_ai, &target, &vault)
            .with_signer_seeds(&[room_seeds, own_seeds])
            .create(len)?;
        init(&mut target.try_borrow_mut_data()?);
    }
    let perm = a.target_permission.to_account_info();
    expect_permission(&perm, target.key)?;
    if perm.data_is_empty() {
        CreateEphemeralPermissionCpi {
            payer: room_ai.clone(),
            permissioned_account: target.clone(),
            permission: perm,
            vault: vault.clone(),
            magic_program: a.magic_program.to_account_info(),
            permission_program: a.permission_program.to_account_info(),
            args: EphemeralMembersArgs { is_private: true, members: vec![] },
        }
        .invoke_signed(&[room_seeds, own_seeds])?;
    }
    Ok(())
}

pub fn room_key_parts(room_id: u64) -> (u32, u32) {
    (room_id as u32, (room_id >> 32) as u32)
}

pub fn members_for(key: Pubkey) -> Vec<Member> {
    vec![Member { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: key }]
}
